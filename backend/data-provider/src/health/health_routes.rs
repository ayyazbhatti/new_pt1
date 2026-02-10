use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::feeds::binance_feed::BinanceFeed;
use crate::stream::broadcaster::Broadcaster;

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    timestamp: u64,
    region: String,
    uptime_secs: u64,
}

#[derive(Serialize)]
struct MetricsResponse {
    rooms: usize,
    active_symbols: usize,
    uptime_secs: u64,
}

#[derive(Serialize)]
struct FeedStatusResponse {
    status: String,
    provider: String,
    connected_symbols: Vec<String>,
}

pub fn create_health_router(
    broadcaster: Arc<Broadcaster>,
    feed: Arc<BinanceFeed>,
    region: String,
    start_time: SystemTime,
) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/feed/status", get(feed_status_handler))
        .with_state((broadcaster, feed, region, start_time))
}

async fn health_handler(
    State((_, _, region, start_time)): State<(Arc<Broadcaster>, Arc<BinanceFeed>, String, SystemTime)>,
) -> Result<Json<HealthResponse>, StatusCode> {
    let uptime = start_time
        .elapsed()
        .unwrap_or(Duration::from_secs(0))
        .as_secs();

    Ok(Json(HealthResponse {
        status: "healthy".to_string(),
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        region,
        uptime_secs: uptime,
    }))
}

async fn metrics_handler(
    State((broadcaster, feed, _, _)): State<(Arc<Broadcaster>, Arc<BinanceFeed>, String, SystemTime)>,
) -> Result<Json<MetricsResponse>, StatusCode> {
    let rooms = broadcaster.get_room_count();
    
    // Get active symbols from feed (simplified - would need to expose this)
    let active_symbols = 0; // TODO: Expose from feed

    let uptime = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    Ok(Json(MetricsResponse {
        rooms,
        active_symbols,
        uptime_secs: uptime,
    }))
}

async fn feed_status_handler(
    State((_, feed, _, _)): State<(Arc<Broadcaster>, Arc<BinanceFeed>, String, SystemTime)>,
) -> Result<Json<FeedStatusResponse>, StatusCode> {
    // TODO: Get actual connected symbols from feed
    Ok(Json(FeedStatusResponse {
        status: "connected".to_string(),
        provider: "binance".to_string(),
        connected_symbols: vec![],
    }))
}

