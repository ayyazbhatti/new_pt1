//! Terminal price snapshot: same Redis keys as live ticks (`prices:SYMBOL:group_id` via order-engine),
//! so a full page reload can hydrate quotes without showing $0.00 (WebSocket cannot stay open across a browser refresh).

use axum::{
    extract::{Query, State},
    response::Json,
    routing::get,
    Extension, Router,
};
use axum::http::StatusCode;
use chrono::Utc;
use serde::Serialize;
use sqlx::PgPool;

use crate::middleware::auth_middleware;
use crate::routes::deposits::get_price_from_redis_conn;
use crate::routes::orders::OrdersState;
use crate::utils::jwt::Claims;

const MAX_SYMBOLS: usize = 500;

#[derive(serde::Deserialize, Debug)]
pub struct TerminalPricesQuery {
    /// Comma-separated list (e.g. EURUSD,BTCUSD)
    pub symbols: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPriceItem {
    pub symbol: String,
    pub bid: String,
    pub ask: String,
    pub ts: i64,
}

/// GET /v1/terminal/prices?symbols=EURUSD,BTCUSD
/// User's `group_id` from JWT; reads same Redis state as the gateway (order-engine per-group tick writes).
async fn get_terminal_prices(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(orders_state): Extension<OrdersState>,
    Query(q): Query<TerminalPricesQuery>,
) -> Result<Json<Vec<TerminalPriceItem>>, StatusCode> {
    let group_id = claims.group_id.map(|g| g.to_string()).unwrap_or_default();

    let raw = q.symbols.as_deref().unwrap_or("");
    let symbols: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty())
        .take(MAX_SYMBOLS)
        .collect();
    if symbols.is_empty() {
        return Ok(Json(vec![]));
    }

    let now_ms = Utc::now().timestamp_millis();
    let mut conn = orders_state
        .redis
        .get()
        .await
        .map_err(|e| {
            tracing::error!("terminal_prices: redis pool error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let mut out: Vec<TerminalPriceItem> = Vec::with_capacity(symbols.len());
    for sym in symbols {
        if let Some((bid, ask)) = get_price_from_redis_conn(&mut conn, &sym, &group_id).await {
            out.push(TerminalPriceItem {
                symbol: sym,
                bid: bid.to_string(),
                ask: ask.to_string(),
                ts: now_ms,
            });
        }
    }

    Ok(Json(out))
}

pub fn create_terminal_prices_router(pool: PgPool, orders_state: OrdersState) -> Router<PgPool> {
    Router::new()
        .route("/prices", get(get_terminal_prices))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(Extension(orders_state))
        .with_state(pool)
}
