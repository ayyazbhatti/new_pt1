//! Admin API for permission profiles: list, create, get, update, delete.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use tracing::error;
use crate::middleware::auth_middleware;
use crate::services::permission_profiles_service::PermissionProfilesService;
use crate::utils::jwt::Claims;

#[derive(Debug, Serialize)]
pub struct PermissionProfileResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub permission_keys: Vec<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    /// User (manager/admin/super_admin) who created this profile.
    pub created_by_user_id: Option<Uuid>,
    pub created_by_email: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct PermissionProfileTagsResponse {
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct PutPermissionProfileTagsRequest {
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub permission_keys: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub permission_keys: Option<Vec<String>>,
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

/// Resolve permission profile IDs that share at least one tag with the given user (for tag-scoped admin list).
/// Super_admin should not use this (pass None to list / allow all in single-item checks).
async fn resolve_allowed_permission_profile_ids_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Uuid>, (StatusCode, Json<ErrorResponse>)> {
    #[derive(sqlx::FromRow)]
    struct TagRow {
        tag_id: Uuid,
    }
    let tag_rows = sqlx::query_as::<_, TagRow>(
        "SELECT tag_id FROM tag_assignments WHERE entity_type = 'user' AND entity_id = $1",
    )
    .bind(user_id)
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
        return Ok(vec![]);
    }
    #[derive(sqlx::FromRow)]
    struct ProfileRow {
        entity_id: Uuid,
    }
    let profile_rows = sqlx::query_as::<_, ProfileRow>(
        "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'permission_profile' AND tag_id = ANY($1)",
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
    Ok(profile_rows.into_iter().map(|r| r.entity_id).collect())
}

/// For non–super_admin, ensure the permission profile is in the user's allowed set (same tag). Otherwise 404.
async fn ensure_profile_allowed(
    pool: &PgPool,
    claims: &Claims,
    profile_id: Uuid,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role == "super_admin" {
        return Ok(());
    }
    let allowed = resolve_allowed_permission_profile_ids_for_user(pool, claims.sub).await?;
    if allowed.contains(&profile_id) {
        Ok(())
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Permission profile not found".to_string(),
                },
            }),
        ))
    }
}

/// Allow if role is admin or user has the given permission from their permission profile.
async fn check_permission(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role == "admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!("Failed to get permission profile for permissions check: {}", e);
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
    let Some(pid) = profile_id else {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "No permission profile assigned".to_string(),
                },
            }),
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
        error!("Failed to check permission: {}", e);
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
    if !has {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: format!("Missing permission: {}", permission),
                },
            }),
        ));
    }
    Ok(())
}

pub fn create_admin_permission_profiles_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_profiles).post(create_profile))
        .route("/keys", get(list_keys))
        .route("/definitions", get(list_definitions))
        .route("/:id", get(get_profile).put(update_profile).delete(delete_profile))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

/// Router for GET/PUT permission profile tags. Mount at `/api/admin/permission-profile-tags` so path is `/:id`.
pub fn create_admin_permission_profile_tags_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/:id", get(get_permission_profile_tags).put(put_permission_profile_tags))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_permission_profile_tag_ids(pool: &PgPool, profile_ids: &[Uuid]) -> HashMap<Uuid, Vec<Uuid>> {
    if profile_ids.is_empty() {
        return HashMap::new();
    }
    #[derive(sqlx::FromRow)]
    struct Row {
        entity_id: Uuid,
        tag_id: Uuid,
    }
    let rows = match sqlx::query_as::<_, Row>(
        "SELECT entity_id, tag_id FROM tag_assignments WHERE entity_type = 'permission_profile' AND entity_id = ANY($1)",
    )
    .bind(profile_ids)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(_) => return HashMap::new(),
    };
    let mut map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for r in rows {
        map.entry(r.entity_id).or_default().push(r.tag_id);
    }
    map
}

async fn set_permission_profile_tags(pool: &PgPool, profile_id: Uuid, tag_ids: &[Uuid]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM tag_assignments WHERE entity_type = 'permission_profile' AND entity_id = $1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for tag_id in tag_ids {
        sqlx::query(
            "INSERT INTO tag_assignments (tag_id, entity_type, entity_id, created_at) VALUES ($1, 'permission_profile', $2, NOW())",
        )
        .bind(tag_id)
        .bind(profile_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn get_permission_profile_tags(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<PermissionProfileTagsResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:view").await?;
    ensure_profile_allowed(&pool, &claims, id).await?;

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM permission_profiles WHERE id = $1)")
        .bind(id)
        .fetch_one(&pool)
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
    if !exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Permission profile not found".to_string(),
                },
            }),
        ));
    }

    let tag_map = get_permission_profile_tag_ids(&pool, &[id]).await;
    let tag_ids = tag_map.get(&id).cloned().unwrap_or_default();
    Ok(Json(PermissionProfileTagsResponse { tag_ids }))
}

