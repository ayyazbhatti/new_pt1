//! Shared broker (manager) scope: resolve allowed group IDs and check target user access.
//! Used by list users, admin user operations, deposits, finance, etc.
//! See docs/SOLUTION_BROKER_ISOLATION_BY_TAGS.md.

use axum::{
    http::StatusCode,
    response::Json,
};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::utils::jwt::Claims;

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

/// Resolve allowed group IDs for the current caller.
/// - `Ok(None)` = full platform admin (role admin, no manager row) → no filter.
/// - `Ok(Some(vec![]))` = scoped but no allowed groups → see no users.
/// - `Ok(Some(ids))` = scoped to those group IDs (manager's tags → groups with those tags).
pub async fn resolve_allowed_group_ids(
    pool: &PgPool,
    claims: &Claims,
) -> Result<Option<Vec<Uuid>>, (StatusCode, Json<ErrorResponse>)> {
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

    // Admin with no manager row → no filter (see all users)
    if (claims.role == "admin" || claims.role == "super_admin") && manager_id.is_none() {
        return Ok(None);
    }

    // Non-admin: must have users:view via permission profile
    if claims.role != "admin" && claims.role != "super_admin" {
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
    }

    // No manager row (manager path only: non-admin with no manager) → no users
    let Some(mid) = manager_id else {
        return Ok(Some(vec![]));
    };
    #[derive(sqlx::FromRow)]
    struct TagRow {
        tag_id: Uuid,
    }
    let tag_rows = sqlx::query_as::<_, TagRow>(
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
    #[derive(sqlx::FromRow)]
    struct GroupRow {
        entity_id: Uuid,
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

/// Ensure the target user is in the caller's allowed groups.
/// When `allowed_group_ids` is `None`, returns `Ok(())` (full admin).
/// When `Some(ids)` and target user's group_id is in `ids`, returns `Ok(())`.
/// Otherwise returns 404 (user not found) or 403 (user not in scope).
pub async fn ensure_user_in_allowed_groups(
    pool: &PgPool,
    allowed_group_ids: Option<&[Uuid]>,
    target_user_id: Uuid,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if let None = allowed_group_ids {
        return Ok(());
    }
    let ids = allowed_group_ids.unwrap();
    if ids.is_empty() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Access denied to this resource".to_string(),
                },
            }),
        ));
    }
    let group_id: Option<Option<Uuid>> = sqlx::query_scalar(
        "SELECT group_id FROM users WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(target_user_id)
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
    let user_group_id = match group_id {
        None => {
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
        Some(g) => g,
    };
    let in_scope = user_group_id
        .map(|g| ids.contains(&g))
        .unwrap_or(false);
    if !in_scope {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Access denied to this resource".to_string(),
                },
            }),
        ));
    }
    Ok(())
}
