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
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::{error, info};
use anyhow::Result;
use futures_util::StreamExt;

use config::Config;
use ws::server::{AppState, create_router};
use ws::protocol::ServerMessage;
use auth::jwt::JwtAuth;
use state::call_registry::CallRegistry;
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
        "account:summary:updated".to_string(),
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

    // Call registry for admin-call-user signaling
    let call_registry = Arc::new(CallRegistry::new());

    // NATS (optional): for publishing call records to auth-service
    let nats_url = std::env::var("NATS_URL").ok();
    let nats_client = if let Some(ref url) = nats_url {
        match async_nats::connect(url).await {
            Ok(c) => {
                info!("Connected to NATS for call records");
                Some(Arc::new(c))
            }
            Err(e) => {
                info!("NATS not available (call records will not be persisted): {}", e);
                None
            }
        }
    } else {
        None
    };

    // Create app state
    let app_state = AppState {
        registry: registry.clone(),
        validator: validator.clone(),
        jwt_auth: jwt_auth.clone(),
        broadcaster: broadcaster.clone(),
        call_registry: call_registry.clone(),
        redis_url: config.redis.url.clone(),
        nats: nats_client.clone(),
    };

    // NATS chat subscriber: forward chat.support and chat.user.* to the right WebSocket connections
    if let Some(nats) = nats_client {
        let registry_chat = registry.clone();
        let broadcaster_chat = broadcaster.clone();
        tokio::spawn(async move {
            use tracing::{error, info, warn};
            let sub = match nats.subscribe("chat.>".to_string()).await {
                Ok(s) => {
                    info!("Subscribed to NATS chat.> for real-time support chat");
                    s
                }
                Err(e) => {
                    error!("Failed to subscribe to NATS chat.>: {}", e);
                    return;
                }
            };
            let mut msgs = sub;
            while let Some(msg) = msgs.next().await {
                let subject = msg.subject.to_string();
                let body = match std::str::from_utf8(&msg.payload) {
                    Ok(s) => s.to_string(),
                    Err(_) => continue,
                };
                let payload: serde_json::Value = match serde_json::from_str(&body) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("Invalid JSON on {}: {}", subject, e);
                        continue;
                    }
                };
                // Auth-service sends { type: "chat.message", payload: { id, userId, ... } }
                let chat_payload = match payload.get("payload").cloned() {
                    Some(p) => p,
                    None => continue,
                };
                let ws_msg = ServerMessage::ChatMessage {
                    payload: chat_payload,
                };
                let conn_ids: Vec<uuid::Uuid> = if subject == "chat.support" {
                    registry_chat.get_admin_connection_ids()
                } else if subject.starts_with("chat.user.") {
                    let user_id = subject.strip_prefix("chat.user.").unwrap_or("");
                    let mut ids = registry_chat.get_user_connections(user_id);
                    let mut admin_ids = registry_chat.get_admin_connection_ids();
                    ids.append(&mut admin_ids);
                    ids.sort();
                    ids.dedup();
                    ids
                } else {
                    continue;
                };
                if !conn_ids.is_empty() {
                    broadcaster_chat.send_to_connections(&conn_ids, ws_msg);
                }
            }
        });
    }

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

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _parts| {
            origin
                .to_str()
                .map(|s| s.starts_with("http://localhost:") || s.starts_with("http://127.0.0.1:"))
                .unwrap_or(false)
        }))
        .allow_methods([axum::http::Method::GET]);

    let http_app = axum::Router::new()
        .merge(health_app)
        .layer(cors)
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

