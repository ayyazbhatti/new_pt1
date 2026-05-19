//! Admin settings routes: email configuration (GET/PUT), send test email (POST), email templates (GET/PUT),
//! data provider integrations (GET/PUT), Voiso integration (GET/PUT).

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

use crate::middleware::auth_middleware;
use crate::redis_pool::RedisPool;
use crate::routes::auth::send_welcome_email_after_signup;
use crate::services::data_provider_integrations_service::DataProviderIntegrationsService;
use crate::services::email_config_service::{
    send_test_email_sync, EmailConfigService, UpdateEmailConfigRequest,
};
use crate::services::ai::config_service::{AiConfigService, UpdatePlatformAiConfig};
use crate::services::ai::AnthropicProvider;
use crate::services::email_templates_service::{EmailTemplatesService, UpdateEmailTemplateRequest};
use crate::utils::jwt::Claims;
use tracing::error;

/// Allow if role is admin or user has the given permission from their permission profile.
async fn check_settings_permission(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
    let profile_id: Option<uuid::Uuid> = sqlx::query_scalar(
        "SELECT permission_profile_id FROM users WHERE id = $1",
    )
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
            Json(
                serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "No permission profile assigned" } }),
            ),
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
            Json(
                serde_json::json!({ "error": { "code": "FORBIDDEN", "message": format!("Missing permission: {}", permission) } }),
            ),
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
        .route(
            "/data-providers",
            get(get_data_providers).put(put_data_providers),
        )
        .route("/data-providers/test-ws", post(post_test_data_providers_ws))
        .route("/voiso", get(get_voiso_config).put(put_voiso_config))
        .route("/ai", get(get_ai_config).put(put_ai_config))
        .route("/ai/test", post(post_test_ai_config))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn ensure_voiso_config_row(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO platform_voiso_config (singleton_id)
        VALUES (1)
        ON CONFLICT (singleton_id) DO NOTHING
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutVoisoConfigBody {
    /// Omitted = leave unchanged; empty string = remove stored key; non-empty = set.
    #[serde(default)]
    api_key: Option<String>,
    click2call_url: String,
    panel_url: String,
    enabled: bool,
}

async fn get_voiso_config(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:view").await?;
    ensure_voiso_config_row(&pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    let row: (Option<String>, String, String, bool) = sqlx::query_as(
        r#"
        SELECT api_key, click2call_url, panel_url, enabled
        FROM platform_voiso_config
        WHERE singleton_id = 1
        "#,
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    let db_key_configured = row
        .0
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    let env_key_configured = std::env::var("VOISO_API_KEY")
        .ok()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    Ok(Json(serde_json::json!({
        "apiKeyConfigured": db_key_configured || env_key_configured,
        "storedApiKeyConfigured": db_key_configured,
        "envApiKeyConfigured": env_key_configured,
        "click2callUrl": row.1,
        "panelUrl": row.2,
        "enabled": row.3,
    })))
}

async fn put_voiso_config(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<PutVoisoConfigBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let click2call_url = body.click2call_url.trim().trim_end_matches('/').to_string();
    let panel_url = body.panel_url.trim().to_string();
    if click2call_url.is_empty() || panel_url.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "code": "VALIDATION", "message": "Click2Call URL and panel URL are required" }
            })),
        ));
    }
    if !(click2call_url.starts_with("https://") || click2call_url.starts_with("http://")) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "code": "VALIDATION", "message": "Click2Call URL must start with http:// or https://" }
            })),
        ));
    }
    if !(panel_url.starts_with("https://") || panel_url.starts_with("http://")) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "code": "VALIDATION", "message": "Panel URL must start with http:// or https://" }
            })),
        ));
    }
    ensure_voiso_config_row(&pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    match body.api_key.as_deref().map(str::trim) {
        Some("") => sqlx::query(
            "UPDATE platform_voiso_config SET api_key = NULL, click2call_url = $1, panel_url = $2, enabled = $3, updated_at = NOW() WHERE singleton_id = 1",
        )
        .bind(&click2call_url)
        .bind(&panel_url)
        .bind(body.enabled)
        .execute(&pool)
        .await,
        Some(api_key) => sqlx::query(
            "UPDATE platform_voiso_config SET api_key = $1, click2call_url = $2, panel_url = $3, enabled = $4, updated_at = NOW() WHERE singleton_id = 1",
        )
        .bind(api_key)
        .bind(&click2call_url)
        .bind(&panel_url)
        .bind(body.enabled)
        .execute(&pool)
        .await,
        None => sqlx::query(
            "UPDATE platform_voiso_config SET click2call_url = $1, panel_url = $2, enabled = $3, updated_at = NOW() WHERE singleton_id = 1",
        )
        .bind(&click2call_url)
        .bind(&panel_url)
        .bind(body.enabled)
        .execute(&pool)
        .await,
    }
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    get_voiso_config(State(pool), claims).await
}

fn ai_config_to_json(config: &crate::services::ai::config_service::PlatformAiConfig) -> serde_json::Value {
    let stored_api_key_configured = config
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    let env_api_key_configured = std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    serde_json::json!({
        "provider": config.provider,
        "model": config.model,
        "apiKeyConfigured": stored_api_key_configured || env_api_key_configured,
        "storedApiKeyConfigured": stored_api_key_configured,
        "envApiKeyConfigured": env_api_key_configured,
        "systemPrompt": config.system_prompt,
        "enabled": config.enabled,
        "maxTokensPerMessage": config.max_tokens_per_message,
        "dailyTokenCapPerUser": config.daily_token_cap_per_user,
        "rateLimitPerMinute": config.rate_limit_per_minute,
        "includeUserContext": config.include_user_context,
        "topicGuardEnabled": config.topic_guard_enabled,
        "classifierModel": config.classifier_model,
    })
}

