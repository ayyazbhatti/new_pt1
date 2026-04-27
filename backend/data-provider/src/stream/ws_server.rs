use crate::stream::broadcaster::{Broadcaster, PriceTick};
use crate::validation::symbol_validation::{RateLimiter, SymbolValidator};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream as TokioTcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

#[derive(Debug, Serialize, Deserialize)]
struct SubscribeMessage {
    action: String,
    symbols: Vec<String>,
    group: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

pub async fn start_ws_server(
    addr: &str,
    broadcaster: Arc<Broadcaster>,
    validator: Arc<SymbolValidator>,
    rate_limiter: Arc<RateLimiter>,
    feed: Option<Arc<crate::feeds::feed_router::FeedRouter>>,
    subscribed_symbols: Option<Arc<tokio::sync::RwLock<std::collections::HashSet<String>>>>,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    info!("✅ WebSocket server listening on {}", addr);

    while let Ok((stream, addr)) = listener.accept().await {
        let broadcaster_clone = broadcaster.clone();
        let validator_clone = validator.clone();
        let rate_limiter_clone = rate_limiter.clone();
        let feed_clone = feed.clone();
        let global_subscribed_symbols_clone = subscribed_symbols.clone();

        tokio::spawn(async move {
            if let Err(e) = handle_connection(
                stream,
                broadcaster_clone,
                validator_clone,
                rate_limiter_clone,
                feed_clone,
                global_subscribed_symbols_clone,
            )
            .await
            {
                error!("Error handling connection from {}: {}", addr, e);
            }
        });
    }

    Ok(())
}

async fn handle_connection(
    stream: TokioTcpStream,
    broadcaster: Arc<Broadcaster>,
    validator: Arc<SymbolValidator>,
    rate_limiter: Arc<RateLimiter>,
    feed: Option<Arc<crate::feeds::feed_router::FeedRouter>>,
    global_subscribed_symbols: Option<Arc<tokio::sync::RwLock<std::collections::HashSet<String>>>>,
) -> anyhow::Result<()> {
    info!("🔌 Accepting WebSocket connection...");
    let ws_stream = accept_async(stream).await?;
    info!("✅ WebSocket handshake successful");
    let (mut sender, mut receiver) = ws_stream.split();

    let mut subscribed_symbols: HashSet<String> = HashSet::new();
    let mut receivers: Vec<broadcast::Receiver<PriceTick>> = Vec::new();
    let mut default_group: Option<String> = None;

    // Send welcome message
    let welcome = serde_json::json!({
        "type": "welcome",
        "message": "Connected to price stream"
    });
    let _ = sender.send(Message::Text(welcome.to_string())).await;

    // Handle incoming messages and forward ticks
    loop {
        tokio::select! {
            // Handle incoming WebSocket messages
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        info!("📨 Received WebSocket message: {}", text);
                        match handle_message(
                            &text,
                            &mut subscribed_symbols,
                            &mut receivers,
                            &broadcaster,
                            &validator,
                            &rate_limiter,
                            &mut default_group,
                            feed.as_ref(),
                            global_subscribed_symbols.as_ref(),
                        )
                        .await
                        {
                            Ok(response_opt) => {
                                // Send response if provided
                                if let Some(response) = response_opt {
                                    let _ = sender
                                        .send(Message::Text(serde_json::to_string(&response).unwrap()))
                                        .await;
                                }
                            }
                            Err(e) => {
                                let error = ErrorResponse {
                                    error: e,
                                    code: "INVALID_MESSAGE".to_string(),
                                };
                                let _ = sender
                                    .send(Message::Text(serde_json::to_string(&error).unwrap()))
                                    .await;
                            }
                        }
                    }
                    Some(Ok(Message::Close(close_frame))) => {
                        if let Some(frame) = close_frame {
                            info!("🔌 WebSocket closed by client. Code: {:?}, Reason: {:?}",
                                frame.code,
                                &frame.reason);
                        } else {
                            info!("🔌 WebSocket closed by client (no close frame)");
                        }
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = sender.send(Message::Pong(data)).await;
                    }
                    Some(Err(e)) => {
                        error!("❌ WebSocket error: {}", e);
                        break;
                    }
                    None => {
                        info!("🔌 WebSocket stream ended (None received)");
                        break;
                    }
                    _ => {}
                }
            }
            // Forward price ticks from subscribed rooms
            _ = async {
                // Check all receivers for available messages
                for rx in &mut receivers {
                    // Use try_recv to avoid blocking, but add a small delay to prevent busy-waiting
                    match rx.try_recv() {
                        Ok(tick) => {
                            let json = serde_json::to_string(&tick).unwrap();
                            debug!("📤 Sending tick to client: {}", json);
                            if sender.send(Message::Text(json)).await.is_err() {
                                return;
                            }
                        }
                        Err(tokio::sync::broadcast::error::TryRecvError::Empty) => {
                            // No message available, continue to next receiver
                            continue;
                        }
                        Err(tokio::sync::broadcast::error::TryRecvError::Lagged(_)) => {
                            // Lagged behind, continue
                            continue;
                        }
                        Err(tokio::sync::broadcast::error::TryRecvError::Closed) => {
                            // Receiver closed, will be cleaned up
                            continue;
                        }
                    }
                }
                // Small delay to prevent busy-waiting
                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
            } => {}
        }
    }

    info!("Client disconnected");
    Ok(())
}

