//! Admin Voiso API: proxy for Click2Call so the API key stays server-side.

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;
use tracing::{error, info};

/// Allow if role is admin/super_admin or user has call:view from their permission profile.
async fn check_call_permission(
    pool: &PgPool,
    claims: &Claims,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT permission_profile_id FROM users WHERE id = $1",
    )
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
            Json(
                serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "No permission profile assigned" } }),
            ),
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
            Json(
                serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Missing permission: call:view" } }),
            ),
        ));
    }
    Ok(())
}

async fn get_voiso_config(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_call_permission(&pool, &claims).await?;
    let row: Option<(String, bool)> = sqlx::query_as(
        r#"
        SELECT panel_url, enabled
        FROM platform_voiso_config
        WHERE singleton_id = 1
        "#,
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Voiso: failed to load panel config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;

    let (panel_url, enabled) = match row {
        Some((url, enabled)) => {
            let panel_url = if url.trim().is_empty() {
                "https://cc-ams03.voiso.com/omnichannel/embedded".to_string()
            } else {
                url.trim().to_string()
            };
            (panel_url, enabled)
        }
        None => (
            "https://cc-ams03.voiso.com/omnichannel/embedded".to_string(),
            true,
        ),
    };

    Ok(Json(serde_json::json!({
        "panelUrl": panel_url,
        "enabled": enabled,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Click2CallRequest {
    /// Voiso agent extension (e.g. "1007"), not the caller ID phone number.
    pub agent: String,
    /// Destination number in E.164 without leading + (e.g. "393511775043").
    pub number: String,
}

#[derive(Debug, Deserialize)]
struct VoisoUser {
    id: Value,
    sip_account: Option<String>,
    sag: Option<String>,
    extension: Option<String>,
}

fn voiso_cluster_base(click2call_url: &str) -> String {
    let url = click2call_url.trim().trim_end_matches('/');
    match url.find("/api/") {
        Some(api_idx) => url[..api_idx].to_string(),
        None => url.to_string(),
    }
}

fn redact_api_key(url: &str, api_key: &str) -> String {
    url.replace(api_key, "***")
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn parse_voiso_users(value: Value) -> Result<Vec<VoisoUser>, String> {
    match value {
        Value::Array(_) => serde_json::from_value(value).map_err(|e| e.to_string()),
        Value::Object(map) => {
            for key in ["data", "users", "items", "results"] {
                if let Some(inner) = map.get(key) {
                    if inner.is_array() {
                        return serde_json::from_value(inner.clone()).map_err(|e| e.to_string());
                    }
                }
            }
            Err(format!(
                "Unexpected users response keys: {:?}",
                map.keys().collect::<Vec<_>>()
            ))
        }
        other => Err(format!("Unexpected users response type: {:?}", other)),
    }
}

async fn resolve_voiso_user_id_by_extension(
    client: &reqwest::Client,
    cluster_base: &str,
    api_key: &str,
    extension: &str,
) -> Result<Option<String>, String> {
    let url = format!("{}/api/v4/users", cluster_base.trim_end_matches('/'));
    let res = client
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Voiso users lookup returned {}: {}", status, body));
    }

    let value: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let users = parse_voiso_users(value)?;
    let ext = extension.trim();
    for user in users {
        if user.extension.as_deref().map(str::trim) == Some(ext)
            || user.sip_account.as_deref().map(str::trim) == Some(ext)
            || user.sag.as_deref().map(str::trim) == Some(ext)
        {
            return Ok(value_to_string(&user.id));
        }
    }
    Ok(None)
}

/// POST /api/admin/voiso/click2call — proxy to Voiso Click2Call API (API key server-side).
async fn post_click2call(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<Click2CallRequest>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    check_call_permission(&pool, &claims).await?;

    let agent = body.agent.trim();
    let number = body
        .number
        .trim()
        .replace('+', "")
        .replace([' ', '-', '(', ')'], "");
    if agent.is_empty() || number.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "code": "VALIDATION", "message": "agent and number are required. number: E.164 without +" }
            })),
        ));
    }

    let db_config: Option<(Option<String>, Option<String>, bool)> = sqlx::query_as(
        r#"
        SELECT api_key, click2call_url, enabled
        FROM platform_voiso_config
        WHERE singleton_id = 1
        "#,
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Voiso: failed to load config: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;

    if matches!(db_config.as_ref(), Some((_, _, false))) {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": { "code": "CONFIG", "message": "Voiso integration is disabled" }
            })),
        ));
    }

    let api_key = match db_config
        .as_ref()
        .and_then(|(key, _, _)| key.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            std::env::var("VOISO_API_KEY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }) {
        Some(k) => k,
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

    let base_url = db_config
        .and_then(|(_, url, _)| url)
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("VOISO_CLICK2CALL_URL").ok())
        .unwrap_or_else(|| "https://cc-ams03.voiso.com/api/v1".to_string());
    let base_url = base_url.trim_end_matches('/').to_string();
    let cluster_base = voiso_cluster_base(&base_url);
    let client = reqwest::Client::new();

    let legacy_url = format!("{}/{}/click2call", base_url, api_key);
    let legacy_res = client
        .post(&legacy_url)
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
    let legacy_status = legacy_res.status();
    if legacy_status.is_success() || legacy_status.as_u16() == 204 {
        info!("Voiso Click2Call initiated: agent={}, number=***", agent);
        return Ok(StatusCode::NO_CONTENT);
    }
    let mut last_status = legacy_status.as_u16();
    let mut last_body = legacy_res.text().await.unwrap_or_default();
    let mut tried = vec![redact_api_key(&legacy_url, &api_key)];

    // Some Voiso clusters do not expose the old key-in-path v1 endpoint.
    // Try the bearer-token v4 variants used by newer Voiso accounts before surfacing the error.
    for url in [
        format!("{}/api/v4/click2call", cluster_base),
        format!("{}/api/v4/calls/click2call", cluster_base),
    ] {
        tried.push(url.clone());
        let res = client
            .post(&url)
            .bearer_auth(&api_key)
            .json(&serde_json::json!({
                "agent": agent,
                "number": number,
                "destination": number,
            }))
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
        last_status = status.as_u16();
        last_body = res.text().await.unwrap_or_default();
    }

    match resolve_voiso_user_id_by_extension(&client, &cluster_base, &api_key, agent).await {
        Ok(Some(user_id)) => {
            let url = format!("{}/api/v4/voice/calls", cluster_base);
            tried.push(url.clone());
            let res = client
                .post(&url)
                .bearer_auth(&api_key)
                .json(&serde_json::json!({
                    "user_id": user_id,
                    "phone_number": number,
                    "caller_id": number,
                }))
                .send()
                .await
                .map_err(|e| {
                    error!("Voiso voice call request failed: {}", e);
                    (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({
                            "error": { "code": "UPSTREAM", "message": e.to_string() }
                        })),
                    )
                })?;
            let status = res.status();
            if status.is_success() || status.as_u16() == 204 {
                info!("Voiso voice call initiated: agent={}, number=***", agent);
                return Ok(StatusCode::NO_CONTENT);
            }
            last_status = status.as_u16();
            last_body = res.text().await.unwrap_or_default();
        }
        Ok(None) => {
            last_body = format!(
                "Could not map extension {} to a Voiso user_id. Verify the agent extension exists in Voiso Users.",
                agent
            );
        }
        Err(e) => {
            last_body = e;
        }
    }

    error!(
        "Voiso Click2Call error: status={}, tried={}, body={}",
        last_status,
        tried.join(", "),
        last_body
    );
    Err((
        StatusCode::BAD_GATEWAY,
        Json(serde_json::json!({
            "error": {
                "code": "VOISO_ERROR",
                "message": format!(
                    "Voiso returned {} after trying supported Click2Call endpoints: {}",
                    last_status,
                    last_body
                )
            }
        })),
    ))
}

pub fn create_admin_voiso_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/config", get(get_voiso_config))
        .route("/click2call", post(post_click2call))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
