use axum::{
    routing::{get, post},
    Router,
    middleware,
};
use sqlx::PgPool;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::{info, error};

mod handlers;
mod persistence;
mod deposits;
mod auth;
mod auth_routes;

#[derive(Clone)]
struct AppState {
    nats: async_nats::Client,
    db: PgPool,
    redis: redis::Client,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("core-api=info,tower_http=info")
        .json()
        .init();

    let config = common::config::AppConfig::from_env()
        .map_err(|e| format!("Config error: {}", e))?;

    info!("Connecting to database...");
    let db = PgPool::connect(&config.database_url).await?;
    info!("Connected to database");

    info!("Connecting to NATS at {}", config.nats_url);
    let nats = async_nats::connect(&config.nats_url).await?;
    info!("Connected to NATS");

    info!("Connecting to Redis at {}", config.redis_url);
    let redis = redis::Client::open(config.redis_url)?;
    info!("Connected to Redis");

    let state = AppState {
        nats: nats.clone(),
        db,
        redis,
    };

    // Start persistence consumer
    let persistence_state = state.clone();
    tokio::spawn(async move {
        info!("🚀 Spawning persistence consumer task...");
        persistence::consume_events(persistence_state).await;
        error!("❌ Persistence consumer task exited unexpectedly!");
    });

    // Build API routes
    let public_routes = Router::new()
        .route("/health", get(handlers::health))
        .nest("/api/auth", auth_routes::create_auth_router())
        .with_state(state.clone());

    let protected_routes = Router::new()
        .route("/v1/orders", axum::routing::get(handlers::list_orders).post(handlers::place_order))
        .route("/v1/orders/:id/cancel", post(handlers::cancel_order))
        .route("/v1/symbols", get(handlers::list_symbols))
        .route("/v1/users/:id/risk", get(handlers::get_user_risk))
        .route("/v1/users/:id/positions", get(handlers::get_user_positions))
        // Admin routes for frontend compatibility
        .route("/api/admin/symbols", get(handlers::list_symbols_admin))
        // Deposit endpoints (protected with JWT auth)
        .route("/api/deposits/request", post(deposits::create_deposit_request))
        .route("/api/wallet/balance", get(deposits::get_wallet_balance))
        .route("/api/admin/deposits", get(deposits::list_deposits))
        .route("/api/admin/deposits/:id/approve", post(deposits::approve_deposit))
        .route("/api/notifications", get(deposits::get_notifications))
        .layer(middleware::from_fn(auth::auth_middleware));

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3004".to_string());
    let addr = format!("0.0.0.0:{}", port);
    info!("Core API server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

