use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::feeds::aws_feed::AwsFeed;
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

#[derive(Debug, Deserialize)]
pub struct PricesQuery {
    pub symbols: Option<String>,
}

#[derive(Serialize)]
struct PriceItem {
    symbol: String,
    bid: String,
    ask: String,
    ts: u64,
}

pub fn create_health_router(
    broadcaster: Arc<Broadcaster>,
    binance_feed: Arc<BinanceFeed>,
    aws_feed: Option<Arc<AwsFeed>>,
    aws_enabled: bool,
    region: String,
    start_time: SystemTime,
) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/feed/status", get(feed_status_handler))
        .route("/prices", get(prices_handler))
        .with_state((broadcaster, binance_feed, aws_feed, aws_enabled, region, start_time))
}

async fn health_handler(
    State((_, _, _, _, region, start_time)): State<(
        Arc<Broadcaster>,
        Arc<BinanceFeed>,
        Option<Arc<AwsFeed>>,
        bool,
        String,
        SystemTime,
    )>,
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
    State((broadcaster, _binance_feed, _aws_feed, _aws_enabled, _, _)): State<(
        Arc<Broadcaster>,
        Arc<BinanceFeed>,
        Option<Arc<AwsFeed>>,
        bool,
        String,
        SystemTime,
    )>,
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
    State((_, _binance_feed, _aws_feed, aws_enabled, _, _)): State<(
        Arc<Broadcaster>,
        Arc<BinanceFeed>,
        Option<Arc<AwsFeed>>,
        bool,
        String,
        SystemTime,
    )>,
) -> Result<Json<FeedStatusResponse>, StatusCode> {
    // TODO: Get actual connected symbols from feed
    Ok(Json(FeedStatusResponse {
        status: "connected".to_string(),
        provider: if aws_enabled { "aws" } else { "binance" }.to_string(),
        connected_symbols: vec![],
    }))
}

async fn prices_handler(
    State((_, binance_feed, aws_feed, aws_enabled, _, _)): State<(
        Arc<Broadcaster>,
        Arc<BinanceFeed>,
        Option<Arc<AwsFeed>>,
        bool,
        String,
        SystemTime,
    )>,
    Query(query): Query<PricesQuery>,
) -> Result<Json<Vec<PriceItem>>, StatusCode> {
    let symbols: Vec<String> = query
        .symbols
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
        .collect();
    if symbols.is_empty() {
        return Ok(Json(vec![]));
    }
    let mut out = Vec::with_capacity(symbols.len());
    for symbol in symbols {
        let state = if aws_enabled {
            match &aws_feed {
                Some(f) => f.get_price(&symbol).await,
                None => None,
            }
        } else {
            binance_feed.get_price(&symbol).await
        };
        if let Some(state) = state {
            out.push(PriceItem {
                symbol: symbol.clone(),
                bid: state.bid.to_string(),
                ask: state.ask.to_string(),
                ts: state.ts,
            });
        }
    }
    Ok(Json(out))
}

