use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::put,
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
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

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

pub fn create_admin_users_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/:id/group", put(update_user_group))
        .route("/:id/account-type", put(update_user_account_type))
        .route("/:id/margin-calculation-type", put(update_user_margin_calculation_type))
        .route("/:id/trading-access", put(update_user_trading_access))
        .route("/:id/permission-profile", put(update_user_permission_profile))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
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
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
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

    let open_count: i64 = sqlx::query_scalar(
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
    })?;

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
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
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

    let open_count: i64 = sqlx::query_scalar(
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
    })?;

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

