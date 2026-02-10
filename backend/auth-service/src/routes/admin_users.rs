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

    // Update user's group
    let rows_affected = sqlx::query(
        "UPDATE users SET group_id = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(group_id)
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
        "message": "User group updated successfully"
    })))
}

