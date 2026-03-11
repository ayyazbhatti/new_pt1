use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, patch, post},
    Router,
};
use std::sync::Arc;
use chrono::Utc;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::services::email_templates_service::EmailTemplatesService;
use crate::utils::hash::{hash_password, hash_token};
use crate::models::leverage_profile::LeverageProfileTier;
use crate::services::auth_service::AuthService;
use crate::services::email_config_service::{send_email_html_sync, send_email_sync, EmailConfigService};
use crate::utils::jwt::Claims;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub password: String,
    pub country: Option<String>,
    pub referral_code: Option<String>,
    /// When set, the new user is assigned to this group (legacy; prefer ref/signup_slug). Must exist and be active.
    pub group_id: Option<Uuid>,
    /// Signup link slug (e.g. from ?ref=golduser). Resolved to group_id; takes precedence over group_id when present.
    #[serde(rename = "ref")]
    pub signup_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct PasswordResetRequestRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct PasswordResetVerifyRequest {
    pub email: String,
    pub otp: String,
}

#[derive(Debug, Deserialize)]
pub struct PasswordResetConfirmRequest {
    #[serde(rename = "reset_token")]
    pub reset_token: String,
    #[serde(rename = "new_password")]
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct PasswordResetGenericResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PasswordResetVerifyResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct ListUsersResponse {
    pub items: Vec<UserResponse>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_login_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_leverage: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_leverage: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leverage_profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_calculation_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trading_access: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_positions_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_profile_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    pub access_token: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct SymbolLeverageQuery {
    pub symbol_code: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMeRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SymbolLeverageResponse {
    pub leverage_profile_name: Option<String>,
    pub leverage_profile_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tiers: Option<Vec<LeverageProfileTier>>,
}

/// One referred user in your referral chain. Level 1 = direct referral, 2 = referral of your referral, etc.
#[derive(Debug, Serialize)]
pub struct ReferredUserResponse {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 1 = direct referral, 2 = referral of your referral, etc.
    pub level: i32,
}

/// Escape for HTML text content (prevents XSS if name/site contain < or &).
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Builds a professional HTML body for the password reset OTP email.
fn build_password_reset_email_html(site_name: &str, first_name: &str, otp: &str) -> String {
    let site = escape_html(site_name);
    let name = escape_html(first_name);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color:#ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden;">
          <tr>
            <td style="padding: 32px 40px 24px; border-bottom: 1px solid #e5e7eb;">
              <h1 style="margin:0; font-size: 20px; font-weight: 600; color: #111827;">{}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin:0 0 20px; color: #374151;">Hi {},</p>
              <p style="margin:0 0 24px; color: #374151;">You requested to reset your password. Use the verification code below to continue. This code expires in <strong>10 minutes</strong>.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 0 24px;">
                <tr>
                  <td style="background-color: #f0f4f8; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px 28px; text-align: center;">
                    <span style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #0f172a; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">{}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:0; font-size: 14px; color: #6b7280;">Enter this code on the password reset page to set a new password.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin:0; font-size: 13px; color: #6b7280;">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
              <p style="margin: 16px 0 0; font-size: 13px; color: #9ca3af;">— {} Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"#,
        site, name, otp, site
    )
}

/// Loads SMTP config and password_reset template, substitutes {{user_name}}, {{site_name}}, {{otp}} / {{reset_link}}, sends email. Runs in spawn_blocking for SMTP.
async fn send_password_reset_otp_email(
    pool: &PgPool,
    to_email: &str,
    user_id: Uuid,
    otp: &str,
) -> Result<(), anyhow::Error> {
    tracing::info!("Attempting to send password reset OTP email to {}", to_email);
    let config = match EmailConfigService::new(pool.clone()).get_with_password().await? {
        Some(c) => c,
        None => {
            tracing::warn!(
                "Password reset email NOT sent: no row in platform_email_config. \
                For testing, use OTP: {} (see server log above)",
                otp
            );
            return Ok(());
        }
    };
    // Skip if still the default placeholder (migration inserts one row with smtp.example.com)
    if config.smtp_host.trim() == "smtp.example.com" && config.smtp_username.trim().is_empty() {
        tracing::warn!(
            "Password reset email NOT sent: SMTP is still the default (smtp.example.com). \
            Save your real SMTP settings in Admin → Settings → Email (tab Email configuration). \
            For testing, use OTP: {} (see server log above)",
            otp
        );
        return Ok(());
    }
    tracing::info!(
        "SMTP config found ({}:{}), sending password reset OTP email to {}",
        config.smtp_host,
        config.smtp_port,
        to_email
    );
    let first_name: String = sqlx::query_scalar(
        "SELECT first_name FROM users WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or_else(|| "User".to_string());
    let site_name = config.from_name.trim();
    let site_name = if site_name.is_empty() {
        "Platform"
    } else {
        site_name
    };
    let templates = EmailTemplatesService::new(pool.clone()).get_all().await?;
    let subject = match templates.get("password_reset") {
        Some(t) => t
            .subject
            .replace("{{user_name}}", &first_name)
            .replace("{{site_name}}", site_name),
        None => "Reset your password".to_string(),
    };
    // Use plain text (same as test email) so delivery matches Admin → Settings → Test email; some providers filter HTML.
    let body_plain = format!(
        "Hi {},\n\nYou requested to reset your password. Your verification code is:\n\n{}\n\nThis code expires in 10 minutes. Enter it on the password reset page to set a new password.\n\nIf you did not request this, you can safely ignore this email.\n\n— {} Team",
        first_name, otp, site_name
    );
    let config = config.clone();
    let to_email = to_email.to_string();
    tokio::task::spawn_blocking(move || {
        tracing::info!("Sending password reset OTP email (plain text) to {}", to_email);
        send_email_sync(&config, &to_email, &subject, &body_plain)
    })
    .await
    .map_err(|e| anyhow::anyhow!("join: {}", e))??;
    Ok(())
}

async fn password_reset_request(
    State(pool): State<PgPool>,
    axum::Json(payload): axum::Json<PasswordResetRequestRequest>,
) -> Result<Json<PasswordResetGenericResponse>, (StatusCode, Json<PasswordResetGenericResponse>)> {
    let email = payload.email.trim().to_lowercase();
    if email.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(PasswordResetGenericResponse {
                success: false,
                message: None,
                error: Some("Email is required".to_string()),
            }),
        ));
    }
    let user_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
    )
    .bind(&email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("password_reset request db error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResetGenericResponse {
                success: false,
                message: None,
                error: Some("Failed to process request".to_string()),
            }),
        )
    })?;
    let user_id = match user_id {
        Some(id) => id,
        None => {
            // Don't reveal whether email exists
            return Ok(Json(PasswordResetGenericResponse {
                success: true,
                message: Some("If an account exists, an OTP has been sent.".to_string()),
                error: None,
            }));
        }
    };
    let otp: String = (0..6)
        .map(|_| rand::thread_rng().gen_range(0..10).to_string())
        .collect();
    let otp_hash = hash_token(&otp);
    let expires_at = Utc::now() + chrono::Duration::minutes(10);
    sqlx::query(
        r#"
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(&otp_hash)
    .bind(expires_at)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("password_reset insert token error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResetGenericResponse {
                success: false,
                message: None,
                error: Some("Failed to process request".to_string()),
            }),
        )
    })?;
    tracing::info!("Password reset OTP for {} (user_id={}): {}", email, user_id, otp);
    // Send OTP by email (fire-and-forget; uses same SMTP/template config as admin settings)
    let pool_email = pool.clone();
    let email_to = email.clone();
    let otp_to_send = otp.clone();
    tokio::spawn(async move {
        match send_password_reset_otp_email(&pool_email, &email_to, user_id, &otp_to_send).await {
            Ok(()) => tracing::info!("Password reset OTP email sent to {}", email_to),
            Err(e) => {
                tracing::warn!(
                    "Password reset email FAILED for {}: {}. \
                    Check Admin → Settings → Email (host, port, encryption, username/password). \
                    OTP for testing: {}",
                    email_to, e, otp_to_send
                );
            }
        }
    });
    Ok(Json(PasswordResetGenericResponse {
        success: true,
        message: Some("OTP sent to your email.".to_string()),
        error: None,
    }))
}

