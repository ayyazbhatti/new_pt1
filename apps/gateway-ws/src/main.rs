use axum::{
    extract::{ws::WebSocketUpgrade, State},
    response::Response,
    routing::get,
    Router,
};
use contracts::{
    events::{BalanceUpdatedEvent, OrderUpdatedEvent, PositionUpdatedEvent, TickEvent},
    messages::{WsClientMessage, WsServerMessage},
    VersionedMessage,
};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tower_http::cors::CorsLayer;
use tracing::{error, info, warn};
use uuid::Uuid;
use rust_decimal::Decimal;
use chrono::{DateTime, Utc};

mod auth;
mod session;

#[derive(Clone)]
struct AppState {
    nats: async_nats::Client,
    sessions: Arc<RwLock<HashMap<Uuid, session::Session>>>,
    senders: Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<axum::extract::ws::Message>>>>,
    jwt_secret: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("gateway-ws=debug")
        .json()
        .init();

    let config = common::config::AppConfig::from_env()
        .map_err(|e| format!("Config error: {}", e))?;

    let jwt_secret = std::env::var("JWT_SECRET")
        .map_err(|_| "JWT_SECRET must be set (use same value as auth-service for WebSocket auth)")?;

    info!("JWT_SECRET is set (real-time balance and WebSocket auth enabled)");
    info!("Connecting to NATS at {}", config.nats_url);
    let nats = async_nats::connect(&config.nats_url).await?;
    info!("Connected to NATS");

    let state = AppState {
        nats: nats.clone(),
        sessions: Arc::new(RwLock::new(HashMap::new())),
        senders: Arc::new(RwLock::new(HashMap::new())),
        jwt_secret,
    };

    // Start NATS event forwarder
    let forwarder_state = state.clone();
    tokio::spawn(forward_events(forwarder_state));
    
    // Start tick forwarder
    let tick_forwarder_state = state.clone();
    tokio::spawn(forward_ticks(tick_forwarder_state));

