use crate::auth::jwt::{Claims, JwtAuth};
use crate::state::call_registry::{CallRegistry, CallState, CallStatus};
use crate::state::connection_registry::{Connection, ConnectionRegistry};
use crate::validation::message_validation::{MessageValidator, normalize_subscription_symbol};
use crate::ws::protocol::{ClientMessage, ServerMessage};
use crate::stream::broadcaster::{Broadcaster, WS_CONN_CHANNEL_CAP};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;
use tracing::{error, info, warn};
use anyhow::Result;
use redis::Client as RedisClient;
use redis::AsyncCommands;

pub struct Session {
    conn_id: Uuid,
    registry: Arc<ConnectionRegistry>,
    validator: Arc<MessageValidator>,
    jwt_auth: Arc<JwtAuth>,
    broadcaster: Arc<Broadcaster>,
    call_registry: Arc<CallRegistry>,
    redis_url: String,
    nats: Option<Arc<async_nats::Client>>,
}

impl Session {
    pub fn new(
        registry: Arc<ConnectionRegistry>,
        validator: Arc<MessageValidator>,
        jwt_auth: Arc<JwtAuth>,
        broadcaster: Arc<Broadcaster>,
        call_registry: Arc<CallRegistry>,
        redis_url: String,
        nats: Option<Arc<async_nats::Client>>,
    ) -> Self {
        let conn_id = Uuid::new_v4();
        info!("New WebSocket connection established: {}", conn_id);
        Self {
            conn_id,
            registry,
            validator,
            jwt_auth,
            broadcaster,
            call_registry,
            redis_url,
            nats,
        }
    }

