//! Shared server-side permission check: allow if role is admin or user has the given permission from their profile.
//! Used by admin routes so access is enforced by `permission_profile_grants`, not only role.

use axum::http::StatusCode;
use sqlx::PgPool;
use tracing::error;
use uuid::Uuid;

use crate::utils::jwt::Claims;

/// Error returned when the user lacks the required permission. Callers map this to their handler's error type.
#[derive(Debug)]
pub struct PermissionDenied {
    pub status: StatusCode,
    pub code: String,
    pub message: String,
}

/// Allow if `claims.role == "admin"` or `"super_admin"` or the user has the given permission in their assigned profile.
/// Returns `Ok(())` if allowed, `Err(PermissionDenied)` otherwise.
pub async fn check_permission(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), PermissionDenied> {
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!("Failed to get permission profile for check: {}", e);
            PermissionDenied {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                code: "DB_ERROR".to_string(),
                message: e.to_string(),
            }
        })?;
    let pid = profile_id.ok_or_else(|| PermissionDenied {
        status: StatusCode::FORBIDDEN,
        code: "FORBIDDEN".to_string(),
        message: "No permission profile assigned".to_string(),
    })?;
    let has: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM permission_profile_grants WHERE profile_id = $1 AND permission_key = $2)",
    )
    .bind(pid)
    .bind(permission)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        error!("Failed to check permission: {}", e);
        PermissionDenied {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "DB_ERROR".to_string(),
            message: e.to_string(),
        }
    })?;
    if !has {
        return Err(PermissionDenied {
            status: StatusCode::FORBIDDEN,
            code: "FORBIDDEN".to_string(),
            message: format!("Missing permission: {}", permission),
        });
    }
    Ok(())
}

/// Check that the user has the given permission in their assigned profile. No role bypass (admin/super_admin do not auto-pass).
/// Use this when a specific permission must be enforced even for role "admin" (e.g. kyc:approve).
/// Super_admin is still considered to have all permissions (caller should check role == "super_admin" first if desired).
pub async fn check_permission_profile_only(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), PermissionDenied> {
    if claims.role == "super_admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!("Failed to get permission profile for check: {}", e);
            PermissionDenied {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                code: "DB_ERROR".to_string(),
                message: e.to_string(),
            }
        })?;
    let pid = profile_id.ok_or_else(|| PermissionDenied {
        status: StatusCode::FORBIDDEN,
        code: "FORBIDDEN".to_string(),
        message: "No permission profile assigned".to_string(),
    })?;
    let has: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM permission_profile_grants WHERE profile_id = $1 AND permission_key = $2)",
    )
    .bind(pid)
    .bind(permission)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        error!("Failed to check permission: {}", e);
        PermissionDenied {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "DB_ERROR".to_string(),
            message: e.to_string(),
        }
    })?;
    if !has {
        return Err(PermissionDenied {
            status: StatusCode::FORBIDDEN,
            code: "FORBIDDEN".to_string(),
            message: format!("Missing permission: {}", permission),
        });
    }
    Ok(())
}