async fn password_reset_verify(
    State(pool): State<PgPool>,
    axum::Json(payload): axum::Json<PasswordResetVerifyRequest>,
) -> Result<Json<PasswordResetVerifyResponse>, (StatusCode, Json<PasswordResetVerifyResponse>)> {
    let email = payload.email.trim().to_lowercase();
    let otp = payload.otp.trim();
    if email.is_empty() || otp.len() != 6 || !otp.chars().all(|c| c.is_ascii_digit()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(PasswordResetVerifyResponse {
                success: false,
                reset_token: None,
                message: None,
                error: Some("Invalid email or OTP".to_string()),
            }),
        ));
    }
    let user_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
    )
    .bind(&email)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("password_reset verify db error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResetVerifyResponse {
                success: false,
                reset_token: None,
                message: None,
                error: Some("Verification failed".to_string()),
            }),
        )
    })?;
    let user_id = match user_id {
        Some(id) => id,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(PasswordResetVerifyResponse {
                    success: false,
                    reset_token: None,
                    message: None,
                    error: Some("Invalid email or OTP".to_string()),
                }),
            ));
        }
    };
    let otp_hash = hash_token(otp);
    let now = Utc::now();
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT id FROM password_reset_tokens
        WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > $3
        "#,
    )
    .bind(user_id)
    .bind(&otp_hash)
    .bind(now)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("password_reset verify fetch error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResetVerifyResponse {
                success: false,
                reset_token: None,
                message: None,
                error: Some("Verification failed".to_string()),
            }),
        )
    })?;
    let (token_id,) = match row {
        Some(r) => r,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(PasswordResetVerifyResponse {
                    success: false,
                    reset_token: None,
                    message: None,
                    error: Some("Invalid or expired OTP".to_string()),
                }),
            ));
        }
    };
    let reset_token = Uuid::new_v4().to_string();
    let reset_token_hash = hash_token(&reset_token);
    let new_expires = now + chrono::Duration::minutes(15);
    sqlx::query(
        r#"
        UPDATE password_reset_tokens SET token_hash = $1, expires_at = $2 WHERE id = $3
        "#,
    )
    .bind(&reset_token_hash)
    .bind(new_expires)
    .bind(token_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        tracing::error!("password_reset verify update error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResetVerifyResponse {
                success: false,
                reset_token: None,
                message: None,
                error: Some("Verification failed".to_string()),
            }),
        )
    })?;
    Ok(Json(PasswordResetVerifyResponse {
        success: true,
        reset_token: Some(reset_token),
        message: None,
        error: None,
    }))
}

