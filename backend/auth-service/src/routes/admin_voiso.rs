//! Admin Voiso API: proxy for Click2Call so the API key stays server-side.

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use tracing::{error, info};
use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;

/// Allow if role is admin/super_admin or user has call:view from their permission profile.
async fn check_call_permission(
    pool: &PgPool,
    claims: &Claims,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!("Voiso: failed to get permission profile: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
            )
        })?;
    let Some(pid) = profile_id else {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "No permission profile assigned" } })),
        ));
    };
    let has: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM permission_profile_grants WHERE profile_id = $1 AND permission_key = 'call:view')",
    )
    .bind(pid)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        error!("Voiso: failed to check call permission: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    if !has {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Missing permission: call:view" } })),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Click2CallRequest {
    /// Voiso agent extension (e.g. "1007"), not the caller ID phone number.
    pub agent: String,
    /// Destination number in E.164 without leading + (e.g. "393511775043").
    pub number: String,
}

/// POST /api/admin/voiso/click2call — proxy to Voiso Click2Call API (API key server-side).
async fn post_click2call(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<Click2CallRequest>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_call_permission(&pool, &claims).await?;

    let agent = body.agent.trim();
    let number = body.number.trim().replace('+', "").replace([' ', '-', '(', ')'], "");
    if agent.is_empty() || number.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "code": "VALIDATION", "message": "agent and number are required. number: E.164 without +" }
            })),
        ));
    }

    let api_key = match std::env::var("VOISO_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            error!("VOISO_API_KEY is not set");
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "error": { "code": "CONFIG", "message": "Voiso is not configured (VOISO_API_KEY)" }
                })),
            ));
        }
    };

    let base_url = std::env::var("VOISO_CLICK2CALL_URL")
        .unwrap_or_else(|_| "https://cc-ams03.voiso.com/api/v1".to_string());
    let url = format!("{}/{}/click2call", base_url.trim_end_matches('/'), api_key);

    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .form(&[("agent", agent), ("number", &number)])
        .send()
        .await
        .map_err(|e| {
            error!("Voiso Click2Call request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": { "code": "UPSTREAM", "message": e.to_string() }
                })),
            )
        })?;

    let status = res.status();
    if status.is_success() || status.as_u16() == 204 {
        info!("Voiso Click2Call initiated: agent={}, number=***", agent);
        return Ok(StatusCode::NO_CONTENT);
    }

    let body_text = res.text().await.unwrap_or_default();
    error!("Voiso Click2Call error: status={}, body={}", status, body_text);
    Err((
        StatusCode::BAD_GATEWAY,
        Json(serde_json::json!({
            "error": {
                "code": "VOISO_ERROR",
                "message": format!("Voiso returned {}: {}", status, body_text)
            }
        })),
    ))
}

pub fn create_admin_voiso_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/click2call", post(post_click2call))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
