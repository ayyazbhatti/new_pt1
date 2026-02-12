mod cache;
mod config;
mod feeds;
mod health;
mod pricing;
mod stream;
mod validation;

use crate::cache::redis_client::RedisClient;
use crate::config::Config;
use crate::feeds::binance_feed::BinanceFeed;
use crate::pricing::markup_engine::MarkupEngine;
use crate::stream::broadcaster::Broadcaster;
use crate::health::health_routes::create_health_router;
use crate::validation::symbol_validation::{RateLimiter, SymbolValidator};
use axum::Router;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::mpsc;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;
use tracing::{debug, error, info, warn};
use tracing_subscriber;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load env
    dotenv::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "data_provider=debug,tower_http=debug".into()),
        )
        .init();

    let config = Config::from_env()?;
    let start_time = SystemTime::now();

    info!("🚀 Starting Data Provider Server");
    info!("   Region: {}", config.server_region);
    info!("   WS Port: {}", config.ws_port);
    info!("   HTTP Port: {}", config.http_port);

    // Initialize Redis
    let redis = Arc::new(RedisClient::new(&config.redis_url).await?);
    let redis_for_pubsub = redis.clone();

    // Connect to NATS for order-engine
    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".to_string());
    let nats = match async_nats::connect(&nats_url).await {
        Ok(client) => {
            info!("✅ Connected to NATS at {}", nats_url);
            Some(Arc::new(client))
        }
        Err(e) => {
            warn!("⚠️  Failed to connect to NATS: {}. Tick publishing to order-engine will be disabled.", e);
            None
        }
    };
    let nats_for_ticks = nats.clone();

    // Initialize components
    let feed = Arc::new(BinanceFeed::new(config.binance_ws_url.clone()));
    let markup_engine = MarkupEngine::new(redis.clone());
    let broadcaster = Arc::new(Broadcaster::new(markup_engine));
    let validator = Arc::new(SymbolValidator::new(50));
    let rate_limiter = Arc::new(RateLimiter::new(60, 100));

    // Track subscribed symbols dynamically
    let subscribed_symbols: Arc<tokio::sync::RwLock<std::collections::HashSet<String>>> = 
        Arc::new(tokio::sync::RwLock::new(std::collections::HashSet::new()));

    // Subscribe to initial symbols (example)
    let initial_symbols = vec!["BTCUSDT", "ETHUSDT", "EURUSD", "BNBUSDT", "DOGEUSDT"];
    for symbol in initial_symbols {
        feed.subscribe_symbol(symbol).await?;
        validator.enable_symbol(symbol.to_string());
        subscribed_symbols.write().await.insert(symbol.to_string());
    }

    // Price update loop - dynamically broadcast for all subscribed symbols
    let feed_clone = feed.clone();
    let broadcaster_clone = broadcaster.clone();
    let markup_engine_clone = Arc::new(MarkupEngine::new(redis.clone()));
    let subscribed_symbols_clone = subscribed_symbols.clone();
    let nats_for_ticks_clone = nats_for_ticks.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            interval.tick().await;
            
            // Get all subscribed symbols dynamically
            let symbols_to_broadcast: Vec<String> = {
                subscribed_symbols_clone.read().await.iter().cloned().collect()
            };
            
            // Broadcast prices for all subscribed symbols
            for symbol in &symbols_to_broadcast {
                // Ensure symbol is subscribed to feed
                if !subscribed_symbols_clone.read().await.contains(symbol) {
                    if let Err(e) = feed_clone.subscribe_symbol(symbol).await {
                        warn!("Failed to subscribe to symbol {}: {}", symbol, e);
                        continue;
                    }
                    subscribed_symbols_clone.write().await.insert(symbol.clone());
                    info!("📈 Subscribed to new symbol: {}", symbol);
                }
                
                if let Some(price_state) = feed_clone.get_price(symbol).await {
                    debug!("🔄 Broadcasting price for {}: bid={}, ask={}", symbol, price_state.bid, price_state.ask);
                    
                    // Get final prices after markup (for NATS publishing)
                    let (final_bid, final_ask) = {
                        // Apply markup for "default" group
                        match markup_engine_clone.apply_markup(symbol, "default", price_state.bid, price_state.ask).await {
                            Some(prices) => prices,
                            None => (price_state.bid, price_state.ask),
                        }
                    };
                    
                    // Broadcast internally to WebSocket clients
                    broadcaster_clone
                        .broadcast_price(symbol, Some("default"), price_state.bid, price_state.ask)
                        .await;
                    
                    // Also publish to Redis for ws-gateway
                    let tick_json = serde_json::json!({
                        "symbol": symbol,
                        "bid": price_state.bid.to_string(),
                        "ask": price_state.ask.to_string(),
                        "ts": chrono::Utc::now().timestamp_millis(),
                    });
                    if let Err(e) = redis_for_pubsub.publish_price_update("price:ticks", &tick_json.to_string()).await {
                        warn!("Failed to publish price to Redis: {}", e);
                    }

                    // Publish to NATS for order-engine (if connected)
                    if let Some(nats_client) = &nats_for_ticks_clone {
                        use contracts::{TickEvent, VersionedMessage};
                        use chrono::Utc;
                        
                        let tick_event = TickEvent {
                            symbol: symbol.clone(),
                            bid: final_bid,
                            ask: final_ask,
                            ts: Utc::now(),
                            seq: chrono::Utc::now().timestamp_millis() as u64,
                        };
                        let subject = format!("ticks.{}", symbol);
                        let subject_clone = subject.clone();
                        // VersionedMessage::new() expects message TYPE, not subject
                        match VersionedMessage::new("tick", &tick_event) {
                            Ok(msg) => {
                                let payload = match serde_json::to_vec(&msg) {
                                    Ok(p) => p,
                                    Err(e) => {
                                        warn!("Failed to serialize tick event for {}: {}", symbol, e);
                                        continue;
                                    }
                                };
                                if let Err(e) = nats_client.publish(subject, payload.into()).await {
                                    warn!("Failed to publish tick to NATS for {}: {}", symbol, e);
                                } else {
                                    info!("📤 Published tick to NATS: {} on subject {}", symbol, subject_clone);
                                }
                            }
                            Err(e) => {
                                warn!("Failed to create versioned message for {}: {}", symbol, e);
                            }
                        }
                    }
                } else {
                    debug!("⚠️  No price data available for {}", symbol);
                }
            }
        }
    });

    // Start WebSocket server
    let ws_addr = format!("0.0.0.0:{}", config.ws_port);
    info!("🚀 Preparing to start WebSocket server on {}", ws_addr);
    let broadcaster_ws = broadcaster.clone();
    let validator_ws = validator.clone();
    let rate_limiter_ws = rate_limiter.clone();

    let feed_ws = feed.clone();
    let ws_addr_clone = ws_addr.clone();
    info!("📡 Spawning WebSocket server task...");
    tokio::spawn(async move {
        info!("🚀 Starting WebSocket server on {}", ws_addr_clone);
        match crate::stream::ws_server::start_ws_server(
            &ws_addr,
            broadcaster_ws,
            validator_ws,
            rate_limiter_ws,
            Some(feed_ws),
            Some(subscribed_symbols.clone()),
        )
        .await
        {
            Ok(_) => {
                info!("✅ WebSocket server started successfully");
            }
            Err(e) => {
                error!("❌ WebSocket server error: {}", e);
                error!("Failed to start WebSocket server on {}", ws_addr);
            }
        }
    });
    info!("✅ WebSocket server task spawned");

    // Create health router
    let health_app = create_health_router(
        broadcaster.clone(),
        feed.clone(),
        config.server_region.clone(),
        start_time,
    );

    // Start HTTP server
    let http_addr = format!("0.0.0.0:{}", config.http_port);
    let http_listener = tokio::net::TcpListener::bind(&http_addr).await?;
    info!("✅ HTTP server listening on {}", http_addr);

    axum::serve(
        http_listener,
        health_app.layer(ServiceBuilder::new().layer(TraceLayer::new_for_http())),
    )
    .await?;

    Ok(())
}