async fn password_reset_confirm(
    State(pool): State<PgPool>,
    axum::Json(payload): axum::Json<PasswordResetConfirmRequest>,
) -> Result<Json<PasswordResetGenericResponse>, (StatusCode, Json<PasswordResetGenericResponse>)> {
    if payload.new_password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(PasswordResetGenericResponse {
                success: false,
                message: None,
                error: Some("Password must be at least 8 characters".to_string()),
            }),
        ));
    }
    let reset_token_hash = hash_token(&payload.reset_token);
    let now = Utc::now();
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT user_id FROM password_reset_tokens
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
        "#,
    )
    .bind(&reset_token_hash)
    .bind(now)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("password_reset confirm fetch error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResetGenericResponse {
                success: false,
                message: None,
                error: Some("Failed to update password".to_string()),
            }),
        )
    })?;
    let (user_id,) = match row {
        Some(r) => r,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(PasswordResetGenericResponse {
                    success: false,
                    message: None,
                    error: Some("Invalid or expired reset link".to_string()),
                }),
            ));
        }
    };
    let password_hash = hash_password(&payload.new_password).map_err(|e| {
        tracing::error!("password_reset confirm hash error: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PasswordResetGenericResponse {
                success: false,
                message: None,
                error: Some("Failed to update password".to_string()),
            }),
        )
    })?;
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(&password_hash)
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            tracing::error!("password_reset confirm update user error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(PasswordResetGenericResponse {
                    success: false,
                    message: None,
                    error: Some("Failed to update password".to_string()),
                }),
            )
        })?;
    let _ = sqlx::query(
        "UPDATE password_reset_tokens SET used_at = $1 WHERE token_hash = $2",
    )
    .bind(now)
    .bind(&reset_token_hash)
    .execute(&pool)
    .await;
    Ok(Json(PasswordResetGenericResponse {
        success: true,
        message: Some("Password updated successfully.".to_string()),
        error: None,
    }))
}

pub fn create_auth_router(pool: PgPool, redis: Arc<crate::redis_pool::RedisPool>) -> Router<PgPool> {
    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/password-reset/request", post(password_reset_request))
        .route("/password-reset/verify", post(password_reset_verify))
        .route("/password-reset/confirm", post(password_reset_confirm));
    
    // Protected routes (auth required) – more specific /me/referrals and /me/symbol-leverage before /me
    let protected_routes = Router::new()
        .route("/logout", post(logout))
        .route("/me/referrals", get(my_referrals))
        .route("/me/symbol-leverage", get(symbol_leverage))
        .route("/me", get(me).patch(update_me))
        .route("/users", get(list_users))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(Extension(redis));
    
    // Combine both route groups
    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .with_state(pool)
}

/// Async helper: load config + welcome template and build subject/body. Returns None if skipped.
async fn load_welcome_email_payload(
    pool: &PgPool,
    to_email: &str,
    first_name: &str,
) -> Result<Option<(crate::services::email_config_service::EmailConfig, String, String)>, anyhow::Error> {
    let config = match EmailConfigService::new(pool.clone()).get_with_password().await? {
        Some(c) => c,
        None => {
            tracing::warn!(
                "Welcome email skipped for {}: no SMTP config in platform_email_config. Configure in Admin → Settings → Email.",
                to_email
            );
            return Ok(None);
        }
    };
    let templates = EmailTemplatesService::new(pool.clone()).get_all().await?;
    let welcome = match templates.get("welcome") {
        Some(t) => t,
        None => {
            tracing::warn!(
                "Welcome email skipped for {}: no 'welcome' template in platform_email_templates. Run migrations.",
                to_email
            );
            return Ok(None);
        }
    };
    let site_name = config.from_name.trim();
    let site_name = if site_name.is_empty() { "Platform" } else { site_name };
    let subject = welcome
        .subject
        .replace("{{user_name}}", first_name)
        .replace("{{site_name}}", site_name);
    let body = welcome
        .body
        .replace("{{user_name}}", first_name)
        .replace("{{site_name}}", site_name);
    Ok(Some((config, subject, body)))
}

/// Loads welcome template and SMTP config, substitutes placeholders, and sends the email.
/// Runs DB load + SMTP send in a single spawn_blocking so one thread does both (avoids pool queue delay).
/// Called in a spawned task after signup; errors are logged only.
/// Also used by admin "resend welcome email" endpoint.
pub(crate) async fn send_welcome_email_after_signup(
    pool: &PgPool,
    to_email: &str,
    first_name: &str,
) -> Result<(), anyhow::Error> {
    let pool = pool.clone();
    let to_email = to_email.to_string();
    let first_name = first_name.to_string();
    // Single blocking task: load config/template then send. Avoids waiting for pool twice and keeps send immediate after load.
    let result = tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Runtime::new().map_err(|e| anyhow::anyhow!("Runtime: {}", e))?;
        let payload = rt.block_on(load_welcome_email_payload(&pool, &to_email, &first_name))?;
        match payload {
            Some((config, subject, body)) => {
                tracing::info!("Sending welcome email to {}", to_email);
                send_email_sync(&config, &to_email, &subject, &body)?;
                tracing::info!("Welcome email sent successfully to {}", to_email);
                Ok(())
            }
            None => Ok(()),
        }
    })
    .await
    .map_err(|e| anyhow::anyhow!("join: {}", e))?;
    result
}