    let app = Router::new()
        .route("/ws", get(handle_websocket))
        .route("/health", get(health))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3003".to_string());
    let addr = format!("0.0.0.0:{}", port);
    info!("Gateway WebSocket server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn handle_websocket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: axum::extract::ws::WebSocket, state: AppState) {
    use futures_util::StreamExt;
    let (mut sender, mut receiver) = socket.split();
    let session_id = Uuid::new_v4();
    let mut session = session::Session::new(session_id);

    info!("New WebSocket connection: {}", session_id);

    // Create channel for sending messages to this session
    let (tx, mut rx) = mpsc::unbounded_channel::<axum::extract::ws::Message>();
    let tx_clone = tx.clone();
    
    // Store sender
    {
        let mut senders = state.senders.write().await;
        senders.insert(session_id, tx);
    }

    // Add session
    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id, session.clone());
    }
    
    // Spawn task to forward messages from channel to WebSocket
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = sender.send(msg).await {
                error!("Failed to send WebSocket message: {}", e);
                break;
            }
        }
    });

    // Handle incoming messages
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(axum::extract::ws::Message::Text(text)) => {
                info!("Received WebSocket message: {}", text);
                if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                    match client_msg {
                        WsClientMessage::ActionSubscribe { symbols, .. } => {
                            // Handle new format: {"action":"subscribe","symbols":["BTCUSD"],"group":"default"}
                            for symbol in symbols {
                                let topic = format!("ticks:{}", symbol.to_uppercase());
                                session.subscriptions.insert(topic.clone());
                                info!("Session {} subscribed to {} (from symbol {})", session_id, topic, symbol);
                            }
                            // Update session in shared state
                            {
                                let mut sessions = state.sessions.write().await;
                                if let Some(s) = sessions.get_mut(&session_id) {
                                    *s = session.clone();
                                }
                            }
                        }
                        WsClientMessage::ActionUnsubscribe { symbols, .. } => {
                            // Handle unsubscribe with symbols array
                            for symbol in symbols {
                                let topic = format!("ticks:{}", symbol.to_uppercase());
                                session.subscriptions.remove(&topic);
                                info!("Session {} unsubscribed from {} (from symbol {})", session_id, topic, symbol);
                            }
                            // Update session in shared state
                            {
                                let mut sessions = state.sessions.write().await;
                                if let Some(s) = sessions.get_mut(&session_id) {
                                    *s = session.clone();
                                }
                            }
                        }
                        WsClientMessage::TypeAuth { token, .. } | WsClientMessage::OpAuth { token, .. } => {
                            match auth::verify_access_token(token.trim(), &state.jwt_secret) {
                                Ok(user_id) => {
                                    session.user_id = Some(user_id);
                                    {
                                        let mut sessions = state.sessions.write().await;
                                        if let Some(s) = sessions.get_mut(&session_id) {
                                            *s = session.clone();
                                        }
                                    }
                                    info!("Session {} authenticated as user {}", session_id, user_id);
                                    let response = WsServerMessage::AuthSuccess {
                                        user_id: user_id.to_string(),
                                        group_id: Some("default".to_string()),
                                    };
                                    if let Ok(json) = serde_json::to_string(&response) {
                                        let _ = tx_clone.send(axum::extract::ws::Message::Text(json));
                                    } else {
                                        error!("Failed to serialize auth_success response");
                                    }
                                }
                                Err(e) => {
                                    warn!("Session {} auth failed: {}", session_id, e);
                                    let response = WsServerMessage::AuthError { error: e };
                                    if let Ok(json) = serde_json::to_string(&response) {
                                        let _ = tx_clone.send(axum::extract::ws::Message::Text(json));
                                    }
                                }
                            }
                        }
                        WsClientMessage::OpSubscribe { topic, .. } => {
                            session.subscriptions.insert(topic.clone());
                            info!("Session {} subscribed to {}", session_id, topic);
                            
                            let response = WsServerMessage::Subscribed { topic };
                            if let Ok(json) = serde_json::to_string(&response) {
                                let _ = tx_clone.send(axum::extract::ws::Message::Text(json));
                            }
                        }
                        WsClientMessage::OpUnsubscribe { topic, .. } => {
                            session.subscriptions.remove(&topic);
                            info!("Session {} unsubscribed from {}", session_id, topic);
                            
                            let response = WsServerMessage::Unsubscribed { topic };
                            if let Ok(json) = serde_json::to_string(&response) {
                                let _ = tx_clone.send(axum::extract::ws::Message::Text(json));
                            }
                        }
                        WsClientMessage::TypeSubscribe { channels, symbols, .. } => {
                            // Handle frontend format: {"type":"subscribe","channels":["positions","orders"]}
                            if let Some(channels) = channels {
                                for channel in channels {
                                    session.subscriptions.insert(channel.clone());
                                    info!("Session {} subscribed to channel: {}", session_id, channel);
                                }
                            }
                            if let Some(symbols) = symbols {
                                for symbol in symbols {
                                    let topic = format!("ticks:{}", symbol.to_uppercase());
                                    session.subscriptions.insert(topic.clone());
                                    info!("Session {} subscribed to {} (from symbol {})", session_id, topic, symbol);
                                }
                            }
                            // Update session in shared state
                            {
                                let mut sessions = state.sessions.write().await;
                                if let Some(s) = sessions.get_mut(&session_id) {
                                    *s = session.clone();
                                }
                            }
                            info!("Session {} subscription updated: {:?}", session_id, session.subscriptions);
                        }
                    }
                } else {
                    error!("Failed to parse WebSocket message: {}", text);
                }
            }
            Ok(axum::extract::ws::Message::Close(_)) => {
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    // Remove session and sender
    {
        let mut sessions = state.sessions.write().await;
        sessions.remove(&session_id);
        let mut senders = state.senders.write().await;
        senders.remove(&session_id);
    }

    info!("WebSocket connection closed: {}", session_id);
}

