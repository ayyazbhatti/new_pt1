mod config;
mod ws;
mod auth;
mod routing;
mod stream;
mod state;
mod validation;
mod metrics;
mod health;

use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info};
use anyhow::Result;

use config::Config;
use ws::server::{AppState, create_router};
use auth::jwt::JwtAuth;
use state::connection_registry::ConnectionRegistry;
use validation::message_validation::MessageValidator;
use stream::redis_subscriber::RedisSubscriber;
use stream::broadcaster::Broadcaster;
use health::health::create_health_router;

#[tokio::main]
async fn main() -> Result<()> {
    // Load environment variables
    dotenv::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ws_gateway=debug,tower_http=debug".into()),
        )
        .init();

    // Load configuration
    let config = Config::from_env()?;
    info!("Configuration loaded");

    // Initialize components
    let registry = Arc::new(ConnectionRegistry::new());
    let validator = Arc::new(MessageValidator::new(config.limits.clone()));
    let jwt_auth = Arc::new(JwtAuth::new(&config.auth.jwt_secret, &config.auth.jwt_issuer));

    // Redis channels to subscribe
    let redis_channels = vec![
        "price:ticks".to_string(),
        "orders:updates".to_string(),
        "positions:updates".to_string(),
        "risk:alerts".to_string(),
        "deposits:requests".to_string(),
        "deposits:approved".to_string(),
        "notifications:push".to_string(),
        "wallet:balance:updated".to_string(),
    ];

    // Create Redis subscriber
    let redis_subscriber = Arc::new(
        RedisSubscriber::new(
            &config.redis.url,
            redis_channels.clone(),
            config.redis.reconnect_interval_secs,
        )
        .await?,
    );

    // Create message channel
    let (message_tx, message_rx) = mpsc::channel(10000);

    // Spawn Redis subscriber task
    let subscriber_sender = redis_subscriber.subscribe();
    tokio::spawn(async move {
        let mut rx = subscriber_sender.subscribe();
        while let Ok((channel, payload)) = rx.recv().await {
            if message_tx.send((channel, payload)).await.is_err() {
                error!("Message channel closed");
                break;
            }
        }
    });

    // Start Redis subscriber
    redis_subscriber.start().await;

    // Create broadcaster (spawns internal task)
    let broadcaster = Arc::new(Broadcaster::new(registry.clone(), message_rx));

    // Create app state
    let app_state = AppState {
        registry: registry.clone(),
        validator: validator.clone(),
        jwt_auth: jwt_auth.clone(),
        broadcaster: broadcaster.clone(),
    };

    // Create WebSocket router
    let ws_app = create_router(app_state);

    // Create health/metrics router
    let health_app = create_health_router(registry.clone(), redis_subscriber.clone());

    // Start WebSocket server
    let ws_addr = format!("{}:{}", config.server.bind_address, config.server.ws_port);
    let ws_listener = tokio::net::TcpListener::bind(&ws_addr).await?;
    info!("🚀 WebSocket server listening on ws://{}", ws_addr);

    let ws_server = axum::serve(ws_listener, ws_app);

    // Start HTTP server (health/metrics)
    let http_addr = format!("{}:{}", config.server.bind_address, config.server.http_port);
    let http_listener = tokio::net::TcpListener::bind(&http_addr).await?;
    info!("📊 HTTP server listening on http://{}", http_addr);

    let http_app = axum::Router::new()
        .merge(health_app)
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let http_server = axum::serve(http_listener, http_app);

    // Spawn heartbeat monitor
    let registry_heartbeat = registry.clone();
    let timeout_secs = config.server.connection_timeout_secs;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            let stale = registry_heartbeat.get_stale_connections(timeout_secs);
            for conn_id in stale {
                info!("Removing stale connection: {}", conn_id);
                registry_heartbeat.unregister(conn_id);
            }
        }
    });

    // Run both servers
    tokio::select! {
        result = ws_server => {
            if let Err(e) = result {
                error!("WebSocket server error: {}", e);
            }
        }
        result = http_server => {
            if let Err(e) = result {
                error!("HTTP server error: {}", e);
            }
        }
    }

    Ok(())
}

