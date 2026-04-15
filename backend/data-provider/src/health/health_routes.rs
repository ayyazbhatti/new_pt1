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

use crate::feeds::feed_router::{FeedRouter, FeedRouterDiagnostics};
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
    /// Legacy single-provider label; use `router` for detail.
    provider: String,
    /// Legacy field (often empty); prefer `router` counts.
    connected_symbols: Vec<String>,
    router: FeedRouterDiagnostics,
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
    feed: Arc<FeedRouter>,
    region: String,
    start_time: SystemTime,
    mmdps_api_key: Option<String>,
    mmdps_history_base: String,
) -> Router {
    let hist = MmdpsHistoryState {
        api_key: mmdps_api_key,
        base_url: mmdps_history_base,
    };
    Router::new()
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/feed/status", get(feed_status_handler))
        .route("/prices", get(prices_handler))
        .route("/feed/history", get(mmdps_history_handler))
        .with_state((broadcaster, feed, region, start_time, hist))
}

#[derive(Clone)]
struct MmdpsHistoryState {
    api_key: Option<String>,
    base_url: String,
}

async fn health_handler(
    State((_, _, region, start_time, _)): State<(
        Arc<Broadcaster>,
        Arc<FeedRouter>,
        String,
        SystemTime,
        MmdpsHistoryState,
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
    State((broadcaster, feed, _, _, _)): State<(
        Arc<Broadcaster>,
        Arc<FeedRouter>,
        String,
        SystemTime,
        MmdpsHistoryState,
    )>,
) -> Result<Json<MetricsResponse>, StatusCode> {
    let rooms = broadcaster.get_room_count();
    let d = feed.diagnostics().await;
    let active_symbols = d.binance_tracked_symbols + d.mmdps_tracked_symbols;

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
    State((_, feed, _, _, _)): State<(
        Arc<Broadcaster>,
        Arc<FeedRouter>,
        String,
        SystemTime,
        MmdpsHistoryState,
    )>,
) -> Result<Json<FeedStatusResponse>, StatusCode> {
    let diag = feed.diagnostics().await;
    let provider = if diag.mmdps_configured {
        "binance+mmdps".to_string()
    } else {
        "binance".to_string()
    };
    Ok(Json(FeedStatusResponse {
        status: "connected".to_string(),
        provider,
        connected_symbols: vec![],
        router: diag,
    }))
}

async fn prices_handler(
    State((_, feed, _, _, _)): State<(
        Arc<Broadcaster>,
        Arc<FeedRouter>,
        String,
        SystemTime,
        MmdpsHistoryState,
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
        if let Some(state) = feed.get_price(&symbol).await {
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

#[derive(Debug, Deserialize)]
pub struct MmdpsHistoryQuery {
    pub symbol: String,
    pub timeframe: String,
    #[serde(default)]
    pub count: Option<u32>,
}

/// MMDPS `/feed/history` expects MT-style intervals (`M1`, `H1`, `D1`, …). The chart sends Binance-style (`1m`, `1h`, …).
fn mmdps_timeframe_from_query(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return "H1".to_string();
    }
    let upper = t.to_ascii_uppercase();
    if upper.starts_with("MN")
        && upper.len() > 2
        && upper[2..].chars().all(|c| c.is_ascii_digit())
    {
        return upper;
    }
    let mut ch = upper.chars();
    if matches!(ch.next(), Some(c) if matches!(c, 'M' | 'H' | 'D' | 'W'))
        && matches!(ch.next(), Some(c) if c.is_ascii_digit())
    {
        return upper;
    }
    if let Some(num) = t.strip_suffix('m') {
        if num.parse::<u32>().is_ok() {
            return format!("M{}", num);
        }
    }
    if let Some(num) = t.strip_suffix('h') {
        if num.parse::<u32>().is_ok() {
            return format!("H{}", num);
        }
    }
    if let Some(num) = t.strip_suffix('d') {
        if num.parse::<u32>().is_ok() {
            return format!("D{}", num);
        }
    }
    if let Some(num) = t.strip_suffix('w') {
        if num.parse::<u32>().is_ok() {
            return format!("W{}", num);
        }
    }
    if let Some(num) = t.strip_suffix('M') {
        if num.parse::<u32>().is_ok() {
            return format!("MN{}", num);
        }
    }
    upper
}

/// Proxies MMDPS history REST so the browser never sees `MMDPS_API_KEY`.
async fn mmdps_history_handler(
    State((_, _, _, _, hist)): State<(
        Arc<Broadcaster>,
        Arc<FeedRouter>,
        String,
        SystemTime,
        MmdpsHistoryState,
    )>,
    Query(q): Query<MmdpsHistoryQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let key = hist.api_key.as_deref().ok_or(StatusCode::NOT_FOUND)?;
    let count = q.count.unwrap_or(500).clamp(1, 500);
    let timeframe = mmdps_timeframe_from_query(&q.timeframe);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let resp = client
        .get(hist.base_url.trim().to_string())
        .query(&[
            ("api_key", key),
            ("symbol", q.symbol.trim()),
            ("timeframe", timeframe.as_str()),
            ("count", &count.to_string()),
        ])
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    if !resp.status().is_success() {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    Ok(Json(json))
}

#[cfg(test)]
mod mmdps_timeframe_tests {
    use super::mmdps_timeframe_from_query;

    #[test]
    fn maps_binance_style_to_mmdps() {
        assert_eq!(mmdps_timeframe_from_query("1m"), "M1");
        assert_eq!(mmdps_timeframe_from_query("5m"), "M5");
        assert_eq!(mmdps_timeframe_from_query("15m"), "M15");
        assert_eq!(mmdps_timeframe_from_query("1h"), "H1");
        assert_eq!(mmdps_timeframe_from_query("4h"), "H4");
        assert_eq!(mmdps_timeframe_from_query("1d"), "D1");
        assert_eq!(mmdps_timeframe_from_query("1w"), "W1");
        assert_eq!(mmdps_timeframe_from_query("1M"), "MN1");
    }

    #[test]
    fn passes_through_mmdps_native() {
        assert_eq!(mmdps_timeframe_from_query("H1"), "H1");
        assert_eq!(mmdps_timeframe_from_query("M30"), "M30");
        assert_eq!(mmdps_timeframe_from_query("MN1"), "MN1");
    }
}

