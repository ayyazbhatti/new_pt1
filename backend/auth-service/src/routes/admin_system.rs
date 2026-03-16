//! Admin system stats API: read host-collected stats JSON (disk, memory, Docker) for the System page.

use axum::{
    extract::{State, Extension},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde_json::Value;
use sqlx::PgPool;
use std::env;
use std::path::PathBuf;
use tracing::warn;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

fn permission_denied_to_response(e: permission_check::PermissionDenied) -> (StatusCode, Json<Value>) {
    (
        e.status,
        Json(serde_json::json!({ "error": { "code": e.code, "message": e.message } })),
    )
}

pub fn create_admin_system_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/stats", get(get_system_stats))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_system_stats(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    permission_check::check_permission(&pool, &claims, "system:view")
        .await
        .map_err(permission_denied_to_response)?;

    let path: PathBuf = env::var("SYSTEM_STATS_FILE")
        .unwrap_or_else(|_| "/host-stats/system-stats.json".to_string())
        .into();
    if path.as_os_str().is_empty() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": { "code": "STATS_UNAVAILABLE", "message": "System stats not configured (STATS_FILE not set)" }
            })),
        ));
    }

    let contents = match tokio::fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to read system stats file {}: {}", path.display(), e);
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": { "code": "STATS_UNAVAILABLE", "message": "Stats file unavailable or not yet populated" }
                })),
            ));
        }
    };

    let value: Value = match serde_json::from_str(&contents) {
        Ok(v) => v,
        Err(e) => {
            warn!("Invalid JSON in system stats file: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": { "code": "INVALID_STATS", "message": "Invalid stats format" }
                })),
            ));
        }
    };

    Ok(Json(value))
}
