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

mod session;

#[derive(Clone)]
struct AppState {
    nats: async_nats::Client,
    sessions: Arc<RwLock<HashMap<Uuid, session::Session>>>,
    senders: Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<axum::extract::ws::Message>>>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("gateway-ws=info")
        .json()
        .init();

    let config = common::config::AppConfig::from_env()
        .map_err(|e| format!("Config error: {}", e))?;

    info!("Connecting to NATS at {}", config.nats_url);
    let nats = async_nats::connect(&config.nats_url).await?;
    info!("Connected to NATS");

    let state = AppState {
        nats: nats.clone(),
        sessions: Arc::new(RwLock::new(HashMap::new())),
        senders: Arc::new(RwLock::new(HashMap::new())),
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
                        WsClientMessage::TypeAuth { token: _, .. } | WsClientMessage::OpAuth { token: _, .. } => {
                            // TODO: Validate JWT token
                            let user_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
                            session.user_id = Some(user_id);
                            info!("Session {} authenticated", session_id);
                            
                            // Send auth_success response
                            let response = WsServerMessage::AuthSuccess {
                                user_id: user_id.to_string(),
                                group_id: Some("default".to_string()),
                            };
                            if let Ok(json) = serde_json::to_string(&response) {
                                info!("Sending auth_success to session {}", session_id);
                                let _ = tx_clone.send(axum::extract::ws::Message::Text(json));
                            } else {
                                error!("Failed to serialize auth_success response");
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

    info!("Event forwarder started - subscribed to evt.* and event.*");

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
        }
    }
}

async fn process_event_message(msg: async_nats::Message, state: &AppState) {
    use contracts::enums::OrderStatus;
    
    let bytes = msg.payload.to_vec();
    if let Ok(versioned) = serde_json::from_slice::<VersionedMessage>(&bytes) {
        let sessions = state.sessions.read().await;
        let senders = state.senders.read().await;
        
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
                    "evt.balance.updated" | "event.balance.updated" => {
                        if let Ok(event) = versioned.deserialize_payload::<BalanceUpdatedEvent>() {
                            if event.user_id == user_id && session.subscriptions.contains("balances") {
                                should_send = true;
                                server_msg = Some(WsServerMessage::Balance { payload: event });
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
    
    let mut sub = state.nats.subscribe("ticks.*".to_string()).await
        .expect("Failed to subscribe to ticks");

    info!("Tick forwarder started");

    while let Some(msg) = sub.next().await {
        let bytes = msg.payload.to_vec();
        if let Ok(versioned) = serde_json::from_slice::<VersionedMessage>(&bytes) {
            if let Ok(tick) = versioned.deserialize_payload::<TickEvent>() {
                let sessions = state.sessions.read().await;
                let senders = state.senders.read().await;
                
                // Forward to all sessions subscribed to this symbol's tick
                let tick_topic = format!("ticks:{}", tick.symbol);
                info!("Received tick for {} (topic: {}), checking {} sessions", tick.symbol, tick_topic, sessions.len());
                
                let mut forwarded_count = 0;
                for (session_id, session) in sessions.iter() {
                    info!("Session {} subscriptions: {:?}", session_id, session.subscriptions);
                    if session.subscriptions.contains(&tick_topic) {
                        if let Some(tx) = senders.get(session_id) {
                            // Frontend expects: {"type":"tick","symbol":"BTCUSD","bid":...,"ask":...,"ts":...}
                            // Not the wrapped payload format
                            let tick_msg = serde_json::json!({
                                "type": "tick",
                                "symbol": tick.symbol,
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
                    info!("No active subscriptions for tick topic: {}", tick_topic);
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

