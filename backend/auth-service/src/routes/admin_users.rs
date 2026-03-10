use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put},
    Router,
    Extension,
};
use chrono::Utc;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::routes::deposits::{get_account_summary_for_user, AccountSummary, DepositsState};
use crate::services::auth_service::AuthService;
use crate::utils::jwt::Claims;

#[derive(Debug, Deserialize)]
pub struct UpdateUserGroupRequest {
    pub group_id: String,
    #[serde(default)]
    pub min_leverage: Option<i32>,
    #[serde(default)]
    pub max_leverage: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserAccountTypeRequest {
    pub account_type: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserMarginCalculationTypeRequest {
    pub margin_calculation_type: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserTradingAccessRequest {
    pub trading_access: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserPermissionProfileRequest {
    /// UUID of permission profile, or null to unset.
    pub permission_profile_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserProfileRequest {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub country: Option<String>,
    /// One of: active, disabled, suspended
    pub status: Option<String>,
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

#[derive(Debug, Serialize)]
pub struct ImpersonateResponse {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct SendNotifyRequest {
    pub title: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct SendNotifyResponse {
    pub success: bool,
    pub notification_id: String,
}

// --- User notes (Notes & Timeline tab) ---

#[derive(Debug, Serialize)]
pub struct UserNoteResponse {
    pub id: String,
    pub user_id: String,
    pub author_id: Option<String>,
    pub author_email: Option<String>,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserNoteRequest {
    pub content: String,
}

/// Dedicated router for user notes at /api/admin/user-notes/:user_id (GET list, POST create).
/// Nested separately to avoid 404s from route ordering under /api/admin/users.
pub fn create_admin_user_notes_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/:user_id", get(list_user_notes).post(create_user_note))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

pub fn create_admin_users_router(pool: PgPool, deposits_state: DepositsState) -> Router<PgPool> {
    Router::new()
        .route("/:id/profile", put(update_user_profile))
        .route("/:id/group", put(update_user_group))
        .route("/:id/account-type", put(update_user_account_type))
        .route("/:id/margin-calculation-type", put(update_user_margin_calculation_type))
        .route("/:id/trading-access", put(update_user_trading_access))
        .route("/:id/permission-profile", put(update_user_permission_profile))
        .route("/:id/impersonate", post(impersonate_user))
        .route("/:id/notify", post(admin_send_notify))
        .route("/:id/account-summary", get(get_admin_user_account_summary))
        .layer(Extension(deposits_state))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_admin_user_account_summary(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<AccountSummary>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can view user account summary".to_string(),
                },
            }),
        ));
    }
    match get_account_summary_for_user(&pool, deposits_state.redis.as_ref(), user_id).await {
        Ok(summary) => Ok(Json(summary)),
        Err(status) => Err((
            status,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "ACCOUNT_SUMMARY_ERROR".to_string(),
                    message: "Failed to load account summary".to_string(),
                },
            }),
        )),
    }
}

async fn admin_send_notify(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(deposits_state): Extension<DepositsState>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<SendNotifyRequest>,
) -> Result<Json<SendNotifyResponse>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can send notifications to users".to_string(),
                },
            }),
        ));
    }

    let title = body.title.trim();
    let message = body.message.trim();
    if title.is_empty() || message.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: "Title and message are required".to_string(),
                },
            }),
        ));
    }
    const MAX_TITLE: usize = 200;
    const MAX_MESSAGE: usize = 2000;
    if title.len() > MAX_TITLE || message.len() > MAX_MESSAGE {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: format!("Title max {} chars, message max {} chars", MAX_TITLE, MAX_MESSAGE),
                },
            }),
        ));
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    let now = Utc::now();
    let notification_id = Uuid::new_v4();
    let kind = "ADMIN_MESSAGE";
    let meta = serde_json::json!({ "sentByAdminId": claims.sub.to_string() });

    sqlx::query(
        r#"
        INSERT INTO notifications (id, user_id, kind, title, message, read, created_at, meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(message)
    .bind(false)
    .bind(now)
    .bind(&meta)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INSERT_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let notification_event = serde_json::json!({
        "id": notification_id.to_string(),
        "kind": kind,
        "title": title,
        "message": message,
        "createdAt": now.to_rfc3339(),
        "read": false,
        "userId": user_id.to_string(),
        "meta": meta,
    });

    if let Ok(mut conn) = deposits_state.redis.get().await {
        let _: Result<(), _> = conn
            .publish(
                "notifications:push",
                serde_json::to_string(&notification_event).unwrap_or_default(),
            )
            .await;
    }

    Ok(Json(SendNotifyResponse {
        success: true,
        notification_id: notification_id.to_string(),
    }))
}

async fn list_user_notes(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Vec<UserNoteResponse>>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can list user notes".to_string(),
                },
            }),
        ));
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    let rows = sqlx::query_as::<_, (Uuid, Uuid, Option<Uuid>, Option<String>, String, chrono::DateTime<chrono::Utc>)>(
        r#"
        SELECT n.id, n.user_id, n.author_id, u.email, n.content, n.created_at
        FROM user_notes n
        LEFT JOIN users u ON u.id = n.author_id AND u.deleted_at IS NULL
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let notes: Vec<UserNoteResponse> = rows
        .into_iter()
        .map(|(id, uid, author_id, author_email, content, created_at)| UserNoteResponse {
            id: id.to_string(),
            user_id: uid.to_string(),
            author_id: author_id.map(|a| a.to_string()),
            author_email,
            content,
            created_at: created_at.to_rfc3339(),
        })
        .collect();

    Ok(Json(notes))
}

