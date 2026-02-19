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
use std::sync::Arc;
use uuid::Uuid;

use redis::AsyncCommands;
use crate::middleware::auth_middleware;
use crate::models::user_group::UserGroup;
use crate::services::admin_groups_service::{AdminGroupsService, GroupSymbolInput};
use crate::services::admin_markup_service::AdminMarkupService;
use crate::utils::jwt::Claims;

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub margin_call_level: Option<f64>,
    pub stop_out_level: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub margin_call_level: Option<f64>,
    pub stop_out_level: Option<f64>,
}

/// Reference to a profile (price stream or leverage) for embedding in group list.
#[derive(Debug, Clone, Serialize)]
pub struct ProfileRef {
    pub id: Uuid,
    pub name: String,
}

/// Group list item with assigned price and leverage profile details (all-in-one for API consumers).
#[derive(Debug, Clone, Serialize)]
pub struct GroupListItem {
    #[serde(flatten)]
    pub group: UserGroup,
    /// Assigned price stream profile (id + name). Null if none assigned.
    pub price_profile: Option<ProfileRef>,
    /// Assigned leverage profile (id + name). Null if none assigned.
    pub leverage_profile: Option<ProfileRef>,
}

#[derive(Debug, Serialize)]
pub struct ListGroupsResponse {
    pub items: Vec<GroupListItem>,
    /// All price stream profiles for the Price Stream Profile dropdown (id + name).
    pub available_price_profiles: Vec<ProfileRef>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct UsageResponse {
    pub users_count: i64,
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

pub fn create_admin_groups_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_groups).post(create_group))
        .route("/:id", get(get_group).put(update_group).delete(delete_group))
        .route("/:id/usage", get(get_group_usage))
        .route("/:id/price-profile", put(update_group_price_profile))
        .route("/:id/leverage-profile", put(update_group_leverage_profile))
        .route("/:id/symbols", get(get_group_symbols).put(update_group_symbols))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn list_groups(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ListGroupsResponse>, (StatusCode, Json<ErrorResponse>)> {
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

    let service = AdminGroupsService::new(pool);
    let search = params.get("search").map(|s| s.as_str());
    let status = params.get("status").map(|s| s.as_str());
    let page = params
        .get("page")
        .and_then(|s| s.parse::<i64>().ok());
    let page_size = params
        .get("page_size")
        .and_then(|s| s.parse::<i64>().ok());
    let sort = params.get("sort").map(|s| s.as_str());

    match service.list_groups(search, status, page, page_size, sort).await {
        Ok((groups, total)) => {
            let page = page.unwrap_or(1);
            let page_size = page_size.unwrap_or(20);

            // Collect profile IDs to fetch names (all-in-one response)
            let price_ids: Vec<Uuid> = groups
                .iter()
                .filter_map(|g| g.default_price_profile_id)
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            let leverage_ids: Vec<Uuid> = groups
                .iter()
                .filter_map(|g| g.default_leverage_profile_id)
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();

            let price_names = service
                .get_price_profile_names(&price_ids)
                .await
                .unwrap_or_default();
            let leverage_names = service
                .get_leverage_profile_names(&leverage_ids)
                .await
                .unwrap_or_default();

            let items: Vec<GroupListItem> = groups
                .into_iter()
                .map(|group| {
                    let price_profile = group.default_price_profile_id.map(|id| ProfileRef {
                        name: price_names.get(&id).cloned().unwrap_or_else(|| "Unknown".to_string()),
                        id,
                    });
                    let leverage_profile = group.default_leverage_profile_id.map(|id| ProfileRef {
                        name: leverage_names.get(&id).cloned().unwrap_or_else(|| "Unknown".to_string()),
                        id,
                    });
                    GroupListItem {
                        group,
                        price_profile,
                        leverage_profile,
                    }
                })
                .collect();

            let available_price_profiles: Vec<ProfileRef> = service
                .list_all_price_profiles()
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|(id, name)| ProfileRef { id, name })
                .collect();

            Ok(Json(ListGroupsResponse {
                items,
                available_price_profiles,
                page,
                page_size,
                total,
            }))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_GROUPS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn get_group(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<UserGroup>, (StatusCode, Json<ErrorResponse>)> {
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

    let service = AdminGroupsService::new(pool);
    match service.get_group_by_id(id).await {
        Ok(group) => Ok(Json(group)),
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GROUP_NOT_FOUND".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn create_group(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<CreateGroupRequest>,
) -> Result<Json<UserGroup>, (StatusCode, Json<ErrorResponse>)> {
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

    let service = AdminGroupsService::new(pool);
    match service
        .create_group(
            &payload.name,
            payload.description.as_deref(),
            &payload.status,
            payload.margin_call_level,
            payload.stop_out_level,
        )
        .await
    {
        Ok(group) => Ok(Json(group)),
        Err(e) => {
            let code = if e.to_string().contains("already exists") || e.to_string().contains("unique") {
                "GROUP_NAME_EXISTS"
            } else if e.to_string().contains("between 2 and 40") {
                "INVALID_NAME_LENGTH"
            } else {
                "CREATE_GROUP_FAILED"
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

async fn update_group(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::extract::Extension(redis): axum::extract::Extension<Arc<redis::Client>>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateGroupRequest>,
) -> Result<Json<UserGroup>, (StatusCode, Json<ErrorResponse>)> {
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

    let service = AdminGroupsService::new(pool);
    match service
        .update_group(
            id,
            &payload.name,
            payload.description.as_deref(),
            &payload.status,
            payload.margin_call_level,
            payload.stop_out_level,
        )
        .await
    {
        Ok(group) => {
            // Update Redis cache so account summary sees new thresholds immediately
            let key = redis_model::keys::Keys::group(id);
            if let Ok(mut conn) = redis.get_async_connection().await {
                if let Some(ref d) = group.margin_call_level {
                    let _: Result<(), _> = conn.hset(&key, "margin_call_level", d.to_string()).await;
                } else {
                    let _: Result<(), _> = conn.hdel(&key, "margin_call_level").await;
                }
                if let Some(ref d) = group.stop_out_level {
                    let _: Result<(), _> = conn.hset(&key, "stop_out_level", d.to_string()).await;
                } else {
                    let _: Result<(), _> = conn.hdel(&key, "stop_out_level").await;
                }
            }
            Ok(Json(group))
        }
        Err(e) => {
            let code = if e.to_string().contains("not found") {
                "GROUP_NOT_FOUND"
            } else if e.to_string().contains("between 2 and 40") {
                "INVALID_NAME_LENGTH"
            } else {
                "UPDATE_GROUP_FAILED"
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

async fn delete_group(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
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

    let service = AdminGroupsService::new(pool);
    match service.delete_group(id).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            let (status, code) = if e.to_string().contains("assigned users") {
                (StatusCode::CONFLICT, "GROUP_IN_USE")
            } else if e.to_string().contains("not found") {
                (StatusCode::NOT_FOUND, "GROUP_NOT_FOUND")
            } else {
                (StatusCode::BAD_REQUEST, "DELETE_GROUP_FAILED")
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

async fn get_group_usage(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<UsageResponse>, (StatusCode, Json<ErrorResponse>)> {
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

    let service = AdminGroupsService::new(pool);
    match service.get_group_usage(id).await {
        Ok(count) => Ok(Json(UsageResponse { users_count: count })),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_USAGE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdatePriceProfileRequest {
    pub price_profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLeverageProfileRequest {
    pub leverage_profile_id: Option<String>,
}

async fn update_group_price_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdatePriceProfileRequest>,
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

    // Parse price_profile_id
    let price_profile_id: Option<Uuid> = if let Some(profile_id_str) = payload.price_profile_id {
        match Uuid::parse_str(&profile_id_str) {
            Ok(uuid) => Some(uuid),
            Err(_) => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "INVALID_PROFILE_ID".to_string(),
                            message: "Invalid price profile ID format".to_string(),
                        },
                    }),
                ));
            }
        }
    } else {
        None
    };

    // Verify profile exists if provided
    if let Some(profile_id) = price_profile_id {
        let profile_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM price_stream_profiles WHERE id = $1)",
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

        if !profile_exists {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "PROFILE_NOT_FOUND".to_string(),
                        message: "Price stream profile not found".to_string(),
                    },
                }),
            ));
        }
    }

    // Verify group exists
    let group_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_groups WHERE id = $1)",
    )
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

    // Update group's price profile
    let rows_affected = sqlx::query(
        "UPDATE user_groups SET default_price_profile_id = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(price_profile_id)
    .bind(id)
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
                    code: "GROUP_NOT_FOUND".to_string(),
                    message: "Group not found".to_string(),
                },
            }),
        ));
    }

    // Sync Redis for per-group price stream (clear old markup for group, write new profile overrides)
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let markup_service = AdminMarkupService::new(pool);
    if let Err(e) = markup_service.sync_redis_after_group_profile_change(id, price_profile_id, &redis_url).await {
        tracing::warn!("Redis sync after group profile change failed (non-fatal): {}", e);
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Group price stream profile updated successfully"
    })))
}