async fn register(
    State(pool): State<PgPool>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let service = AuthService::new(pool.clone());

    // Resolve ?ref=slug to group_id (takes precedence over group_id)
    let group_id = if let Some(ref slug) = payload.signup_ref {
        let slug = slug.trim();
        if slug.is_empty() {
            payload.group_id
        } else {
            let id: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM user_groups WHERE signup_slug = $1 AND status = 'active'",
            )
            .bind(slug)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
            id.or(payload.group_id)
        }
    } else {
        payload.group_id
    };

    match service
        .register(
            &payload.first_name,
            &payload.last_name,
            &payload.email,
            &payload.password,
            payload.country.as_deref(),
            payload.referral_code.as_deref(),
            group_id,
        )
        .await
    {
        Ok((user, access_token, refresh_token)) => {
            // Fire-and-forget: send welcome email (do not block or fail registration)
            let pool_welcome = pool.clone();
            let to_email = user.email.clone();
            let first_name = user.first_name.clone();
            tokio::spawn(async move {
                if let Err(e) =
                    send_welcome_email_after_signup(&pool_welcome, &to_email, &first_name).await
                {
                    tracing::warn!("Welcome email failed for {}: {}", to_email, e);
                }
            });

            Ok(Json(AuthResponse {
            access_token,
            refresh_token,
            user: UserResponse {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                status: user.status.into(),
                phone: user.phone.clone(),
                country: user.country.clone(),
                created_at: Some(user.created_at),
                last_login_at: user.last_login_at,
                referral_code: user.referral_code.clone(),
                group_id: user.group_id,
                group_name: None,
                min_leverage: user.min_leverage,
                max_leverage: user.max_leverage,
                price_profile_name: None,
                leverage_profile_name: None,
                account_type: user.account_type.or_else(|| Some("hedging".to_string())),
                margin_calculation_type: user.margin_calculation_type.or_else(|| Some("hedged".to_string())),
                trading_access: user.trading_access.or_else(|| Some("full".to_string())),
                open_positions_count: None,
                permission_profile_id: None,
                permission_profile_name: None,
                permissions: Some(vec![]),
            },
        }))
        }
        Err(e) => {
            let code = if e.to_string().contains("already registered") {
                "EMAIL_EXISTS"
            } else if e.to_string().contains("Password") {
                "INVALID_PASSWORD"
            } else {
                "REGISTRATION_FAILED"
            };
            Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: code.to_string(),
                        message: e.to_string(),
                    },
                }),
            ))
        }
    }
}

