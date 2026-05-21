//! Authenticated (non-admin-permission) FX rates snapshot for display currency.

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use sqlx::PgPool;
use std::sync::Arc;

use crate::middleware::auth_middleware;
use crate::redis_pool::RedisPool;
use crate::services::fx_rates::{self, FxRatesApiPayload};

async fn get_current_rates(
    Extension(redis): Extension<Arc<RedisPool>>,
    State(_pool): State<PgPool>,
) -> Result<Json<FxRatesApiPayload>, StatusCode> {
    let snap = fx_rates::get_cached_snapshot(redis.as_ref())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(match snap {
        Some(s) => fx_rates::snapshot_to_api_payload(&s),
        None => fx_rates::empty_fx_api_payload(),
    }))
}

pub fn create_public_fx_router(pool: PgPool, redis: Arc<RedisPool>) -> Router<PgPool> {
    Router::new()
        .route("/current", get(get_current_rates))
        .layer(Extension(redis))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
