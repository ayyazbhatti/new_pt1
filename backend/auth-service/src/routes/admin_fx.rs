//! Admin FX rates cache visibility and manual refresh.

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use sqlx::PgPool;
use std::sync::Arc;

use crate::middleware::auth_middleware;
use crate::redis_pool::RedisPool;
use crate::services::fx_rates::{self, FxRatesApiPayload};
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Clone)]
pub struct FxRatesExtensions {
    pub redis: Arc<RedisPool>,
    pub http: reqwest::Client,
}

fn perm_err(e: permission_check::PermissionDenied) -> (StatusCode, Json<serde_json::Value>) {
    (
        e.status,
        Json(serde_json::json!({
            "error": { "code": e.code, "message": e.message }
        })),
    )
}

async fn get_fx_rates(
    State(pool): State<PgPool>,
    Extension(fx): Extension<FxRatesExtensions>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<FxRatesApiPayload>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "settings:view")
        .await
        .map_err(perm_err)?;
    let snap = match fx_rates::get_cached_snapshot(fx.redis.as_ref()).await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("get_cached_snapshot: {}", e);
            return Ok(Json(fx_rates::empty_fx_api_payload()));
        }
    };
    let Some(s) = snap else {
        return Ok(Json(fx_rates::empty_fx_api_payload()));
    };
    Ok(Json(fx_rates::snapshot_to_api_payload(&s)))
}

async fn post_refresh_fx_rates(
    State(pool): State<PgPool>,
    Extension(fx): Extension<FxRatesExtensions>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<FxRatesApiPayload>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "settings:edit")
        .await
        .map_err(perm_err)?;
    let snap = fx_rates::fetch_and_cache(fx.redis.as_ref(), &fx.http)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": { "code": "FX_REFRESH_FAILED", "message": e.to_string() }
                })),
            )
        })?;
    Ok(Json(fx_rates::snapshot_to_api_payload(&snap)))
}

pub fn create_admin_fx_router(pool: PgPool, redis: Arc<RedisPool>, http: reqwest::Client) -> Router<PgPool> {
    Router::new()
        .route("/", get(get_fx_rates))
        .route("/refresh", post(post_refresh_fx_rates))
        .layer(Extension(FxRatesExtensions { redis, http }))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
