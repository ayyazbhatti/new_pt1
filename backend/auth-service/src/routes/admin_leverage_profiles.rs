use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::models::leverage_profile::{LeverageProfile, LeverageProfileTier, LeverageProfileWithCounts};
use crate::services::admin_leverage_profiles_service::{AdminLeverageProfilesService, SymbolInfo};
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    pub name: String,
    pub description: Option<String>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub name: String,
    pub description: Option<String>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateTierRequest {
    pub tier_index: i32,
    pub notional_from: String,
    pub notional_to: Option<String>,
    pub max_leverage: i32,
    pub initial_margin_percent: String,
    pub maintenance_margin_percent: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTierRequest {
    pub tier_index: i32,
    pub notional_from: String,
    pub notional_to: Option<String>,
    pub max_leverage: i32,
    pub initial_margin_percent: String,
    pub maintenance_margin_percent: String,
}

#[derive(Debug, Deserialize)]
pub struct SetProfileSymbolsRequest {
    pub symbol_ids: Vec<Uuid>,
}

/// List item with tag_ids for the frontend (flattened so JSON has id, name, ..., tag_ids).
#[derive(Debug, Serialize)]
pub struct ProfileListItem {
    #[serde(flatten)]
    pub profile: LeverageProfileWithCounts,
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ListProfilesResponse {
    pub items: Vec<ProfileListItem>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct LeverageProfileTagsResponse {
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct PutLeverageProfileTagsRequest {
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ProfileSymbolsResponse {
    pub assigned: Vec<SymbolInfo>,
    pub unassigned: Vec<SymbolInfo>,
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

pub fn create_admin_leverage_profiles_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_profiles).post(create_profile))
        .route("/:id", get(get_profile).put(update_profile).delete(delete_profile))
        .route("/:id/tiers", get(list_tiers).post(create_tier))
        .route("/:id/tiers/:tier_id", put(update_tier).delete(delete_tier))
        .route("/:id/symbols", get(get_profile_symbols).put(set_profile_symbols))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

/// Router for GET/PUT leverage profile tags. Mount at `/api/admin/leverage-profile-tags` so path is `/:id`.
pub fn create_admin_leverage_profile_tags_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/:id", get(get_leverage_profile_tags).put(put_leverage_profile_tags))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

fn permission_denied_to_response(e: permission_check::PermissionDenied) -> (StatusCode, Json<ErrorResponse>) {
    (
        e.status,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: e.code,
                message: e.message,
            },
        }),
    )
}

/// Resolve leverage profile IDs the user is allowed to see: profiles that share a tag with the user, plus profiles the user created.
/// Super_admin should not use this (pass None to list_profiles).
async fn resolve_allowed_leverage_profile_ids_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Uuid>, (StatusCode, Json<ErrorResponse>)> {
    use std::collections::HashSet;

    let mut allowed: HashSet<Uuid> = HashSet::new();

    // 1) Profiles that share at least one tag with the user
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
    if !user_tag_ids.is_empty() {
        #[derive(sqlx::FromRow)]
        struct ProfileRow {
            entity_id: Uuid,
        }
        let profile_rows = sqlx::query_as::<_, ProfileRow>(
            "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'leverage_profile' AND tag_id = ANY($1)",
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
        for r in profile_rows {
            allowed.insert(r.entity_id);
        }
    }

    // 2) Profiles created by this user (admin sees their own created profiles even without tag match)
    #[derive(sqlx::FromRow)]
    struct IdRow {
        id: Uuid,
    }
    let created_rows = sqlx::query_as::<_, IdRow>(
        "SELECT id FROM leverage_profiles WHERE created_by_user_id = $1",
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
    for r in created_rows {
        allowed.insert(r.id);
    }

    Ok(allowed.into_iter().collect())
}

async fn list_profiles(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ListProfilesResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:view")
        .await
        .map_err(permission_denied_to_response)?;

    let allowed_profile_ids: Option<Vec<Uuid>> = if claims.role == "super_admin" {
        None
    } else {
        let ids = resolve_allowed_leverage_profile_ids_for_user(&pool, claims.sub).await?;
        Some(ids)
    };

    let service = AdminLeverageProfilesService::new(pool);
    let search = params.get("search").map(|s| s.as_str());
    let status = params.get("status").map(|s| s.as_str());
    let page = params.get("page").and_then(|s| s.parse::<i64>().ok());
    let page_size = params.get("page_size").and_then(|s| s.parse::<i64>().ok());
    let sort = params.get("sort").map(|s| s.as_str());

    match service
        .list_profiles(search, status, page, page_size, sort, allowed_profile_ids.as_deref())
        .await
    {
        Ok((profiles, total)) => {
            let page = page.unwrap_or(1);
            let page_size = page_size.unwrap_or(20);
            let profile_ids: Vec<Uuid> = profiles.iter().map(|p| p.id).collect();
            let tag_map = service
                .get_tag_ids_for_leverage_profiles(&profile_ids)
                .await
                .unwrap_or_default();
            let items: Vec<ProfileListItem> = profiles
                .into_iter()
                .map(|profile| ProfileListItem {
                    tag_ids: tag_map.get(&profile.id).cloned().unwrap_or_default(),
                    profile,
                })
                .collect();
            Ok(Json(ListProfilesResponse {
                items,
                page,
                page_size,
                total,
            }))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_PROFILES_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn get_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<LeverageProfile>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service.get_profile_by_id(id).await {
        Ok(profile) => Ok(Json(profile)),
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "PROFILE_NOT_FOUND".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn create_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<CreateProfileRequest>,
) -> Result<Json<LeverageProfile>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:create")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service
        .create_profile(&payload.name, payload.description.as_deref(), &payload.status, Some(claims.sub))
        .await
    {
        Ok(profile) => Ok(Json(profile)),
        Err(e) => {
            let code = if e.to_string().contains("already exists") || e.to_string().contains("unique") {
                "PROFILE_NAME_EXISTS"
            } else if e.to_string().contains("between 2 and 60") {
                "INVALID_NAME_LENGTH"
            } else {
                "CREATE_PROFILE_FAILED"
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

async fn update_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<LeverageProfile>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service
        .update_profile(id, &payload.name, payload.description.as_deref(), &payload.status)
        .await
    {
        Ok(profile) => Ok(Json(profile)),
        Err(e) => {
            let code = if e.to_string().contains("not found") {
                "PROFILE_NOT_FOUND"
            } else if e.to_string().contains("between 2 and 60") {
                "INVALID_NAME_LENGTH"
            } else {
                "UPDATE_PROFILE_FAILED"
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

async fn delete_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:delete")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service.delete_profile(id).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            let (status, code) = if e.to_string().contains("assigned symbols") {
                (StatusCode::CONFLICT, "PROFILE_IN_USE")
            } else if e.to_string().contains("not found") {
                (StatusCode::NOT_FOUND, "PROFILE_NOT_FOUND")
            } else {
                (StatusCode::BAD_REQUEST, "DELETE_PROFILE_FAILED")
            };
            Err((
                status,
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

async fn list_tiers(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<LeverageProfileTier>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service.list_tiers(id).await {
        Ok(tiers) => Ok(Json(tiers)),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_TIERS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn create_tier(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<CreateTierRequest>,
) -> Result<Json<LeverageProfileTier>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:create")
        .await
        .map_err(permission_denied_to_response)?;

    // Validate numeric strings (service will parse)
    if payload.notional_from.parse::<f64>().is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_NOTIONAL_FROM".to_string(),
                    message: "Invalid notional_from value".to_string(),
                },
            }),
        ));
    }

    if let Some(ref to) = payload.notional_to {
        if to.parse::<f64>().is_err() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_NOTIONAL_TO".to_string(),
                        message: "Invalid notional_to value".to_string(),
                    },
                }),
            ));
        }
    }

    if payload.initial_margin_percent.parse::<f64>().is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INITIAL_MARGIN".to_string(),
                    message: "Invalid initial_margin_percent value".to_string(),
                },
            }),
        ));
    }

    if payload.maintenance_margin_percent.parse::<f64>().is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_MAINTENANCE_MARGIN".to_string(),
                    message: "Invalid maintenance_margin_percent value".to_string(),
                },
            }),
        ));
    }

    let service = AdminLeverageProfilesService::new(pool);
    match service
        .create_tier(
            id,
            payload.tier_index,
            payload.notional_from,
            payload.notional_to,
            payload.max_leverage,
            payload.initial_margin_percent,
            payload.maintenance_margin_percent,
        )
        .await
    {
        Ok(tier) => Ok(Json(tier)),
        Err(e) => {
            let code = if e.to_string().contains("overlap") {
                "TIER_OVERLAP"
            } else {
                "CREATE_TIER_FAILED"
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

async fn update_tier(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path((id, tier_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateTierRequest>,
) -> Result<Json<LeverageProfileTier>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:edit")
        .await
        .map_err(permission_denied_to_response)?;

    // Validate numeric strings (service will parse)
    if payload.notional_from.parse::<f64>().is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_NOTIONAL_FROM".to_string(),
                    message: "Invalid notional_from value".to_string(),
                },
            }),
        ));
    }

    if let Some(ref to) = payload.notional_to {
        if to.parse::<f64>().is_err() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_NOTIONAL_TO".to_string(),
                        message: "Invalid notional_to value".to_string(),
                    },
                }),
            ));
        }
    }

    if payload.initial_margin_percent.parse::<f64>().is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INITIAL_MARGIN".to_string(),
                    message: "Invalid initial_margin_percent value".to_string(),
                },
            }),
        ));
    }

    if payload.maintenance_margin_percent.parse::<f64>().is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_MAINTENANCE_MARGIN".to_string(),
                    message: "Invalid maintenance_margin_percent value".to_string(),
                },
            }),
        ));
    }

    let service = AdminLeverageProfilesService::new(pool);
    match service
        .update_tier(
            tier_id,
            id,
            payload.tier_index,
            payload.notional_from,
            payload.notional_to,
            payload.max_leverage,
            payload.initial_margin_percent,
            payload.maintenance_margin_percent,
        )
        .await
    {
        Ok(tier) => Ok(Json(tier)),
        Err(e) => {
            let code = if e.to_string().contains("overlap") {
                "TIER_OVERLAP"
            } else {
                "UPDATE_TIER_FAILED"
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

async fn delete_tier(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path((_id, tier_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:delete")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service.delete_tier(tier_id).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DELETE_TIER_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn get_profile_symbols(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<ProfileSymbolsResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service.get_profile_symbols(id).await {
        Ok((assigned, unassigned)) => Ok(Json(ProfileSymbolsResponse {
            assigned,
            unassigned,
        })),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_PROFILE_SYMBOLS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn set_profile_symbols(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<SetProfileSymbolsRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminLeverageProfilesService::new(pool);
    match service.set_profile_symbols(id, &payload.symbol_ids).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "SET_PROFILE_SYMBOLS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn get_leverage_profile_tags(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<LeverageProfileTagsResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:view")
        .await
        .map_err(permission_denied_to_response)?;
    let service = AdminLeverageProfilesService::new(pool);
    let profile_ids = vec![id];
    let map = service.get_tag_ids_for_leverage_profiles(&profile_ids).await.map_err(|e| {
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
    let tag_ids = map.get(&id).cloned().unwrap_or_default();
    Ok(Json(LeverageProfileTagsResponse { tag_ids }))
}

async fn put_leverage_profile_tags(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<PutLeverageProfileTagsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "leverage_profiles:edit")
        .await
        .map_err(permission_denied_to_response)?;
    let profile_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM leverage_profiles WHERE id = $1)")
            .bind(id)
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
    if !profile_exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "PROFILE_NOT_FOUND".to_string(),
                    message: "Leverage profile not found".to_string(),
                },
            }),
        ));
    }
    let service = AdminLeverageProfilesService::new(pool);
    if let Err(e) = service.set_leverage_profile_tags(id, &payload.tag_ids).await {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "UPDATE_PROFILE_TAGS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        ));
    }
    Ok(Json(serde_json::json!({ "success": true })))
}