async fn forward_events(state: AppState) {
    use futures_util::StreamExt;
    use contracts::enums::OrderStatus;
    
    // Subscribe to both event patterns: evt.* and event.*
    let mut sub_evt = state.nats.subscribe("evt.*".to_string()).await
        .expect("Failed to subscribe to evt.* events");
    let mut sub_event = state.nats.subscribe("event.*".to_string()).await
        .expect("Failed to subscribe to event.* events");
    // Subscribe to deposit request events
    let mut sub_deposit = state.nats.subscribe("deposit.request.*".to_string()).await
        .expect("Failed to subscribe to deposit.request.* events");
    // Subscribe to wallet balance updates
    let mut sub_wallet = state.nats.subscribe("wallet.balance.updated".to_string()).await
        .expect("Failed to subscribe to wallet.balance.updated events");
    // Subscribe to chat (user + support) so real-time chat works
    let mut sub_chat = state.nats.subscribe("chat.>".to_string()).await
        .expect("Failed to subscribe to chat.>");

    info!("Event forwarder started - subscribed to evt.*, event.*, deposit.request.*, wallet.balance.updated, and chat.>");

    loop {
        tokio::select! {
            msg_opt = sub_evt.next() => {
                if let Some(msg) = msg_opt {
                    process_event_message(msg, &state).await;
                }
            }
            msg_opt = sub_event.next() => {
                if let Some(msg) = msg_opt {
                    process_event_message(msg, &state).await;
                }
            }
            msg_opt = sub_deposit.next() => {
                if let Some(msg) = msg_opt {
                    process_event_message(msg, &state).await;
                }
            }
            msg_opt = sub_wallet.next() => {
                if let Some(msg) = msg_opt {
                    process_event_message(msg, &state).await;
                }
            }
            msg_opt = sub_chat.next() => {
                if let Some(msg) = msg_opt {
                    process_chat_message(msg, &state).await;
                }
            }
        }
    }
}

async fn process_chat_message(msg: async_nats::Message, state: &AppState) {
    let bytes = msg.payload.to_vec();
    let subject = msg.subject.as_str();
    info!("📨 [chat] NATS message received subject={} size={} (forwarding to all WS clients)", subject, bytes.len());

    let event_json = match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(v) => v,
        Err(e) => {
            error!("Chat forwarder: invalid JSON on {}: {}", subject, e);
            return;
        }
    };
    let json = match serde_json::to_string(&event_json) {
        Ok(j) => j,
        Err(e) => {
            error!("Chat forwarder: failed to serialize: {}", e);
            return;
        }
    };
    let senders = state.senders.read().await;
    let mut count: u32 = 0;
    for (_sid, tx) in senders.iter() {
        if tx.send(axum::extract::ws::Message::Text(json.clone())).is_ok() {
            count += 1;
        }
    }
    if count == 0 {
        warn!("📨 [chat] Forwarded {} to 0 sessions (no WebSocket clients connected?)", subject);
    } else {
        info!("📨 [chat] Forwarded {} to {} session(s)", subject, count);
    }
}