async fn update_group_leverage_profile(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateLeverageProfileRequest>,
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

    // Parse leverage_profile_id
    let leverage_profile_id: Option<Uuid> = if let Some(profile_id_str) = payload.leverage_profile_id {
        match Uuid::parse_str(&profile_id_str) {
            Ok(uuid) => Some(uuid),
            Err(_) => {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "INVALID_PROFILE_ID".to_string(),
                            message: "Invalid leverage profile ID format".to_string(),
                        },
                    }),
                ));
            }
        }
    } else {
        None
    };

    // Verify profile exists if provided
    if let Some(profile_id) = leverage_profile_id {
        let profile_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM leverage_profiles WHERE id = $1)",
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
    }

    // Verify group exists
    let group_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_groups WHERE id = $1)",
    )
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

    // Update group's leverage profile
    let rows_affected = sqlx::query(
        "UPDATE user_groups SET default_leverage_profile_id = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(leverage_profile_id)
    .bind(id)
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
                    code: "GROUP_NOT_FOUND".to_string(),
                    message: "Group not found".to_string(),
                },
            }),
        ));
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Group leverage profile updated successfully"
    })))
}

#[derive(Debug, Serialize)]
pub struct GroupSymbolItem {
    pub symbol_id: Uuid,
    pub symbol_code: String,
    pub leverage_profile_id: Option<Uuid>,
    pub leverage_profile_name: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
pub struct ListGroupSymbolsResponse {
    pub items: Vec<GroupSymbolItem>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupSymbolsRequest {
    pub symbols: Vec<GroupSymbolItemPayload>,
}

#[derive(Debug, Deserialize)]
pub struct GroupSymbolItemPayload {
    pub symbol_id: String,
    #[serde(default)]
    pub leverage_profile_id: Option<String>,
    pub enabled: bool,
}

async fn get_group_symbols(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<ListGroupSymbolsResponse>, (StatusCode, Json<ErrorResponse>)> {
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
    let service = AdminGroupsService::new(pool);
    match service.list_group_symbols(id).await {
        Ok(rows) => {
            let items = rows
                .into_iter()
                .map(|r| GroupSymbolItem {
                    symbol_id: r.symbol_id,
                    symbol_code: r.symbol_code,
                    leverage_profile_id: r.leverage_profile_id,
                    leverage_profile_name: r.leverage_profile_name,
                    enabled: r.enabled,
                })
                .collect();
            Ok(Json(ListGroupSymbolsResponse { items }))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_GROUP_SYMBOLS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn update_group_symbols(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateGroupSymbolsRequest>,
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
    let group_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_groups WHERE id = $1)")
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
    let mut inputs = Vec::with_capacity(payload.symbols.len());
    for s in &payload.symbols {
        let symbol_id = Uuid::parse_str(&s.symbol_id).map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_SYMBOL_ID".to_string(),
                        message: format!("Invalid symbol_id: {}", s.symbol_id),
                    },
                }),
            )
        })?;
        let leverage_profile_id = match s.leverage_profile_id.as_ref().filter(|x| !x.is_empty()) {
            None => None,
            Some(id_str) => Some(Uuid::parse_str(id_str).map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "INVALID_LEVERAGE_PROFILE_ID".to_string(),
                            message: format!("Invalid leverage_profile_id: {}", id_str),
                        },
                    }),
                )
            })?),
        };
        inputs.push(GroupSymbolInput {
            symbol_id,
            leverage_profile_id,
            enabled: s.enabled,
        });
    }
    let service = AdminGroupsService::new(pool);
    if let Err(e) = service.upsert_group_symbols(id, &inputs).await {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "UPDATE_GROUP_SYMBOLS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        ));
    }
    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Group symbol settings saved"
    })))
}