async fn login(
    State(pool): State<PgPool>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let service = AuthService::new(pool.clone());

    // Extract user agent and IP
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok());
    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|h| h.to_str().ok());

    match service
        .login(&payload.email, &payload.password, user_agent, ip.as_deref())
        .await
    {
        Ok((user, access_token, refresh_token)) => {
            let perm_service = crate::services::permission_profiles_service::PermissionProfilesService::new(pool.clone());
            let permissions = perm_service
                .get_effective_permissions(&user.role, user.permission_profile_id)
                .await;
            let permission_profile_name: Option<String> = if let Some(profile_id) = user.permission_profile_id {
                sqlx::query_scalar::<_, String>("SELECT name FROM permission_profiles WHERE id = $1")
                    .bind(profile_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };
            Ok(Json(AuthResponse {
                access_token,
                refresh_token,
                user: UserResponse {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    role: user.role,
                    status: user.status.into(),
                    phone: user.phone.clone(),
                    country: user.country.clone(),
                    created_at: Some(user.created_at),
                    last_login_at: user.last_login_at,
                    referral_code: user.referral_code.clone(),
                    group_id: user.group_id,
                    group_name: None,
                    min_leverage: user.min_leverage,
                    max_leverage: user.max_leverage,
                    price_profile_name: None,
                    leverage_profile_name: None,
                    account_type: user.account_type.or_else(|| Some("hedging".to_string())),
                    margin_calculation_type: user.margin_calculation_type.or_else(|| Some("hedged".to_string())),
                    trading_access: user.trading_access.or_else(|| Some("full".to_string())),
                    open_positions_count: None,
                    permission_profile_id: user.permission_profile_id,
                    permission_profile_name,
                    permissions: Some(permissions),
                },
            }))
        }
        Err(e) => Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_CREDENTIALS".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn refresh(
    State(pool): State<PgPool>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<RefreshResponse>, (StatusCode, Json<ErrorResponse>)> {
    let service = AuthService::new(pool);

    match service.refresh(&payload.refresh_token).await {
        Ok(access_token) => Ok(Json(RefreshResponse { access_token })),
        Err(e) => Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_REFRESH_TOKEN".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn logout(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<LogoutRequest>,
) -> Result<axum::http::StatusCode, (StatusCode, Json<ErrorResponse>)> {

    let service = AuthService::new(pool);

    match service.logout(claims.sub, &payload.refresh_token).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LOGOUT_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn me(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<UserResponse>, (StatusCode, Json<ErrorResponse>)> {

    let service = AuthService::new(pool.clone());

    match service.get_user_by_id(claims.sub).await {
        Ok(user) => {
            // Fetch group name and profile names if user has a group
            let (group_name, price_profile_name, leverage_profile_name): (Option<String>, Option<String>, Option<String>) =
                if let Some(group_id) = user.group_id {
                    #[derive(sqlx::FromRow)]
                    struct GroupProfileRow {
                        group_name: Option<String>,
                        price_profile_name: Option<String>,
                        leverage_profile_name: Option<String>,
                    }
                    let row = sqlx::query_as::<_, GroupProfileRow>(
                        r#"
                        SELECT ug.name AS group_name, psp.name AS price_profile_name, lp.name AS leverage_profile_name
                        FROM user_groups ug
                        LEFT JOIN price_stream_profiles psp ON ug.default_price_profile_id = psp.id
                        LEFT JOIN leverage_profiles lp ON ug.default_leverage_profile_id = lp.id
                        WHERE ug.id = $1
                        "#,
                    )
                    .bind(group_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten();
                    (
                        row.as_ref().and_then(|r| r.group_name.clone()),
                        row.as_ref().and_then(|r| r.price_profile_name.clone()),
                        row.as_ref().and_then(|r| r.leverage_profile_name.clone()),
                    )
                } else {
                    (None, None, None)
                };

            let perm_service = crate::services::permission_profiles_service::PermissionProfilesService::new(pool.clone());
            let permissions = perm_service
                .get_effective_permissions(&user.role, user.permission_profile_id)
                .await;
            let permission_profile_name: Option<String> = if let Some(profile_id) = user.permission_profile_id {
                sqlx::query_scalar::<_, String>("SELECT name FROM permission_profiles WHERE id = $1")
                    .bind(profile_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };

            Ok(Json(UserResponse {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                status: user.status.into(),
                phone: user.phone,
                country: user.country,
                created_at: Some(user.created_at),
                last_login_at: user.last_login_at,
                referral_code: user.referral_code,
                group_id: user.group_id,
                group_name,
                min_leverage: user.min_leverage,
                max_leverage: user.max_leverage,
                price_profile_name,
                leverage_profile_name,
                account_type: user.account_type.or_else(|| Some("hedging".to_string())),
                margin_calculation_type: user.margin_calculation_type.or_else(|| Some("hedged".to_string())),
                trading_access: user.trading_access.or_else(|| Some("full".to_string())),
                open_positions_count: None,
                permission_profile_id: user.permission_profile_id,
                permission_profile_name,
                permissions: Some(permissions),
            }))
        },
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "USER_NOT_FOUND".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

#[derive(sqlx::FromRow)]
struct ReferredUserRow {
    id: Uuid,
    email: String,
    first_name: String,
    last_name: String,
    created_at: chrono::DateTime<chrono::Utc>,
    level: i32,
}

async fn my_referrals(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<ReferredUserResponse>>, (StatusCode, Json<ErrorResponse>)> {
    // Recursive CTE: level 1 = direct referrals, level 2 = referred by level 1, etc.
    let rows = sqlx::query_as::<_, ReferredUserRow>(
        r#"
        WITH RECURSIVE referral_chain AS (
            SELECT id, email,
                   COALESCE(first_name, '') AS first_name,
                   COALESCE(last_name, '') AS last_name,
                   created_at,
                   1 AS level
            FROM users
            WHERE referred_by_user_id = $1
            UNION ALL
            SELECT u.id, u.email,
                   COALESCE(u.first_name, '') AS first_name,
                   COALESCE(u.last_name, '') AS last_name,
                   u.created_at,
                   rc.level + 1
            FROM users u
            INNER JOIN referral_chain rc ON u.referred_by_user_id = rc.id
        )
        SELECT id, email, first_name, last_name, created_at, level
        FROM referral_chain
        ORDER BY level ASC, created_at DESC
        "#,
    )
    .bind(claims.sub)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let list: Vec<ReferredUserResponse> = rows
        .into_iter()
        .map(|r| ReferredUserResponse {
            id: r.id,
            email: r.email,
            first_name: r.first_name,
            last_name: r.last_name,
            created_at: r.created_at,
            level: r.level,
        })
        .collect();
    Ok(Json(list))
}

async fn update_me(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<UpdateMeRequest>,
) -> Result<Json<UserResponse>, (StatusCode, Json<ErrorResponse>)> {
    let first_name = payload.first_name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let last_name = payload.last_name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    if first_name.is_none() && last_name.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Provide at least one of first_name or last_name".to_string(),
                },
            }),
        ));
    }

    let rows = sqlx::query(
        "UPDATE users SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name), updated_at = NOW() WHERE id = $3",
    )
    .bind(first_name)
    .bind(last_name)
    .bind(claims.sub)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "UPDATE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if rows.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "USER_NOT_FOUND".to_string(),
                    message: "User not found".to_string(),
                },
            }),
        ));
    }

    let service = AuthService::new(pool.clone());
    let user = service.get_user_by_id(claims.sub).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FETCH_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    // Same response shape as me()
    let (group_name, price_profile_name, leverage_profile_name): (Option<String>, Option<String>, Option<String>) =
        if let Some(group_id) = user.group_id {
            #[derive(sqlx::FromRow)]
            struct GroupProfileRow {
                group_name: Option<String>,
                price_profile_name: Option<String>,
                leverage_profile_name: Option<String>,
            }
            let row = sqlx::query_as::<_, GroupProfileRow>(
                r#"
                SELECT ug.name AS group_name, psp.name AS price_profile_name, lp.name AS leverage_profile_name
                FROM user_groups ug
                LEFT JOIN price_stream_profiles psp ON ug.default_price_profile_id = psp.id
                LEFT JOIN leverage_profiles lp ON ug.default_leverage_profile_id = lp.id
                WHERE ug.id = $1
                "#,
            )
            .bind(group_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
            (
                row.as_ref().and_then(|r| r.group_name.clone()),
                row.as_ref().and_then(|r| r.price_profile_name.clone()),
                row.as_ref().and_then(|r| r.leverage_profile_name.clone()),
            )
        } else {
            (None, None, None)
        };

    let perm_service = crate::services::permission_profiles_service::PermissionProfilesService::new(pool.clone());
    let permissions = perm_service
        .get_effective_permissions(&user.role, user.permission_profile_id)
        .await;
    let permission_profile_name: Option<String> = if let Some(profile_id) = user.permission_profile_id {
        sqlx::query_scalar::<_, String>("SELECT name FROM permission_profiles WHERE id = $1")
            .bind(profile_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
    } else {
        None
    };

    Ok(Json(UserResponse {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        status: user.status.into(),
        phone: user.phone,
        country: user.country,
        created_at: Some(user.created_at),
        last_login_at: user.last_login_at,
        referral_code: user.referral_code,
        group_id: user.group_id,
        group_name,
        min_leverage: user.min_leverage,
        max_leverage: user.max_leverage,
        price_profile_name,
        leverage_profile_name,
        account_type: user.account_type.or_else(|| Some("hedging".to_string())),
        margin_calculation_type: user.margin_calculation_type.or_else(|| Some("hedged".to_string())),
        trading_access: user.trading_access.or_else(|| Some("full".to_string())),
        open_positions_count: None,
        permission_profile_id: user.permission_profile_id,
        permission_profile_name,
        permissions: Some(permissions),
    }))
}

async fn symbol_leverage(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(params): Query<SymbolLeverageQuery>,
) -> Result<Json<SymbolLeverageResponse>, (StatusCode, Json<ErrorResponse>)> {
    let symbol_code = params.symbol_code.trim();
    if symbol_code.is_empty() {
        return Ok(Json(SymbolLeverageResponse {
            leverage_profile_name: None,
            leverage_profile_id: None,
            tiers: None,
        }));
    }

    #[derive(sqlx::FromRow)]
    struct Row {
        leverage_profile_id: Option<Uuid>,
        leverage_profile_name: Option<String>,
    }

    // Case-insensitive symbol match; COALESCE gives per-symbol override else group default
    let row = sqlx::query_as::<_, Row>(
        r#"
        SELECT
            COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id) AS leverage_profile_id,
            (SELECT lp2.name FROM leverage_profiles lp2 WHERE lp2.id = COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id)) AS leverage_profile_name
        FROM users u
        INNER JOIN user_groups ug ON ug.id = u.group_id
        INNER JOIN symbols s ON LOWER(TRIM(s.code)) = LOWER(TRIM($2))
        LEFT JOIN group_symbols gs ON gs.symbol_id = s.id AND gs.group_id = ug.id
        WHERE u.id = $1
        "#,
    )
    .bind(claims.sub)
    .bind(symbol_code)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "SYMBOL_LEVERAGE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let profile_id = row.as_ref().and_then(|r| r.leverage_profile_id);
    let tiers: Option<Vec<LeverageProfileTier>> = match profile_id {
        Some(pid) => {
            let tiers_result = sqlx::query_as::<_, LeverageProfileTier>(
                r#"
                SELECT id, profile_id, tier_index,
                    notional_from::text AS notional_from, notional_to::text AS notional_to,
                    max_leverage, initial_margin_percent::text AS initial_margin_percent,
                    maintenance_margin_percent::text AS maintenance_margin_percent,
                    created_at, updated_at
                FROM leverage_profile_tiers
                WHERE profile_id = $1
                ORDER BY tier_index ASC
                "#,
            )
            .bind(pid)
            .fetch_all(&pool)
            .await;
            tiers_result.ok()
        }
        None => None,
    };

    Ok(Json(SymbolLeverageResponse {
        leverage_profile_name: row.as_ref().and_then(|r| r.leverage_profile_name.clone()),
        leverage_profile_id: profile_id,
        tiers,
    }))
}