async fn process_event_message(msg: async_nats::Message, state: &AppState) {
    use contracts::enums::OrderStatus;
    
    let bytes = msg.payload.to_vec();
    info!("📥 process_event_message: Received NATS message, subject: {}, payload size: {} bytes", msg.subject, bytes.len());
    
    if let Ok(versioned) = serde_json::from_slice::<VersionedMessage>(&bytes) {
        info!("📥 process_event_message: Parsed VersionedMessage, type: {}", versioned.r#type);
        let sessions = state.sessions.read().await;
        let senders = state.senders.read().await;
        
        info!("📥 process_event_message: Checking {} sessions", sessions.len());
        
        for (session_id, session) in sessions.iter() {
            if let Some(user_id) = session.user_id {
                let mut should_send = false;
                let mut server_msg: Option<WsServerMessage> = None;
                
                match versioned.r#type.as_str() {
                    "evt.order.updated" | "event.order.updated" => {
                        if let Ok(event) = versioned.deserialize_payload::<OrderUpdatedEvent>() {
                            if event.user_id == user_id && session.subscriptions.contains("orders") {
                                should_send = true;
                                // Send as order_update to match frontend expectation
                                server_msg = Some(WsServerMessage::OrderUpdate { payload: event });
                            }
                        }
                    }
                    "event.order.filled" => {
                        // Handle OrderFilledEvent and convert to OrderUpdatedEvent
                        // OrderFilledEvent structure from order-engine
                        #[derive(serde::Deserialize)]
                        struct OrderFilledEvent {
                            order_id: Uuid,
                            user_id: Uuid,
                            symbol: String,
                            side: contracts::enums::Side,
                            filled_size: Decimal,
                            average_fill_price: Decimal,
                            position_id: Option<Uuid>,
                            correlation_id: String,
                            ts: DateTime<Utc>,
                        }
                        
                        if let Ok(filled_event) = versioned.deserialize_payload::<OrderFilledEvent>() {
                            if filled_event.user_id == user_id {
                                // Send order update if subscribed to orders
                                if session.subscriptions.contains("orders") {
                                    should_send = true;
                                    // Convert OrderFilledEvent to OrderUpdatedEvent
                                    let order_updated = OrderUpdatedEvent {
                                        order_id: filled_event.order_id,
                                        user_id: filled_event.user_id,
                                        status: OrderStatus::Filled,
                                        filled_size: filled_event.filled_size,
                                        avg_fill_price: Some(filled_event.average_fill_price),
                                        reason: None,
                                        ts: filled_event.ts,
                                    };
                                    server_msg = Some(WsServerMessage::OrderUpdate { payload: order_updated });
                                    info!("✅ Converted order.filled to order_update for order {} - sending to frontend", filled_event.order_id);
                                }
                                
                                // Also trigger position refresh if position was created/updated
                                if filled_event.position_id.is_some() && session.subscriptions.contains("positions") {
                                    info!("📊 Order {} filled, position {} created - position update should follow", 
                                          filled_event.order_id, filled_event.position_id.unwrap());
                                }
                            }
                        }
                    }
                    "evt.position.updated" | "event.position.updated" => {
                        if let Ok(event) = versioned.deserialize_payload::<PositionUpdatedEvent>() {
                            if event.user_id == user_id && session.subscriptions.contains("positions") {
                                should_send = true;
                                server_msg = Some(WsServerMessage::Position { payload: event });
                            }
                        }
                    }
                    "event.position.closed" => {
                        // Order-engine publishes this when a position is closed (manual or SL/TP).
                        // Frontend BottomDock expects type "position_update" with status CLOSED to remove from list.
                        if let Ok(payload) = serde_json::from_value::<serde_json::Value>(versioned.payload.clone()) {
                            let event_user_id_str = payload.get("user_id").and_then(|v| v.as_str());
                            if event_user_id_str.map(|s| Uuid::parse_str(s).ok()) == Some(Some(user_id))
                                && session.subscriptions.contains("positions")
                            {
                                let position_id = payload.get("position_id").and_then(|v| v.as_str()).unwrap_or("");
                                let symbol = payload.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
                                let side = payload.get("side").and_then(|v| v.as_str()).unwrap_or("");
                                let closed_size = payload.get("closed_size").and_then(|v| v.as_str()).unwrap_or("0");
                                let trigger_reason = payload.get("trigger_reason").and_then(|v| v.as_str());
                                let position_update = serde_json::json!({
                                    "type": "position_update",
                                    "position_id": position_id,
                                    "status": "CLOSED",
                                    "symbol": symbol,
                                    "side": side,
                                    "quantity": closed_size,
                                    "trigger_reason": trigger_reason,
                                });
                                if let Some(tx) = senders.get(session_id) {
                                    if let Ok(json) = serde_json::to_string(&position_update) {
                                        let _ = tx.send(axum::extract::ws::Message::Text(json));
                                        info!("✅ Forwarded position closed to session {} (position {})", session_id, position_id);
                                    }
                                }
                            }
                        }
                    }
                    "evt.balance.updated" | "event.balance.updated" => {
                        if let Ok(event) = versioned.deserialize_payload::<BalanceUpdatedEvent>() {
                            if event.user_id == user_id && session.subscriptions.contains("balances") {
                                should_send = true;
                                server_msg = Some(WsServerMessage::Balance { payload: event });
                            }
                        }
                    }
                    "wallet.balance.updated" => {
                        // Wallet balance updates should go to the specific user
                        // Payload may have "userId" (camelCase) or "user_id" (snake_case)
                        info!("📨 Received wallet.balance.updated event from NATS");
                        if let Ok(mut payload_json) = serde_json::from_value::<serde_json::Value>(versioned.payload.clone()) {
                            let event_user_id_str = payload_json
                                .get("userId")
                                .or_else(|| payload_json.get("user_id"))
                                .and_then(|v| v.as_str());
                            if let Some(event_user_id_str) = event_user_id_str {
                                info!("📨 wallet.balance.updated event userId: {}", event_user_id_str);
                                if let Ok(event_user_id) = Uuid::parse_str(event_user_id_str) {
                                    let has_subscription = session.subscriptions.contains("balances")
                                        || session.subscriptions.contains("wallet")
                                        || session.subscriptions.contains("notifications");
                                    info!("📨 Checking session {} (user: {:?}): event_user_id={}, has_subscription={}, subscriptions={:?}",
                                          session_id, user_id, event_user_id, has_subscription, session.subscriptions);

                                    if event_user_id == user_id && has_subscription {
                                        // Ensure payload has "balance" for frontend (some publishers send only "available")
                                        if payload_json.get("balance").is_none() {
                                            let available_val = payload_json.get("available").cloned();
                                            if let (Some(av), Some(obj)) = (available_val, payload_json.as_object_mut()) {
                                                obj.insert("balance".to_string(), av);
                                            }
                                        }
                                        let event_json = serde_json::json!({
                                            "type": "wallet.balance.updated",
                                            "payload": payload_json
                                        });
                                        if let Some(tx) = senders.get(session_id) {
                                            if let Ok(json) = serde_json::to_string(&event_json) {
                                                let _ = tx.send(axum::extract::ws::Message::Text(json));
                                                info!("✅ Forwarded wallet.balance.updated to session {} (user: {})", session_id, user_id);
                                            } else {
                                                error!("❌ Failed to serialize wallet.balance.updated message");
                                            }
                                        } else {
                                            warn!("⚠️ No sender channel found for session {}", session_id);
                                        }
                                    } else {
                                        if event_user_id != user_id {
                                            info!("⏭️ Skipping wallet.balance.updated - user mismatch: event_user_id={}, session_user_id={:?}", event_user_id, user_id);
                                        } else if !has_subscription {
                                            info!("⏭️ Skipping wallet.balance.updated - user not subscribed to balances/wallet. Session subscriptions: {:?}", session.subscriptions);
                                        }
                                    }
                                } else {
                                    error!("❌ Failed to parse userId from wallet.balance.updated event: {}", event_user_id_str);
                                }
                            } else {
                                error!("❌ wallet.balance.updated event missing userId/user_id field");
                            }
                        } else {
                            error!("❌ Failed to parse wallet.balance.updated payload as JSON");
                        }
                    }
                    "deposit.request.created" => {
                        // Deposit request events should go to all admin users
                        // Send to all sessions that have "deposits" or "notifications" subscription
                        // (Admins should subscribe to these channels)
                        if session.subscriptions.contains("deposits") || session.subscriptions.contains("notifications") {
                            // The payload is a JSON object, not a struct - extract it directly
                            if let Ok(payload_json) = serde_json::from_value::<serde_json::Value>(versioned.payload.clone()) {
                                // Send as a generic event message matching frontend format
                                let event_json = serde_json::json!({
                                    "type": "deposit.request.created",
                                    "payload": payload_json
                                });
                                // Send directly to this session
                                if let Some(tx) = senders.get(session_id) {
                                    if let Ok(json) = serde_json::to_string(&event_json) {
                                        let _ = tx.send(axum::extract::ws::Message::Text(json));
                                        info!("✅ Forwarded deposit.request.created to session {} (user: {:?})", session_id, user_id);
                                    }
                                }
                            } else {
                                warn!("Failed to parse deposit.request.created payload for session {}", session_id);
                            }
                        }
                    }
                    _ => {}
                }
                
                if should_send {
                    if let Some(msg) = server_msg {
                        if let Some(tx) = senders.get(session_id) {
                            if let Ok(json) = serde_json::to_string(&msg) {
                                let _ = tx.send(axum::extract::ws::Message::Text(json));
                            }
                        }
                    }
                }
            }
        }
    }
}

