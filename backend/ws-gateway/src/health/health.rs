use axum::response::Json;
use axum::routing::get;
use axum::Router;
use serde_json::json;
use std::sync::Arc;
use crate::state::connection_registry::ConnectionRegistry;
use crate::stream::redis_subscriber::RedisSubscriber;

pub fn create_health_router(
    registry: Arc<ConnectionRegistry>,
    redis_subscriber: Arc<RedisSubscriber>,
) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/metrics", get(metrics))
        .with_state((registry, redis_subscriber))
}

async fn health_check(
    axum::extract::State((registry, _redis)): axum::extract::State<(Arc<ConnectionRegistry>, Arc<RedisSubscriber>)>,
) -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "connections": registry.total_connections(),
        "subscriptions": registry.total_subscriptions(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

async fn metrics(
    axum::extract::State((registry, _redis)): axum::extract::State<(Arc<ConnectionRegistry>, Arc<RedisSubscriber>)>,
) -> Json<serde_json::Value> {
    Json(json!({
        "connections": registry.total_connections(),
        "subscriptions": registry.total_subscriptions(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }))
}