/// Resolve allowed group IDs for list users. Returns None = no filter (see all users), Some(ids) = restrict to users in those groups.
/// Super_admin: no filter (all users). Admin: groups that share a tag with the admin user. Manager: groups that share a tag with the manager.
async fn resolve_allowed_group_ids_for_list_users(
    pool: &PgPool,
    claims: &Claims,
) -> Result<Option<Vec<Uuid>>, (StatusCode, Json<ErrorResponse>)> {
    #[derive(sqlx::FromRow)]
    struct GroupRow { entity_id: Uuid }

    // Super_admin → see all users (no filter)
    if claims.role == "super_admin" {
        return Ok(None);
    }

    // Admin (not super_admin): scope by admin user's tags → groups that have those tags
    if claims.role == "admin" {
        #[derive(sqlx::FromRow)]
        struct TagRow { tag_id: Uuid }
        let tag_rows = sqlx::query_as::<_, TagRow>(
            "SELECT tag_id FROM tag_assignments WHERE entity_type = 'user' AND entity_id = $1",
        )
        .bind(claims.sub)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
        let user_tag_ids: Vec<Uuid> = tag_rows.into_iter().map(|r| r.tag_id).collect();
        if user_tag_ids.is_empty() {
            return Ok(Some(vec![]));
        }
        let group_rows = sqlx::query_as::<_, GroupRow>(
            "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY($1)",
        )
        .bind(&user_tag_ids)
        .fetch_all(pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
        let allowed: Vec<Uuid> = group_rows.into_iter().map(|r| r.entity_id).collect();
        return Ok(Some(allowed));
    }

    // Manager path: must have users:view via permission profile
    let profile_id: Option<Uuid> =
        sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
            .bind(claims.sub)
            .fetch_optional(pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "DB_ERROR".to_string(),
                            message: e.to_string(),
                        },
                    }),
                )
            })?;
    let pid = match profile_id {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "FORBIDDEN".to_string(),
                        message: "No permission profile assigned".to_string(),
                    },
                }),
            ));
        }
    };
    let has_view: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM permission_profile_grants WHERE profile_id = $1 AND permission_key = 'users:view')",
    )
    .bind(pid)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    if !has_view {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Missing permission: users:view".to_string(),
                },
            }),
        ));
    }

    let manager_id: Option<Uuid> = sqlx::query_scalar("SELECT id FROM managers WHERE user_id = $1")
        .bind(claims.sub)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    // No manager row (manager path) → no users
    let Some(mid) = manager_id else {
        return Ok(Some(vec![]));
    };
    #[derive(sqlx::FromRow)]
    struct ManagerTagRow { tag_id: Uuid }
    let tag_rows = sqlx::query_as::<_, ManagerTagRow>(
        "SELECT tag_id FROM tag_assignments WHERE entity_type = 'manager' AND entity_id = $1",
    )
    .bind(mid)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    let manager_tag_ids: Vec<Uuid> = tag_rows.into_iter().map(|r| r.tag_id).collect();
    if manager_tag_ids.is_empty() {
        return Ok(Some(vec![]));
    }
    let group_rows = sqlx::query_as::<_, GroupRow>(
        "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY($1)",
    )
    .bind(&manager_tag_ids)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    let allowed: Vec<Uuid> = group_rows.into_iter().map(|r| r.entity_id).collect();
    Ok(Some(allowed))
}

