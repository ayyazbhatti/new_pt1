//! Admin settings routes: email configuration (GET/PUT), send test email (POST), email templates (GET/PUT),
//! data provider integrations (GET/PUT).

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put},
    Router,
};
use contracts::DataProvidersConfig;
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;

use tracing::error;
use crate::middleware::auth_middleware;
use crate::routes::auth::send_welcome_email_after_signup;
use crate::services::email_config_service::{
    send_test_email_sync, EmailConfigService, UpdateEmailConfigRequest,
};
use crate::services::data_provider_integrations_service::DataProviderIntegrationsService;
use crate::services::email_templates_service::{
    EmailTemplatesService, UpdateEmailTemplateRequest,
};
use crate::redis_pool::RedisPool;
use crate::utils::jwt::Claims;

/// Allow if role is admin or user has the given permission from their permission profile.
async fn check_settings_permission(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role == "admin" {
        return Ok(());
    }
    let profile_id: Option<uuid::Uuid> = sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!("Failed to get permission profile for settings check: {}", e);
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
        "SELECT EXISTS(SELECT 1 FROM permission_profile_grants WHERE profile_id = $1 AND permission_key = $2)",
    )
    .bind(pid)
    .bind(permission)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        error!("Failed to check settings permission: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    if !has {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": format!("Missing permission: {}", permission) } })),
        ));
    }
    Ok(())
}

pub fn create_admin_settings_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/email-config", get(get_email_config).put(put_email_config))
        .route("/email-config/test", post(post_test_email))
        .route("/email-templates", get(get_email_templates))
        .route("/email-templates/:id", put(put_email_template))
        .route("/resend-welcome-email", post(post_resend_welcome_email))
        .route("/data-providers", get(get_data_providers).put(put_data_providers))
        .route(
            "/data-providers/test-ws",
            post(post_test_data_providers_ws),
        )
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_data_providers(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:view").await?;
    let svc = DataProviderIntegrationsService::new(pool);
    let cfg = svc.get().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    let cfg = DataProviderIntegrationsService::merge_with_defaults(cfg);
    Ok(Json(serde_json::to_value(cfg).unwrap()))
}

async fn put_data_providers(
    State(pool): State<PgPool>,
    Extension(redis): Extension<Arc<RedisPool>>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<DataProvidersConfig>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let cfg = DataProviderIntegrationsService::merge_with_defaults(body);
    let normalized = DataProviderIntegrationsService::validate_and_normalize(cfg).map_err(|msg| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": msg })),
        )
    })?;
    let svc = DataProviderIntegrationsService::new(pool);
    svc.save(&normalized).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    DataProviderIntegrationsService::sync_to_redis(redis.as_ref(), &normalized)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            )
        })?;
    Ok(Json(serde_json::json!({
        "success": true,
        "config": serde_json::to_value(&normalized).unwrap(),
        "message": "Saved. Restart the data-provider process to apply WebSocket URL changes."
    })))
}

#[derive(Deserialize)]
struct TestDataProvidersWsBody {
    /// When null/omitted/empty, server uses `BINANCE_WS_URL` or the public Binance default.
    #[serde(default, rename = "wsUrl")]
    ws_url: Option<String>,
}

/// Connects from the auth-service host, subscribes to `btcusdt@bookTicker`, checks for a ticker payload.
async fn post_test_data_providers_ws(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<TestDataProvidersWsBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let url_ref = body
        .ws_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match crate::services::binance_multiplex_ws_test::test_binance_multiplex_ws(url_ref).await {
        Ok(detail) => Ok(Json(serde_json::json!({
            "ok": true,
            "detail": detail,
        }))),
        Err(err) => Ok(Json(serde_json::json!({
            "ok": false,
            "error": err,
        }))),
    }
}

async fn get_email_config(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:view").await?;
    let service = EmailConfigService::new(pool);
    let config = service.get().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::to_value(config).unwrap()))
}

async fn put_email_config(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<UpdateEmailConfigRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let service = EmailConfigService::new(pool);
    let config = service.update(body).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::to_value(config).unwrap()))
}

#[derive(Deserialize)]
struct TestEmailBody {
    to: String,
}

async fn post_test_email(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<TestEmailBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let to = body.to.trim().to_string();
    if to.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Missing or empty 'to' email address" })),
        ));
    }
    let service = EmailConfigService::new(pool);
    let config = service.get_with_password().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    let config = match config {
        Some(c) => c,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "No email configuration found. Save SMTP settings first."
                })),
            ));
        }
    };
    let send_result = tokio::task::spawn_blocking(move || send_test_email_sync(&config, &to))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Task join error: {}", e) })),
            )
        })?;
    send_result.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Test email sent successfully."
    })))
}

async fn get_email_templates(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:view").await?;
    let service = EmailTemplatesService::new(pool);
    let map = service.get_all().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::to_value(map).unwrap()))
}

async fn put_email_template(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Path(id): Path<String>,
    axum::Json(body): axum::Json<UpdateEmailTemplateRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let id = id.trim();
    if id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Template ID is required" })),
        ));
    }
    let service = EmailTemplatesService::new(pool);
    let updated = service.upsert(id, &body.subject, &body.body).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::to_value(updated).unwrap()))
}

#[derive(Deserialize)]
struct ResendWelcomeEmailBody {
    email: String,
}

/// Resend welcome email to a user by email (e.g. after fixing SMTP). Admin only.
async fn post_resend_welcome_email(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<ResendWelcomeEmailBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let email = body.email.trim();
    if email.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Email is required" })),
        ));
    }
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT first_name FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
    )
    .bind(email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    let (first_name,) = row.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": format!("No user found with email {}", email)
            })),
        )
    })?;
    send_welcome_email_after_signup(&pool, email, &first_name)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({
                    "error": format!("Failed to send welcome email: {}", e)
                })),
            )
        })?;
    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Welcome email sent to {}", email)
    })))
}