async fn handle_message(
    text: &str,
    subscribed_symbols: &mut HashSet<String>,
    receivers: &mut Vec<broadcast::Receiver<PriceTick>>,
    broadcaster: &Broadcaster,
    validator: &SymbolValidator,
    rate_limiter: &RateLimiter,
    default_group: &mut Option<String>,
    feed: Option<&Arc<crate::feeds::feed_router::FeedRouter>>,
    subscribed_symbols_global: Option<&Arc<tokio::sync::RwLock<std::collections::HashSet<String>>>>,
) -> Result<Option<serde_json::Value>, String> {
    info!("🔍 Parsing subscription message: {}", text);
    let msg: SubscribeMessage = serde_json::from_str(text).map_err(|e| {
        warn!("❌ Failed to parse message: {} - Error: {}", text, e);
        format!("Invalid message format: {}", e)
    })?;
    info!(
        "✅ Parsed message - action: {}, symbols: {:?}",
        msg.action, msg.symbols
    );

    match msg.action.as_str() {
        "subscribe" => {
            // Rate limit check
            if !rate_limiter.check_rate_limit("subscribe") {
                return Err("Rate limit exceeded".to_string());
            }

            // Check symbol count limit (but allow enabling new symbols dynamically)
            if msg.symbols.len() > validator.max_symbols_per_connection() {
                return Err(format!(
                    "Too many symbols: {} (max: {})",
                    msg.symbols.len(),
                    validator.max_symbols_per_connection()
                ));
            }

            // Store default group if provided
            let group_for_subscription = if let Some(group) = &msg.group {
                *default_group = Some(group.clone());
                Some(group.as_str())
            } else {
                default_group.as_ref().map(|s| s.as_str())
            };

            for symbol in &msg.symbols {
                let symbol_upper = symbol.to_uppercase();

                // Enable symbol in validator if not already enabled (allow dynamic enabling)
                if !validator.is_symbol_enabled(&symbol_upper) {
                    info!("🔓 Enabling symbol in validator: {}", symbol_upper);
                    validator.enable_symbol(symbol_upper.clone());
                }

                let room = if let Some(grp) = group_for_subscription {
                    format!("group:{}:symbol:{}", grp, symbol_upper)
                } else {
                    format!("symbol:{}", symbol_upper)
                };

                info!(
                    "🔔 Client subscribing to room: '{}' for symbol: {}",
                    room, symbol_upper
                );
                let receiver = broadcaster.subscribe_room(room.clone());
                receivers.push(receiver);
                subscribed_symbols.insert(symbol_upper.clone());

                // Dynamically subscribe to Binance feed if not already subscribed
                if let Some(feed_ref) = feed {
                    if let Some(global_symbols) = subscribed_symbols_global {
                        let mut global = global_symbols.write().await;
                        if !global.contains(&symbol_upper) {
                            info!(
                                "📡 Subscribing upstream feed for new symbol: {}",
                                symbol_upper
                            );
                            if let Err(e) = feed_ref.subscribe_symbol(&symbol_upper).await {
                                warn!("Failed to subscribe upstream for {}: {}", symbol_upper, e);
                            } else {
                                global.insert(symbol_upper.clone());
                                info!("✅ Successfully subscribed upstream for: {}", symbol_upper);
                            }
                        }
                    }
                }
            }

            info!(
                "✅ Subscribed to {} symbols: {:?}",
                msg.symbols.len(),
                msg.symbols
            );

            // Send confirmation response
            let response = serde_json::json!({
                "type": "subscribed",
                "symbols": msg.symbols
            });
            Ok(Some(response))
        }
        "unsubscribe" => {
            for symbol in &msg.symbols {
                subscribed_symbols.remove(symbol);
            }
            Ok(None)
        }
        _ => Err("Unknown action".to_string()),
    }
}