async fn put_permission_profile_tags(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<PutPermissionProfileTagsRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:edit").await?;
    ensure_profile_allowed(&pool, &claims, id).await?;

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM permission_profiles WHERE id = $1)")
        .bind(id)
        .fetch_one(&pool)
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
    if !exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Permission profile not found".to_string(),
                },
            }),
        ));
    }

    set_permission_profile_tags(&pool, id, &payload.tag_ids).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "TAGS_UPDATE_FAILED".to_string(),
                    message: e,
                },
            }),
        )
    })?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_profiles(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<PermissionProfileResponse>>, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:view").await?;

    let allowed_profile_ids: Option<Vec<Uuid>> = if claims.role == "super_admin" {
        None
    } else {
        Some(resolve_allowed_permission_profile_ids_for_user(&pool, claims.sub).await?)
    };

    let service = PermissionProfilesService::new(pool.clone());
    let list = service.list().await.map_err(|e| {
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

    let list: Vec<_> = if let Some(ref allowed) = allowed_profile_ids {
        if allowed.is_empty() {
            vec![]
        } else {
            let allowed_set: std::collections::HashSet<Uuid> = allowed.iter().copied().collect();
            list.into_iter()
                .filter(|(p, _)| allowed_set.contains(&p.id))
                .collect()
        }
    } else {
        list
    };

    let profile_ids: Vec<Uuid> = list.iter().map(|(p, _)| p.id).collect();
    let tag_map = get_permission_profile_tag_ids(&pool, &profile_ids).await;

    let response: Vec<PermissionProfileResponse> = list
        .into_iter()
        .map(|(p, keys)| PermissionProfileResponse {
            id: p.id,
            name: p.name,
            description: p.description,
            permission_keys: keys,
            created_at: p.created_at,
            updated_at: p.updated_at,
            created_by_user_id: p.created_by_user_id,
            created_by_email: p.created_by_email.clone(),
            tag_ids: tag_map.get(&p.id).cloned().unwrap_or_default(),
        })
        .collect();
    Ok(Json(response))
}

async fn list_keys(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<String>>, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:view").await?;
    let keys: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT permission_key FROM permissions ORDER BY permission_key",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_KEYS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    Ok(Json(keys))
}

async fn list_definitions(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<crate::services::permission_profiles_service::CategoryWithPermissions>>, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:view").await?;
    let service = PermissionProfilesService::new(pool.clone());
    let list = service.list_categories_with_permissions().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_DEFINITIONS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    Ok(Json(list))
}

async fn get_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<PermissionProfileResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:view").await?;
    ensure_profile_allowed(&pool, &claims, id).await?;

    let service = PermissionProfilesService::new(pool.clone());
    let Some((p, keys)) = service.get(id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })? else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Permission profile not found".to_string(),
                },
            }),
        ));
    };

    let tag_ids = get_permission_profile_tag_ids(&pool, &[id]).await.remove(&id).unwrap_or_default();

    Ok(Json(PermissionProfileResponse {
        id: p.id,
        name: p.name,
        description: p.description,
        permission_keys: keys,
        created_at: p.created_at,
        updated_at: p.updated_at,
        created_by_user_id: p.created_by_user_id,
        created_by_email: p.created_by_email.clone(),
        tag_ids,
    }))
}

async fn create_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<CreateProfileRequest>,
) -> Result<(StatusCode, Json<PermissionProfileResponse>), (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:edit").await?;

    let service = PermissionProfilesService::new(pool.clone());
    let created_by_user_id = Some(claims.sub);
    let profile = service
        .create(
            &payload.name,
            payload.description.as_deref(),
            &payload.permission_keys,
            created_by_user_id,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "CREATE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let keys = service
        .get(profile.id)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "GET_FAILED".to_string(),
                        message: "Failed to load created profile".to_string(),
                    },
                }),
            )
        })?
        .map(|(_, k)| k)
        .unwrap_or_default();

    Ok((
        StatusCode::CREATED,
        Json(PermissionProfileResponse {
            id: profile.id,
            name: profile.name,
            description: profile.description,
            permission_keys: keys,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
            created_by_user_id: profile.created_by_user_id,
            created_by_email: profile.created_by_email.clone(),
            tag_ids: vec![],
        }),
    ))
}


async fn update_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<PermissionProfileResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:edit").await?;
    ensure_profile_allowed(&pool, &claims, id).await?;

    let service = PermissionProfilesService::new(pool.clone());
    let updated = service
        .update(
            id,
            payload.name.as_deref(),
            payload.description.clone(),
            payload.permission_keys.as_deref(),
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    if updated.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Permission profile not found".to_string(),
                },
            }),
        ));
    }

    let Some((p, keys)) = service.get(id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })? else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Permission profile not found".to_string(),
                },
            }),
        ));
    };

    Ok(Json(PermissionProfileResponse {
        id: p.id,
        name: p.name,
        description: p.description,
        permission_keys: keys,
        created_at: p.created_at,
        updated_at: p.updated_at,
        created_by_user_id: p.created_by_user_id,
        created_by_email: p.created_by_email.clone(),
        tag_ids: get_permission_profile_tag_ids(&pool, &[id]).await.remove(&id).unwrap_or_default(),
    }))
}

async fn delete_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_permission(&pool, &claims, "permissions:edit").await?;
    ensure_profile_allowed(&pool, &claims, id).await?;

    let service = PermissionProfilesService::new(pool.clone());
    service.delete(id).await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DELETE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    Ok(StatusCode::NO_CONTENT)
}