    pub async fn handle(&mut self, socket: WebSocket) {
        // Clone redis_url before we move self
        let redis_url = self.redis_url.clone();
        let (mut sender, mut receiver) = socket.split();

        // Create channel for this connection
        let (tx, mut rx) = mpsc::channel::<ServerMessage>(WS_CONN_CHANNEL_CAP);
        self.broadcaster.register_connection(self.conn_id, tx.clone());

        // Create channel for responses from recv_task
        let (response_tx, mut response_rx) = mpsc::unbounded_channel::<Message>();

        // Spawn task to send messages to client
        let mut send_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg = rx.recv() => {
                        match msg {
                            Some(msg) => {
                                match msg.to_json() {
                                    Ok(json) => {
                                        if sender.send(Message::Text(json)).await.is_err() {
                                            break;
                                        }
                                    }
                                    Err(e) => {
                                        error!("Failed to serialize message: {}", e);
                                    }
                                }
                            }
                            None => break,
                        }
                    }
                    response = response_rx.recv() => {
                        match response {
                            Some(msg) => {
                                if sender.send(msg).await.is_err() {
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                }
            }
        });

        // Handle incoming messages
        let conn_id = self.conn_id;
        let registry = self.registry.clone();
        let validator = self.validator.clone();
        let jwt_auth = self.jwt_auth.clone();
        let broadcaster = self.broadcaster.clone();
        let call_registry = self.call_registry.clone();
        let response_tx_clone = response_tx.clone();
        let redis_url_for_balance = redis_url.clone();
        let nats_clone = self.nats.clone();

        let mut recv_task = tokio::spawn(async move {
            let mut is_authenticated = false;
            while let Some(Ok(msg)) = receiver.next().await {
                match msg {
                    Message::Text(text) => {
                        info!("Received message from connection {}: {}", conn_id, text);
                        // Validate message size
                        if let Err(e) = validator.validate_message_size(text.len()) {
                            warn!("Message too large from connection {}: {}", conn_id, e);
                            let error_msg = ServerMessage::Error {
                                code: "MESSAGE_TOO_LARGE".to_string(),
                                message: e.to_string(),
                            };
                            if let Ok(json) = error_msg.to_json() {
                                let _ = response_tx_clone.send(Message::Text(json));
                            }
                            continue;
                        }

                        // Parse message
                        let client_msg: ClientMessage = match serde_json::from_str(&text) {
                            Ok(msg) => {
                                info!("Parsed message from connection {}: {:?}", conn_id, msg);
                                msg
                            },
                            Err(e) => {
                                warn!("Failed to parse message from connection {}: {} - Raw: {}", conn_id, e, text);
                                let error_msg = ServerMessage::Error {
                                    code: "INVALID_JSON".to_string(),
                                    message: format!("Failed to parse message: {}", e),
                                };
                                if let Ok(json) = error_msg.to_json() {
                                    let _ = response_tx_clone.send(Message::Text(json));
                                }
                                continue;
                            }
                        };

                        // Validate message
                        if let Err(e) = validator.validate_message(&client_msg) {
                            let error_msg = ServerMessage::Error {
                                code: "VALIDATION_ERROR".to_string(),
                                message: e.to_string(),
                            };
                            if let Ok(json) = error_msg.to_json() {
                                let _ = response_tx_clone.send(Message::Text(json));
                            }
                            continue;
                        }

                        // Handle message
                        match client_msg {
                            ClientMessage::Auth { token } => {
                                if is_authenticated {
                                    // Ignore duplicate auth attempts on an already authenticated socket.
                                    continue;
                                }
                                info!("Auth message received from connection {}, validating token...", conn_id);
                                // Strip "Bearer " prefix if frontend sent it; trim whitespace
                                let token = token.trim().strip_prefix("Bearer ").unwrap_or(token.trim());
                                match jwt_auth.validate_token(token) {
                                    Ok(claims) => {
                                        info!("✅ Token validated successfully for connection {}", conn_id);
                                        info!("   Claims - sub (user_id): {}, email: {}, role: {}, group_id: {:?}", 
                                            claims.sub, claims.email, claims.role, claims.group_id);
                                        
                                        if jwt_auth.is_expired(&claims) {
                                            warn!("Token expired for connection {}", conn_id);
                                            let error_msg = ServerMessage::AuthError {
                                                error: "Token expired".to_string(),
                                            };
                                            if let Ok(json) = error_msg.to_json() {
                                                let _ = response_tx_clone.send(Message::Text(json));
                                            }
                                            continue;
                                        }

                                        // Register connection
                                        let conn = Connection {
                                            conn_id,
                                            user_id: claims.sub.clone(),
                                            group_id: claims.group_id.clone(),
                                            role: claims.role.clone(),
                                            subscriptions: Arc::new(dashmap::DashMap::new()),
                                            last_heartbeat: std::time::Instant::now(),
                                        };
                                        registry.register(conn);
                                        is_authenticated = true;
                                        info!("✅ Connection {} registered with user_id: {}", conn_id, claims.sub);

                                        // Send auth success
                                        let success_msg = ServerMessage::AuthSuccess {
                                            user_id: claims.sub.clone(),
                                            group_id: claims.group_id.clone(),
                                        };
                                        if let Ok(json) = success_msg.to_json() {
                                            info!("📤 Sending auth_success to connection {} with user_id: {}", conn_id, claims.sub);
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }

                                        // Request initial wallet balance via Redis
                                        let user_id_str = claims.sub.to_string();
                                        let redis_url_clone = redis_url_for_balance.clone();
                                        tokio::spawn(async move {
                                            if let Ok(client) = RedisClient::open(redis_url_clone) {
                                                if let Ok(mut conn) = client.get_async_connection().await {
                                                    let request = serde_json::json!({
                                                        "user_id": user_id_str,
                                                        "request_type": "initial_balance"
                                                    });
                                                    if let Ok(json_str) = serde_json::to_string(&request) {
                                                        if let Err(e) = conn.publish::<_, _, i32>("wallet:balance:request", json_str).await {
                                                            warn!("Failed to publish wallet balance request: {}", e);
                                                        } else {
                                                            info!("Published wallet balance request for user {}", user_id_str);
                                                        }
                                                    }
                                                }
                                            }
                                        });

                                        info!("Connection {} authenticated as user {}", conn_id, claims.sub);
                                    }
                                    Err(e) => {
                                        error!("❌ Token validation failed for connection {}: {}", conn_id, e);
                                        error!("   Token (first 50 chars): {}", token.chars().take(50).collect::<String>());
                                        let error_msg = ServerMessage::AuthError {
                                            error: format!("Invalid token: {}", e),
                                        };
                                        if let Ok(json) = error_msg.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                    }
                                }
                            }
                            ClientMessage::Subscribe { symbols, channels } => {
                                // Check if authenticated
                                if registry.get(&conn_id).is_some() {
                                    let mut normalized_symbols: Vec<String> = Vec::with_capacity(symbols.len());
                                    for symbol in &symbols {
                                        if let Some(normalized) = normalize_subscription_symbol(symbol) {
                                            if !normalized_symbols.contains(&normalized) {
                                                registry.subscribe_symbol(conn_id, normalized.clone(), channels.clone());
                                                normalized_symbols.push(normalized);
                                            }
                                        }
                                    }

                                    let success_msg = ServerMessage::Subscribed {
                                        symbols: normalized_symbols,
                                    };
                                    if let Ok(json) = success_msg.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }

                                    info!("Connection {} subscribed to {} symbols", conn_id, symbols.len());
                                } else {
                                    let error_msg = ServerMessage::Error {
                                        code: "NOT_AUTHENTICATED".to_string(),
                                        message: "Must authenticate first".to_string(),
                                    };
                                    if let Ok(json) = error_msg.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                }
                            }
                            ClientMessage::Unsubscribe { symbols } => {
                                let mut normalized_symbols: Vec<String> = Vec::with_capacity(symbols.len());
                                for symbol in &symbols {
                                    if let Some(normalized) = normalize_subscription_symbol(symbol) {
                                        if !normalized_symbols.contains(&normalized) {
                                            registry.unsubscribe_symbol(conn_id, &normalized);
                                            normalized_symbols.push(normalized);
                                        }
                                    }
                                }

                                let success_msg = ServerMessage::Unsubscribed {
                                    symbols: normalized_symbols,
                                };
                                if let Ok(json) = success_msg.to_json() {
                                    let _ = response_tx_clone.send(Message::Text(json));
                                }
                            }
                            ClientMessage::Ping => {
                                registry.update_heartbeat(conn_id);
                                let pong = ServerMessage::Pong;
                                if let Ok(json) = pong.to_json() {
                                    let _ = response_tx_clone.send(Message::Text(json));
                                }
                            }
                            ClientMessage::CallInitiate {
                                target_user_id,
                                caller_display_name,
                            } => {
                                let conn = match registry.get(&conn_id) {
                                    Some(c) => c,
                                    None => {
                                        let err = ServerMessage::CallError {
                                            call_id: None,
                                            code: "NOT_AUTHENTICATED".to_string(),
                                            message: "Must authenticate first".to_string(),
                                        };
                                        if let Ok(json) = err.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                        continue;
                                    }
                                };
                                let is_admin = conn.role.eq_ignore_ascii_case("admin") || conn.role.eq_ignore_ascii_case("super_admin");
                                if !is_admin {
                                    let err = ServerMessage::CallError {
                                        call_id: None,
                                        code: "FORBIDDEN".to_string(),
                                        message: "Only admins can initiate calls".to_string(),
                                    };
                                    if let Ok(json) = err.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                    continue;
                                }
                                if target_user_id == conn.user_id {
                                    let err = ServerMessage::CallError {
                                        call_id: None,
                                        code: "INVALID_TARGET".to_string(),
                                        message: "Cannot call yourself".to_string(),
                                    };
                                    if let Ok(json) = err.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                    continue;
                                }
                                let call_id = Uuid::new_v4().to_string();
                                let admin_user_id = conn.user_id.clone();
                                let state = CallState {
                                    call_id: call_id.clone(),
                                    admin_user_id: admin_user_id.clone(),
                                    target_user_id: target_user_id.clone(),
                                    status: CallStatus::Ringing,
                                    created_at: std::time::Instant::now(),
                                };
                                call_registry.insert(state);
                                let target_conn_ids = registry.get_user_connections(&target_user_id);
                                if target_conn_ids.is_empty() {
                                    let _ = call_registry.remove(&call_id);
                                    let err = ServerMessage::CallError {
                                        call_id: Some(call_id),
                                        code: "USER_OFFLINE".to_string(),
                                        message: "User is offline".to_string(),
                                    };
                                    if let Ok(json) = err.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                    continue;
                                }
                                let incoming = ServerMessage::CallIncoming {
                                    call_id: call_id.clone(),
                                    admin_user_id: admin_user_id.clone(),
                                    admin_display_name: caller_display_name.clone(),
                                };
                                broadcaster.send_to_connections(&target_conn_ids, incoming);
                                let ringing = ServerMessage::CallRinging {
                                    call_id: call_id.clone(),
                                    target_user_id: target_user_id.clone(),
                                };
                                if let Ok(json) = ringing.to_json() {
                                    let _ = response_tx_clone.send(Message::Text(json));
                                }
                                if let Some(ref nats) = nats_clone {
                                    let payload = serde_json::json!({
                                        "call_id": call_id,
                                        "admin_user_id": admin_user_id,
                                        "user_id": target_user_id,
                                        "event": "initiated",
                                        "admin_display_name": caller_display_name
                                    });
                                    let _ = nats.publish("admin_call.events".to_string(), payload.to_string().into()).await;
                                }
                                // Ring timeout: after 60s send call.ended to admin if still ringing
                                let cr = call_registry.clone();
                                let bc = broadcaster.clone();
                                let reg = registry.clone();
                                let cid = call_id.clone();
                                let aid = admin_user_id.clone();
                                let tid = target_user_id.clone();
                                let nats_timeout = nats_clone.clone();
                                tokio::spawn(async move {
                                    tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                                    if let Some(_state) = cr.remove_if_ringing(&cid) {
                                        let ended = ServerMessage::CallEnded {
                                            call_id: cid.clone(),
                                            ended_by: "timeout".to_string(),
                                        };
                                        let admin_conns = reg.get_user_connections(&aid);
                                        bc.send_to_connections(&admin_conns, ended.clone());
                                        let user_conns = reg.get_user_connections(&tid);
                                        bc.send_to_connections(&user_conns, ended);
                                        if let Some(ref nats) = nats_timeout {
                                            let payload = serde_json::json!({
                                                "call_id": cid,
                                                "admin_user_id": aid,
                                                "user_id": tid,
                                                "event": "timeout",
                                                "ended_by": "timeout"
                                            });
                                            let _ = nats.publish("admin_call.events".to_string(), payload.to_string().into()).await;
                                        }
                                    }
                                });
                            }
                            ClientMessage::CallAnswer { call_id } => {
                                let conn = match registry.get(&conn_id) {
                                    Some(c) => c,
                                    None => {
                                        let err = ServerMessage::CallError {
                                            call_id: Some(call_id.clone()),
                                            code: "NOT_AUTHENTICATED".to_string(),
                                            message: "Must authenticate first".to_string(),
                                        };
                                        if let Ok(json) = err.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                        continue;
                                    }
                                };
                                let state = match call_registry.get(&call_id) {
                                    Some(s) => s,
                                    None => {
                                        let err = ServerMessage::CallError {
                                            call_id: Some(call_id),
                                            code: "CALL_NOT_FOUND".to_string(),
                                            message: "Call not found or already ended".to_string(),
                                        };
                                        if let Ok(json) = err.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                        continue;
                                    }
                                };
                                if state.target_user_id != conn.user_id {
                                    let err = ServerMessage::CallError {
                                        call_id: Some(call_id),
                                        code: "FORBIDDEN".to_string(),
                                        message: "Not authorized to answer this call".to_string(),
                                    };
                                    if let Ok(json) = err.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                    continue;
                                }
                                if state.status != CallStatus::Ringing {
                                    let err = ServerMessage::CallError {
                                        call_id: Some(call_id),
                                        code: "ALREADY_ANSWERED".to_string(),
                                        message: "Call already answered or ended".to_string(),
                                    };
                                    if let Ok(json) = err.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                    continue;
                                }
                                if let Some(mut entry) = call_registry.get_mut(&call_id) {
                                    entry.status = CallStatus::Accepted;
                                }
                                let accepted = ServerMessage::CallAccepted {
                                    call_id: call_id.clone(),
                                    target_user_id: state.target_user_id.clone(),
                                };
                                let admin_conns = registry.get_user_connections(&state.admin_user_id);
                                broadcaster.send_to_connections(&admin_conns, accepted);
                                if let Some(ref nats) = nats_clone {
                                    let payload = serde_json::json!({
                                        "call_id": call_id,
                                        "admin_user_id": state.admin_user_id,
                                        "user_id": state.target_user_id,
                                        "event": "answered"
                                    });
                                    let _ = nats.publish("admin_call.events".to_string(), payload.to_string().into()).await;
                                }
                            }
                            ClientMessage::CallReject { call_id } => {
                                let conn = match registry.get(&conn_id) {
                                    Some(c) => c,
                                    None => {
                                        let err = ServerMessage::CallError {
                                            call_id: Some(call_id.clone()),
                                            code: "NOT_AUTHENTICATED".to_string(),
                                            message: "Must authenticate first".to_string(),
                                        };
                                        if let Ok(json) = err.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                        continue;
                                    }
                                };
                                let state = match call_registry.remove(&call_id) {
                                    Some(s) => s,
                                    None => {
                                        let err = ServerMessage::CallError {
                                            call_id: Some(call_id.clone()),
                                            code: "CALL_NOT_FOUND".to_string(),
                                            message: "Call not found or already ended".to_string(),
                                        };
                                        if let Ok(json) = err.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                        continue;
                                    }
                                };
                                if state.target_user_id != conn.user_id {
                                    call_registry.insert(state);
                                    let err = ServerMessage::CallError {
                                        call_id: Some(call_id),
                                        code: "FORBIDDEN".to_string(),
                                        message: "Not authorized".to_string(),
                                    };
                                    if let Ok(json) = err.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                    continue;
                                }
                                let rejected = ServerMessage::CallRejected {
                                    call_id: call_id.clone(),
                                    target_user_id: state.target_user_id.clone(),
                                };
                                let admin_conns = registry.get_user_connections(&state.admin_user_id);
                                broadcaster.send_to_connections(&admin_conns, rejected);
                                if let Some(ref nats) = nats_clone {
                                    let payload = serde_json::json!({
                                        "call_id": call_id,
                                        "admin_user_id": state.admin_user_id,
                                        "user_id": state.target_user_id,
                                        "event": "rejected"
                                    });
                                    let _ = nats.publish("admin_call.events".to_string(), payload.to_string().into()).await;
                                }
                            }
                            ClientMessage::CallEnd { call_id } => {
                                let conn = match registry.get(&conn_id) {
                                    Some(c) => c,
                                    None => {
                                        let err = ServerMessage::CallError {
                                            call_id: Some(call_id.clone()),
                                            code: "NOT_AUTHENTICATED".to_string(),
                                            message: "Must authenticate first".to_string(),
                                        };
                                        if let Ok(json) = err.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                        continue;
                                    }
                                };
                                let state = match call_registry.remove(&call_id) {
                                    Some(s) => s,
                                    None => {
                                        let err = ServerMessage::CallError {
                                            call_id: Some(call_id.clone()),
                                            code: "CALL_NOT_FOUND".to_string(),
                                            message: "Call not found or already ended".to_string(),
                                        };
                                        if let Ok(json) = err.to_json() {
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }
                                        continue;
                                    }
                                };
                                let is_admin = conn.user_id == state.admin_user_id;
                                if conn.user_id != state.admin_user_id && conn.user_id != state.target_user_id {
                                    call_registry.insert(state);
                                    let err = ServerMessage::CallError {
                                        call_id: Some(call_id),
                                        code: "FORBIDDEN".to_string(),
                                        message: "Not a participant in this call".to_string(),
                                    };
                                    if let Ok(json) = err.to_json() {
                                        let _ = response_tx_clone.send(Message::Text(json));
                                    }
                                    continue;
                                }
                                let ended_by = if is_admin { "admin" } else { "user" }.to_string();
                                let ended = ServerMessage::CallEnded {
                                    call_id: call_id.clone(),
                                    ended_by: ended_by.clone(),
                                };
                                let admin_conns = registry.get_user_connections(&state.admin_user_id);
                                broadcaster.send_to_connections(&admin_conns, ended.clone());
                                let user_conns = registry.get_user_connections(&state.target_user_id);
                                broadcaster.send_to_connections(&user_conns, ended);
                                if let Some(ref nats) = nats_clone {
                                    let payload = serde_json::json!({
                                        "call_id": call_id,
                                        "admin_user_id": state.admin_user_id,
                                        "user_id": state.target_user_id,
                                        "event": "ended",
                                        "ended_by": ended_by
                                    });
                                    let _ = nats.publish("admin_call.events".to_string(), payload.to_string().into()).await;
                                }
                            }
                            ClientMessage::CallWebrtcOffer { call_id, sdp } => {
                                let conn = match registry.get(&conn_id) {
                                    Some(c) => c,
                                    None => continue,
                                };
                                let state = match call_registry.get(&call_id) {
                                    Some(s) => s,
                                    None => continue,
                                };
                                if conn.user_id != state.admin_user_id && conn.user_id != state.target_user_id {
                                    continue;
                                }
                                let other_id = if conn.user_id == state.admin_user_id {
                                    state.target_user_id.clone()
                                } else {
                                    state.admin_user_id.clone()
                                };
                                let msg = ServerMessage::CallWebrtcOffer {
                                    call_id: call_id.clone(),
                                    sdp: sdp.clone(),
                                };
                                broadcaster.send_to_connections(&registry.get_user_connections(&other_id), msg);
                            }
                            ClientMessage::CallWebrtcAnswer { call_id, sdp } => {
                                let conn = match registry.get(&conn_id) {
                                    Some(c) => c,
                                    None => continue,
                                };
                                let state = match call_registry.get(&call_id) {
                                    Some(s) => s,
                                    None => continue,
                                };
                                if conn.user_id != state.admin_user_id && conn.user_id != state.target_user_id {
                                    continue;
                                }
                                let other_id = if conn.user_id == state.admin_user_id {
                                    state.target_user_id.clone()
                                } else {
                                    state.admin_user_id.clone()
                                };
                                let msg = ServerMessage::CallWebrtcAnswer {
                                    call_id: call_id.clone(),
                                    sdp: sdp.clone(),
                                };
                                broadcaster.send_to_connections(&registry.get_user_connections(&other_id), msg);
                            }
                            ClientMessage::CallWebrtcIce { call_id, candidate } => {
                                let conn = match registry.get(&conn_id) {
                                    Some(c) => c,
                                    None => continue,
                                };
                                let state = match call_registry.get(&call_id) {
                                    Some(s) => s,
                                    None => continue,
                                };
                                if conn.user_id != state.admin_user_id && conn.user_id != state.target_user_id {
                                    continue;
                                }
                                let other_id = if conn.user_id == state.admin_user_id {
                                    state.target_user_id.clone()
                                } else {
                                    state.admin_user_id.clone()
                                };
                                let msg = ServerMessage::CallWebrtcIce {
                                    call_id: call_id.clone(),
                                    candidate: candidate.clone(),
                                };
                                broadcaster.send_to_connections(&registry.get_user_connections(&other_id), msg);
                            }
                        }
                    }
                    Message::Close(_) => {
                        break;
                    }
                    Message::Ping(data) => {
                        if response_tx_clone.send(Message::Pong(data)).is_err() {
                            break;
                        }
                    }
                    Message::Pong(_) => {
                        registry.update_heartbeat(conn_id);
                    }
                    _ => {}
                }
            }
        });

        // Wait for either task to complete
        tokio::select! {
            _ = &mut send_task => {
                recv_task.abort();
            }
            _ = &mut recv_task => {
                send_task.abort();
            }
        }

        // Cleanup
        let registry_cleanup = self.registry.clone();
        let broadcaster_cleanup = self.broadcaster.clone();
        broadcaster_cleanup.unregister_connection(conn_id);
        registry_cleanup.unregister(conn_id);
        info!("Connection {} closed", conn_id);
    }
}