async fn create_user_note(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<CreateUserNoteRequest>,
) -> Result<Json<UserNoteResponse>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can create user notes".to_string(),
                },
            }),
        ));
    }

    let content = body.content.trim();
    if content.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: "Content is required".to_string(),
                },
            }),
        ));
    }
    const MAX_CONTENT: usize = 10_000;
    if content.len() > MAX_CONTENT {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: format!("Content must be at most {} characters", MAX_CONTENT),
                },
            }),
        ));
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    let note_id = Uuid::new_v4();
    let now = Utc::now();

    sqlx::query(
        r#"
        INSERT INTO user_notes (id, user_id, author_id, content, created_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(note_id)
    .bind(user_id)
    .bind(claims.sub)
    .bind(content)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INSERT_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let author_email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL")
        .bind(claims.sub)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DATABASE_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    Ok(Json(UserNoteResponse {
        id: note_id.to_string(),
        user_id: user_id.to_string(),
        author_id: Some(claims.sub.to_string()),
        author_email,
        content: content.to_string(),
        created_at: now.to_rfc3339(),
    }))
}

async fn impersonate_user(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<ImpersonateResponse>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can impersonate users".to_string(),
                },
            }),
        ));
    }
    let service = AuthService::new(pool);
    let (access_token, refresh_token) = service.impersonate(user_id).await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "IMPERSONATE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    Ok(Json(ImpersonateResponse {
        access_token,
        refresh_token,
    }))
}

async fn update_user_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserProfileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can update user profile".to_string(),
                },
            }),
        ));
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    if let Some(ref s) = payload.status {
        let s = s.trim().to_lowercase();
        if s != "active" && s != "disabled" && s != "suspended" {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_STATUS".to_string(),
                        message: "status must be one of: active, disabled, suspended".to_string(),
                    },
                }),
            ));
        }
    }

    let first_name = payload.first_name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let last_name = payload.last_name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let email = payload.email.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let phone = payload.phone.as_deref().map(|s| s.trim());
    let country = payload.country.as_deref().map(|s| s.trim());
    let status = payload.status.as_deref().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());

    let rows = sqlx::query(
        r#"
        UPDATE users SET
            first_name = COALESCE($1, first_name),
            last_name = COALESCE($2, last_name),
            email = COALESCE($3, email),
            phone = COALESCE($4, phone),
            country = COALESCE($5, country),
            status = COALESCE($6::user_status, status),
            updated_at = NOW()
        WHERE id = $7 AND deleted_at IS NULL
        "#,
    )
    .bind(first_name)
    .bind(last_name)
    .bind(email)
    .bind(phone)
    .bind(country)
    .bind(status)
    .bind(user_id)
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

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "User profile updated successfully"
    })))
}

async fn update_user_group(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserGroupRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Check admin role
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can access this endpoint".to_string(),
                },
            }),
        ));
    }

    // Parse group_id
    let group_id = match Uuid::parse_str(&payload.group_id) {
        Ok(id) => id,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_GROUP_ID".to_string(),
                        message: "Invalid group ID format".to_string(),
                    },
                }),
            ));
        }
    };

    // Verify group exists
    let group_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_groups WHERE id = $1)",
    )
    .bind(group_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !group_exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GROUP_NOT_FOUND".to_string(),
                    message: "Group not found".to_string(),
                },
            }),
        ));
    }

    // Verify user exists
    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    // Validate leverage range if provided
    if let (Some(min_l), Some(max_l)) = (payload.min_leverage, payload.max_leverage) {
        if min_l < 1 || max_l > 1000 || min_l > max_l {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_LEVERAGE".to_string(),
                        message: "min_leverage and max_leverage must be between 1 and 1000, and min_leverage <= max_leverage".to_string(),
                    },
                }),
            ));
        }
    } else if payload.min_leverage.is_some() || payload.max_leverage.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_LEVERAGE".to_string(),
                    message: "Both min_leverage and max_leverage must be provided together".to_string(),
                },
            }),
        ));
    }

    // Build update: always set group_id; optionally set min/max leverage
    let rows_affected = if let (Some(min_l), Some(max_l)) = (payload.min_leverage, payload.max_leverage) {
        sqlx::query(
            "UPDATE users SET group_id = $1, min_leverage = $2, max_leverage = $3, updated_at = NOW() WHERE id = $4",
        )
        .bind(group_id)
        .bind(min_l)
        .bind(max_l)
        .bind(user_id)
        .execute(&pool)
    } else {
        sqlx::query(
            "UPDATE users SET group_id = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(group_id)
        .bind(user_id)
        .execute(&pool)
    }
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

    if rows_affected.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "USER_NOT_FOUND".to_string(),
                    message: "User not found or already deleted".to_string(),
                },
            }),
        ));
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "User group updated successfully"
    })))
}