async fn forward_ticks(state: AppState) {
    use futures_util::StreamExt;
    
    info!("Starting tick forwarder - subscribing to ticks.*");
    let mut sub = state.nats.subscribe("ticks.*".to_string()).await
        .expect("Failed to subscribe to ticks");

    info!("Tick forwarder started and subscribed to ticks.*");

    while let Some(msg) = sub.next().await {
        let bytes = msg.payload.to_vec();
        if let Ok(versioned) = serde_json::from_slice::<VersionedMessage>(&bytes) {
            if let Ok(tick) = versioned.deserialize_payload::<TickEvent>() {
                let sessions = state.sessions.read().await;
                let senders = state.senders.read().await;
                
                // Forward to all sessions subscribed to this symbol's tick
                // Handle both formats: BTCUSDT (from Binance) and BTCUSD (internal format)
                let tick_topic_binance = format!("ticks:{}", tick.symbol);
                // Convert BTCUSDT -> BTCUSD for matching
                let tick_topic_internal = if tick.symbol.ends_with("USDT") {
                    format!("ticks:{}", tick.symbol.replace("USDT", "USD"))
                } else {
                    tick_topic_binance.clone()
                };
                info!("Received tick for {} (topics: {} / {}), checking {} sessions", tick.symbol, tick_topic_binance, tick_topic_internal, sessions.len());
                
                let mut forwarded_count = 0;
                for (session_id, session) in sessions.iter() {
                    info!("Session {} subscriptions: {:?}", session_id, session.subscriptions);
                    // Check both formats
                    if session.subscriptions.contains(&tick_topic_binance) || session.subscriptions.contains(&tick_topic_internal) {
                        if let Some(tx) = senders.get(session_id) {
                            // Frontend expects: {"type":"tick","symbol":"BTCUSD","bid":...,"ask":...,"ts":...}
                            // Convert BTCUSDT -> BTCUSD for frontend
                            let frontend_symbol = if tick.symbol.ends_with("USDT") {
                                tick.symbol.replace("USDT", "USD")
                            } else {
                                tick.symbol.clone()
                            };
                            let tick_msg = serde_json::json!({
                                "type": "tick",
                                "symbol": frontend_symbol,
                                "bid": tick.bid.to_string(),
                                "ask": tick.ask.to_string(),
                                "ts": tick.ts.timestamp_millis(),
                            });
                            if let Ok(json) = serde_json::to_string(&tick_msg) {
                                info!("Forwarding tick to session {}: {} (bid={}, ask={})", session_id, tick.symbol, tick.bid, tick.ask);
                                if tx.send(axum::extract::ws::Message::Text(json)).is_ok() {
                                    forwarded_count += 1;
                                } else {
                                    error!("Failed to send tick to session {}", session_id);
                                }
                            } else {
                                error!("Failed to serialize tick message");
                            }
                        } else {
                            warn!("No sender channel for session {}", session_id);
                        }
                    }
                }
                if forwarded_count == 0 {
                    info!("No active subscriptions for tick topics: {} / {}", tick_topic_binance, tick_topic_internal);
                }
            } else {
                error!("Failed to deserialize tick from versioned message");
            }
        } else {
            error!("Failed to parse versioned message from NATS");
        }
    }
}

async fn health() -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!({
        "status": "ok",
        "service": "gateway-ws"
    }))
}

