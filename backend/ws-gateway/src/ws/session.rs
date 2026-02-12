use crate::auth::jwt::{Claims, JwtAuth};
use crate::state::connection_registry::{Connection, ConnectionRegistry};
use crate::validation::message_validation::MessageValidator;
use crate::ws::protocol::{ClientMessage, ServerMessage};
use crate::stream::broadcaster::Broadcaster;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;
use tracing::{error, info, warn};
use anyhow::Result;

pub struct Session {
    conn_id: Uuid,
    registry: Arc<ConnectionRegistry>,
    validator: Arc<MessageValidator>,
    jwt_auth: Arc<JwtAuth>,
    broadcaster: Arc<Broadcaster>,
}

impl Session {
    pub fn new(
        registry: Arc<ConnectionRegistry>,
        validator: Arc<MessageValidator>,
        jwt_auth: Arc<JwtAuth>,
        broadcaster: Arc<Broadcaster>,
    ) -> Self {
        let conn_id = Uuid::new_v4();
        info!("New WebSocket connection established: {}", conn_id);
        Self {
            conn_id,
            registry,
            validator,
            jwt_auth,
            broadcaster,
        }
    }

    pub async fn handle(&mut self, socket: WebSocket) {
        let (mut sender, mut receiver) = socket.split();

        // Create channel for this connection
        let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();
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
        let response_tx_clone = response_tx.clone();

        let mut recv_task = tokio::spawn(async move {
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
                                info!("Auth message received from connection {}, validating token...", conn_id);
                                match jwt_auth.validate_token(&token) {
                                    Ok(claims) => {
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
                                            subscriptions: Arc::new(dashmap::DashMap::new()),
                                            last_heartbeat: std::time::Instant::now(),
                                        };
                                        registry.register(conn);

                                        // Send auth success
                                        let success_msg = ServerMessage::AuthSuccess {
                                            user_id: claims.sub.clone(),
                                            group_id: claims.group_id.clone(),
                                        };
                                        if let Ok(json) = success_msg.to_json() {
                                            info!("Sending auth_success to connection {}", conn_id);
                                            let _ = response_tx_clone.send(Message::Text(json));
                                        }

                                        info!("Connection {} authenticated as user {}", conn_id, claims.sub);
                                    }
                                    Err(e) => {
                                        warn!("Token validation failed for connection {}: {}", conn_id, e);
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
                                if let Some(conn) = registry.get(&conn_id) {
                                    for symbol in &symbols {
                                        registry.subscribe_symbol(conn_id, symbol.clone(), channels.clone());
                                    }

                                    let success_msg = ServerMessage::Subscribed {
                                        symbols: symbols.clone(),
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
                                for symbol in &symbols {
                                    registry.unsubscribe_symbol(conn_id, symbol);
                                }

                                let success_msg = ServerMessage::Unsubscribed {
                                    symbols: symbols.clone(),
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