/// Count open positions for a single user from Redis (order-engine source of truth). Used by account-type and margin-type update checks.
pub async fn open_position_count_for_user(
    redis: &crate::redis_pool::RedisPool,
    user_id: Uuid,
) -> Result<i32, Box<dyn std::error::Error + Send + Sync>> {
    let counts = open_position_counts_from_redis(redis, std::slice::from_ref(&user_id)).await?;
    Ok(counts.get(&user_id).copied().unwrap_or(0))
}

/// Count open positions per user from Redis (order-engine source of truth). Keys: pos:{user_id} set, pos:by_id:{id} hash with status OPEN/CLOSED.
async fn open_position_counts_from_redis(
    redis: &crate::redis_pool::RedisPool,
    user_ids: &[Uuid],
) -> Result<std::collections::HashMap<Uuid, i32>, Box<dyn std::error::Error + Send + Sync>> {
    let mut conn = redis.get().await.map_err(|e| format!("redis connection: {}", e))?;
    let mut counts = std::collections::HashMap::new();
    for user_id in user_ids {
        let key = format!("pos:{}", user_id);
        let pos_ids: Vec<String> = redis::cmd("SMEMBERS")
            .arg(&key)
            .query_async(&mut conn)
            .await
            .unwrap_or_default();
        let mut open_count = 0i32;
        for pos_id in pos_ids {
            let status: Option<String> = redis::cmd("HGET")
                .arg(format!("pos:by_id:{}", pos_id))
                .arg("status")
                .query_async(&mut conn)
                .await
                .ok()
                .flatten();
            if status.as_deref() == Some("OPEN") {
                open_count += 1;
            }
        }
        counts.insert(*user_id, open_count);
    }
    Ok(counts)
}

