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
use uuid::Uuid;

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

pub fn create_admin_permission_profiles_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_profiles).post(create_profile))
        .route("/keys", get(list_keys))
        .route("/:id", get(get_profile).put(update_profile).delete(delete_profile))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn list_profiles(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<PermissionProfileResponse>>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can list permission profiles".to_string(),
                },
            }),
        ));
    }

    let service = PermissionProfilesService::new(pool);
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

    let response: Vec<PermissionProfileResponse> = list
        .into_iter()
        .map(|(p, keys)| PermissionProfileResponse {
            id: p.id,
            name: p.name,
            description: p.description,
            permission_keys: keys,
            created_at: p.created_at,
            updated_at: p.updated_at,
        })
        .collect();
    Ok(Json(response))
}

async fn list_keys(
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<String>>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can list permission keys".to_string(),
                },
            }),
        ));
    }
    let keys: Vec<String> = crate::services::permission_profiles_service::ALL_PERMISSION_KEYS
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    Ok(Json(keys))
}

async fn get_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<PermissionProfileResponse>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can get permission profile".to_string(),
                },
            }),
        ));
    }

    let service = PermissionProfilesService::new(pool);
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
    }))
}

async fn create_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<CreateProfileRequest>,
) -> Result<(StatusCode, Json<PermissionProfileResponse>), (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can create permission profiles".to_string(),
                },
            }),
        ));
    }

    let service = PermissionProfilesService::new(pool);
    let profile = service
        .create(
            &payload.name,
            payload.description.as_deref(),
            &payload.permission_keys,
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
        }),
    ))
}


async fn update_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<PermissionProfileResponse>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can update permission profiles".to_string(),
                },
            }),
        ));
    }

    let service = PermissionProfilesService::new(pool);
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
    }))
}

async fn delete_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can delete permission profiles".to_string(),
                },
            }),
        ));
    }

    let service = PermissionProfilesService::new(pool);
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