async fn get_ai_config(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "ai_settings:view").await?;
    let config = AiConfigService::get(&pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    Ok(Json(ai_config_to_json(&config)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutAiConfigBody {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    clear_api_key: Option<bool>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    system_prompt: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    max_tokens_per_message: Option<i32>,
    #[serde(default)]
    daily_token_cap_per_user: Option<i32>,
    #[serde(default)]
    rate_limit_per_minute: Option<i32>,
    #[serde(default)]
    include_user_context: Option<bool>,
    #[serde(default)]
    topic_guard_enabled: Option<bool>,
    #[serde(default)]
    classifier_model: Option<String>,
}

async fn put_ai_config(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<PutAiConfigBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "ai_settings:edit").await?;

    if let Some(ref provider) = body.provider {
        if provider.trim() != "anthropic" {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": { "code": "VALIDATION", "message": "Only the anthropic provider is supported in v1" }
                })),
            ));
        }
    }

    if let Some(v) = body.max_tokens_per_message {
        if !(256..=8192).contains(&v) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": { "code": "VALIDATION", "message": "maxTokensPerMessage must be between 256 and 8192" }
                })),
            ));
        }
    }
    if let Some(v) = body.daily_token_cap_per_user {
        if !(1000..=500_000).contains(&v) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": { "code": "VALIDATION", "message": "dailyTokenCapPerUser must be between 1000 and 500000" }
                })),
            ));
        }
    }
    if let Some(v) = body.rate_limit_per_minute {
        if !(1..=60).contains(&v) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": { "code": "VALIDATION", "message": "rateLimitPerMinute must be between 1 and 60" }
                })),
            ));
        }
    }

    let clear_key = body.clear_api_key == Some(true)
        || body.api_key.as_deref().map(str::trim) == Some("");

    let api_key = if clear_key {
        Some(String::new())
    } else {
        body.api_key.clone()
    };

    let updated = AiConfigService::update(
        &pool,
        UpdatePlatformAiConfig {
            provider: body.provider,
            model: body.model,
            api_key,
            system_prompt: body.system_prompt,
            enabled: body.enabled,
            max_tokens_per_message: body.max_tokens_per_message,
            daily_token_cap_per_user: body.daily_token_cap_per_user,
            rate_limit_per_minute: body.rate_limit_per_minute,
            include_user_context: body.include_user_context,
            topic_guard_enabled: body.topic_guard_enabled,
            classifier_model: body.classifier_model,
        },
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;

    Ok(Json(ai_config_to_json(&updated)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestAiConfigBody {
    #[serde(default)]
    message: Option<String>,
}

async fn post_test_ai_config(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<TestAiConfigBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "ai_settings:edit").await?;

    let config = AiConfigService::get(&pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;

    let api_key = AiConfigService::resolve_api_key(&config).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "code": "AI_NOT_CONFIGURED", "message": "Anthropic API key is not configured" }
            })),
        )
    })?;

    let test_message = body
        .message
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("What is leverage?");

    let provider = AnthropicProvider::new(api_key, config.model.clone());
    match provider
        .complete(
            "You are a helpful assistant for a trading platform. Answer briefly and accurately.",
            test_message,
            512,
        )
        .await
    {
        Ok(reply) => Ok(Json(serde_json::json!({
            "ok": true,
            "reply": reply.trim(),
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "ok": false,
            "error": e.to_string(),
        }))),
    }
}

async fn get_data_providers(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:view").await?;
    let svc = DataProviderIntegrationsService::new(pool.clone());
    let cfg = svc.get().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    let cfg = DataProviderIntegrationsService::merge_with_defaults(cfg);
    let mmdps_configured = svc.mmdps_api_key_configured().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::json!({
        "version": cfg.version,
        "providers": cfg.providers,
        "mmdpsApiKeyConfigured": mmdps_configured,
    })))
}

#[derive(Deserialize)]
struct PutDataProvidersBody {
    #[serde(flatten)]
    config: DataProvidersConfig,
    /// Omitted = leave unchanged; empty string = remove stored key; non-empty = set.
    #[serde(default, rename = "mmdpsApiKey")]
    mmdps_api_key: Option<String>,
}

async fn put_data_providers(
    State(pool): State<PgPool>,
    Extension(redis): Extension<Arc<RedisPool>>,
    claims: axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<PutDataProvidersBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_settings_permission(&pool, &claims, "settings:edit").await?;
    let cfg = DataProviderIntegrationsService::merge_with_defaults(body.config);
    let normalized =
        DataProviderIntegrationsService::validate_and_normalize(cfg).map_err(|msg| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": msg })),
            )
        })?;
    let svc = DataProviderIntegrationsService::new(pool.clone());
    svc.save(&normalized).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    svc.apply_mmdps_api_key_from_request(body.mmdps_api_key)
        .await
        .map_err(|e| {
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
    let key_raw: Option<String> = sqlx::query_scalar(
        "SELECT mmdps_api_key FROM platform_data_provider_integrations WHERE singleton_id = 1",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    let key_for_redis: Option<String> = key_raw.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    });
    DataProviderIntegrationsService::sync_mmdps_key_to_redis(
        redis.as_ref(),
        key_for_redis.as_deref(),
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )
    })?;
    let mmdps_configured = svc.mmdps_api_key_configured().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::json!({
        "success": true,
        "config": {
            "version": normalized.version,
            "providers": normalized.providers,
            "mmdpsApiKeyConfigured": mmdps_configured,
        },
        "message": "Saved. Restart the data-provider service to apply MMDPS API key or WebSocket URL changes."
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
    let updated = service
        .upsert(id, &body.subject, &body.body)
        .await
        .map_err(|e| {
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
