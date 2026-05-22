//! Authenticated session status for terminal (Phase 2). Requires a valid JWT; no extra permission.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Extension, Router,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;

use crate::middleware::auth_middleware;
use crate::services::market_sessions::{self, SessionStatus};
use crate::utils::jwt::Claims;

type SessionsRouteErr = (StatusCode, Json<serde_json::Value>);

fn sessions_json_err(status: StatusCode, code: &'static str, message: impl Into<String>) -> SessionsRouteErr {
    (
        status,
        Json(json!({
            "error": { "code": code, "message": message.into() }
        })),
    )
}

#[derive(Debug, Deserialize)]
pub struct StatusQuery {
    pub symbol: String,
}

#[derive(Debug, Deserialize)]
pub struct BatchStatusQuery {
    /// Comma-separated symbol codes (e.g. `BTCUSDT,EURUSD,AAPL`).
    pub symbols: String,
}

async fn get_session_status_route(
    State(pool): State<PgPool>,
    Extension(_claims): Extension<Claims>,
    Query(q): Query<StatusQuery>,
) -> Result<Json<SessionStatus>, SessionsRouteErr> {
    let code = q.symbol.trim();
    if code.is_empty() {
        return Err(sessions_json_err(
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "symbol query parameter is required",
        ));
    }
    market_sessions::get_session_status_for_symbol_code(&pool, code, Utc::now())
        .await
        .map(Json)
        .map_err(|e| {
            tracing::warn!(symbol = %code, error = %e, "sessions/status: lookup failed");
            match e {
                market_sessions::SessionError::SymbolNotFound => sessions_json_err(
                    StatusCode::NOT_FOUND,
                    "SYMBOL_NOT_FOUND",
                    format!("Symbol not found: {code}"),
                ),
                other => sessions_json_err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "SESSION_STATUS_FAILED",
                    other.to_string(),
                ),
            }
        })
}

async fn get_session_status_batch_route(
    State(pool): State<PgPool>,
    Extension(_claims): Extension<Claims>,
    Query(q): Query<BatchStatusQuery>,
) -> Result<Json<HashMap<String, SessionStatus>>, SessionsRouteErr> {
    let csv = q.symbols.trim();
    if csv.is_empty() {
        return Err(sessions_json_err(
            StatusCode::BAD_REQUEST,
            "BAD_REQUEST",
            "symbols query parameter is required (comma-separated codes)",
        ));
    }
    let now = Utc::now();
    let mut out: HashMap<String, SessionStatus> = HashMap::new();
    for raw in csv.split(',') {
        let code = raw.trim();
        if code.is_empty() {
            continue;
        }
        if let Ok(st) = market_sessions::get_session_status_for_symbol_code(&pool, code, now).await {
            out.insert(code.to_string(), st);
        }
    }
    Ok(Json(out))
}

pub fn create_sessions_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/status", get(get_session_status_route))
        .route("/status/batch", get(get_session_status_batch_route))
        .layer(axum::middleware::from_fn_with_state(
            pool.clone(),
            auth_middleware,
        ))
        .with_state(pool)
}