async fn update_user_account_type(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserAccountTypeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can access this endpoint".to_string(),
                },
            }),
        ));
    }

    let account_type = payload.account_type.trim().to_lowercase();
    if account_type != "hedging" && account_type != "netting" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_ACCOUNT_TYPE".to_string(),
                    message: "account_type must be 'hedging' or 'netting'".to_string(),
                },
            }),
        ));
    }

    // Use Redis (order-engine source of truth) for open position count; fall back to PostgreSQL if Redis fails
    let open_count: i32 = match crate::routes::auth::open_position_count_for_user(deposits_state.redis.as_ref(), user_id).await {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!("Redis open position count failed for account-type check, using PostgreSQL: {}", e);
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM positions WHERE user_id = $1 AND status = 'open'::position_status",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "DATABASE_ERROR".to_string(),
                            message: e.to_string(),
                        },
                    }),
                )
            })? as i32
        }
    };

    if open_count > 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "OPEN_POSITIONS".to_string(),
                    message: "Cannot change account type: user has open positions. Close all positions first.".to_string(),
                },
            }),
        ));
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    let rows_affected = sqlx::query(
        "UPDATE users SET account_type = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(&account_type)
    .bind(user_id)
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

    if rows_affected.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "USER_NOT_FOUND".to_string(),
                    message: "User not found or already deleted".to_string(),
                },
            }),
        ));
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Account type updated successfully"
    })))
}

async fn update_user_margin_calculation_type(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserMarginCalculationTypeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can access this endpoint".to_string(),
                },
            }),
        ));
    }

    let margin_calculation_type = payload.margin_calculation_type.trim().to_lowercase();
    if margin_calculation_type != "hedged" && margin_calculation_type != "net" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_MARGIN_CALCULATION_TYPE".to_string(),
                    message: "margin_calculation_type must be 'hedged' or 'net'".to_string(),
                },
            }),
        ));
    }

    // Use Redis (order-engine source of truth) for open position count; fall back to PostgreSQL if Redis fails
    let open_count: i32 = match crate::routes::auth::open_position_count_for_user(deposits_state.redis.as_ref(), user_id).await {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!("Redis open position count failed for margin-type check, using PostgreSQL: {}", e);
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM positions WHERE user_id = $1 AND status = 'open'::position_status",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "DATABASE_ERROR".to_string(),
                            message: e.to_string(),
                        },
                    }),
                )
            })? as i32
        }
    };

    if open_count > 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "OPEN_POSITIONS".to_string(),
                    message: "Cannot change margin calculation type: user has open positions. Close all positions first.".to_string(),
                },
            }),
        ));
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    sqlx::query(
        "UPDATE users SET margin_calculation_type = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(&margin_calculation_type)
    .bind(user_id)
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

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Margin calculation type updated successfully"
    })))
}

async fn update_user_trading_access(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserTradingAccessRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can access this endpoint".to_string(),
                },
            }),
        ));
    }

    let trading_access = payload.trading_access.trim().to_lowercase();
    if trading_access != "full" && trading_access != "close_only" && trading_access != "disabled" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_TRADING_ACCESS".to_string(),
                    message: "trading_access must be 'full', 'close_only', or 'disabled'".to_string(),
                },
            }),
        ));
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    sqlx::query(
        "UPDATE users SET trading_access = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(&trading_access)
    .bind(user_id)
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

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Trading access updated successfully"
    })))
}

async fn update_user_permission_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserPermissionProfileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can access this endpoint".to_string(),
                },
            }),
        ));
    }

    if let Some(profile_id) = payload.permission_profile_id {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM permission_profiles WHERE id = $1)",
        )
        .bind(profile_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DATABASE_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
        if !exists {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "PROFILE_NOT_FOUND".to_string(),
                        message: "Permission profile not found".to_string(),
                    },
                }),
            ));
        }
    }

    let user_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    if !user_exists {
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

    sqlx::query(
        "UPDATE users SET permission_profile_id = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(payload.permission_profile_id)
    .bind(user_id)
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

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Permission profile updated successfully"
    })))
}