async fn list_users(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(redis): Extension<Arc<crate::redis_pool::RedisPool>>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<ListUsersResponse>, (StatusCode, Json<ErrorResponse>)> {
    let allowed_group_ids = resolve_allowed_group_ids_for_list_users(&pool, &claims).await?;
    let service = AuthService::new(pool.clone());

    // Server-side pagination: page, page_size, search, status, group_id
    let use_paginated = params.contains_key("page") || params.contains_key("page_size")
        || params.contains_key("search") || params.contains_key("status") || params.contains_key("group_id");

    let group_id_param = params
        .get("group_id")
        .and_then(|s| Uuid::parse_str(s).ok());
    let effective_group_id = match (&allowed_group_ids, group_id_param) {
        (Some(ids), Some(g)) if ids.contains(&g) => Some(g),
        (Some(_), _) => None,
        (None, g) => g,
    };

    let (users, total) = if use_paginated {
        let page = params.get("page").and_then(|s| s.parse::<i64>().ok()).unwrap_or(1);
        let page_size = params.get("page_size").and_then(|s| s.parse::<i64>().ok()).unwrap_or(20);
        let search = params.get("search").map(|s| s.as_str());
        let status = params.get("status").map(|s| s.as_str());

        match service
            .list_users_paginated(
                search,
                status,
                effective_group_id,
                page,
                page_size,
                allowed_group_ids.as_deref(),
            )
            .await
        {
            Ok(pair) => pair,
            Err(e) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "LIST_USERS_FAILED".to_string(),
                            message: e.to_string(),
                        },
                    }),
                ));
            }
        }
    } else {
        let limit = params.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(100);
        let offset = params.get("offset").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let users = match service
            .list_users(Some(limit), Some(offset), allowed_group_ids.as_deref())
            .await
        {
            Ok(u) => u,
            Err(e) => {
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "LIST_USERS_FAILED".to_string(),
                            message: e.to_string(),
                        },
                    }),
                ));
            }
        };
        let total = users.len() as i64;
        (users, total)
    };

    {
            let user_ids: Vec<Uuid> = users.iter().map(|u| u.id).collect();
            // Open position count from Redis (order-engine source of truth). Fall back to PostgreSQL if Redis fails.
            let open_counts: std::collections::HashMap<Uuid, i32> = if user_ids.is_empty() {
                std::collections::HashMap::new()
            } else {
                match open_position_counts_from_redis(redis.as_ref(), &user_ids).await {
                    Ok(counts) => counts,
                    Err(e) => {
                        tracing::warn!("Redis open position count failed, using PostgreSQL: {}", e);
                        #[derive(sqlx::FromRow)]
                        struct PosCountRow {
                            user_id: Uuid,
                            count: i64,
                        }
                        let rows = sqlx::query_as::<_, PosCountRow>(
                            "SELECT user_id, COUNT(*) AS count FROM positions WHERE status = 'open'::position_status AND user_id = ANY($1) GROUP BY user_id",
                        )
                        .bind(&user_ids)
                        .fetch_all(&pool)
                        .await
                        .unwrap_or_default();
                        rows.into_iter()
                            .map(|r| (r.user_id, r.count as i32))
                            .collect()
                    }
                }
            };

            let permission_profiles_service = crate::services::permission_profiles_service::PermissionProfilesService::new(pool.clone());

            let mut user_responses: Vec<UserResponse> = Vec::new();
            for u in users {
                let group_name: Option<String> = if let Some(group_id) = u.group_id {
                    sqlx::query_scalar::<_, String>(
                        "SELECT name FROM user_groups WHERE id = $1"
                    )
                    .bind(group_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten()
                } else {
                    None
                };

                let (permission_profile_name, permissions): (Option<String>, Option<Vec<String>>) =
                    if let Some(profile_id) = u.permission_profile_id {
                        let name = sqlx::query_scalar::<_, String>(
                            "SELECT name FROM permission_profiles WHERE id = $1",
                        )
                        .bind(profile_id)
                        .fetch_optional(&pool)
                        .await
                        .ok()
                        .flatten();
                        let perms = permission_profiles_service
                            .get_effective_permissions(&u.role, Some(profile_id))
                            .await;
                        (name, Some(perms))
                    } else {
                        let perms = permission_profiles_service
                            .get_effective_permissions(&u.role, None)
                            .await;
                        (None, Some(perms))
                    };

                let account_type = u
                    .account_type
                    .filter(|s| s == "hedging" || s == "netting")
                    .or_else(|| Some("hedging".to_string()));
                let margin_calculation_type = u
                    .margin_calculation_type
                    .filter(|s| s == "hedged" || s == "net")
                    .or_else(|| Some("hedged".to_string()));
                let trading_access = u
                    .trading_access
                    .filter(|s| s == "full" || s == "close_only" || s == "disabled")
                    .or_else(|| Some("full".to_string()));
                let open_positions_count = open_counts.get(&u.id).copied();

                user_responses.push(UserResponse {
                    id: u.id,
                    email: u.email,
                    first_name: u.first_name,
                    last_name: u.last_name,
                    role: u.role,
                    status: u.status.into(),
                    phone: u.phone,
                    country: u.country,
                    created_at: Some(u.created_at),
                    last_login_at: u.last_login_at,
                    referral_code: u.referral_code,
                    group_id: u.group_id,
                    group_name,
                    min_leverage: u.min_leverage,
                    max_leverage: u.max_leverage,
                    price_profile_name: None,
                    leverage_profile_name: None,
                    account_type,
                    margin_calculation_type,
                    trading_access,
                    open_positions_count,
                    permission_profile_id: u.permission_profile_id,
                    permission_profile_name,
                    permissions,
                });
            }
            Ok(Json(ListUsersResponse {
                items: user_responses,
                total,
            }))
    }
}

