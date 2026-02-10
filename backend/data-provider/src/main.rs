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
    let redis = RedisClient::new(&config.redis_url).await?;

    // Initialize components
    let feed = Arc::new(BinanceFeed::new(config.binance_ws_url.clone()));
    let markup_engine = MarkupEngine::new(redis);
    let broadcaster = Arc::new(Broadcaster::new(markup_engine));
    let validator = Arc::new(SymbolValidator::new(50));
    let rate_limiter = Arc::new(RateLimiter::new(60, 100));

    // Track subscribed symbols dynamically
    let subscribed_symbols: Arc<tokio::sync::RwLock<std::collections::HashSet<String>>> = 
        Arc::new(tokio::sync::RwLock::new(std::collections::HashSet::new()));

    // Subscribe to initial symbols (example)
    let initial_symbols = vec!["BTCUSDT", "ETHUSDT", "EURUSD"];
    for symbol in initial_symbols {
        feed.subscribe_symbol(symbol).await?;
        validator.enable_symbol(symbol.to_string());
        subscribed_symbols.write().await.insert(symbol.to_string());
    }

    // Price update loop - dynamically broadcast for all subscribed symbols
    let feed_clone = feed.clone();
    let broadcaster_clone = broadcaster.clone();
    let subscribed_symbols_clone = subscribed_symbols.clone();
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
                if let Some(price_state) = feed_clone.get_price(symbol).await {
                    debug!("🔄 Broadcasting price for {}: bid={}, ask={}", symbol, price_state.bid, price_state.ask);
                    broadcaster_clone
                        .broadcast_price(symbol, Some("default"), price_state.bid, price_state.ask)
                        .await;
                } else {
                    debug!("⚠️  No price data available for {}", symbol);
                }
            }
        }
    });

    // Start WebSocket server
    let ws_addr = format!("0.0.0.0:{}", config.ws_port);
    let broadcaster_ws = broadcaster.clone();
    let validator_ws = validator.clone();
    let rate_limiter_ws = rate_limiter.clone();

    let feed_ws = feed.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::stream::ws_server::start_ws_server(
            &ws_addr,
            broadcaster_ws,
            validator_ws,
            rate_limiter_ws,
            Some(feed_ws),
            Some(subscribed_symbols.clone()),
        )
        .await
        {
            error!("WebSocket server error: {}", e);
        }
    });

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

