use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::services::admin_markup_service::AdminMarkupService;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    pub name: String,
    pub description: Option<String>,
    pub group_id: Option<String>,
    pub markup_type: String,
    pub bid_markup: String,
    pub ask_markup: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub name: String,
    pub group_id: Option<String>,
    pub markup_type: String,
    pub bid_markup: String,
    pub ask_markup: String,
}

#[derive(Debug, Deserialize)]
pub struct UpsertSymbolOverrideRequest {
    #[serde(alias = "bidMarkup", default)]
    pub bid_markup: Option<String>,
    #[serde(alias = "askMarkup", default)]
    pub ask_markup: Option<String>,
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
pub struct TransferMarkupsRequest {
    pub target_profile_ids: Vec<String>,
    #[serde(alias = "includeMarkups", default = "default_true")]
    pub include_markups: bool,
}

fn default_true() -> bool {
    true
}

pub fn create_admin_markup_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/profiles", get(list_profiles).post(create_profile))
        .route("/profiles/:id", get(get_profile).put(update_profile))
        .route("/profiles/:id/symbols", get(get_symbol_overrides))
        .route("/profiles/:id/symbols/:symbol_id", put(upsert_symbol_override))
        .route("/profiles/:id/transfer", post(transfer_markups))
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

/// Bid/ask markup is percent-only; reject other types.
fn ensure_percent_markup(markup_type: &str) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if markup_type != "percent" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_MARKUP_TYPE".to_string(),
                    message: "Only percent markup is supported for bid/ask.".to_string(),
                },
            }),
        ));
    }
    Ok(())
}

async fn list_profiles(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "markup:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminMarkupService::new(pool);
    let profiles = service.list_profiles().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_PROFILES_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let items: Vec<serde_json::Value> = profiles
        .into_iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "group_id": p.group_id,
                "group_name": p.group_name,
                "markup_type": p.markup_type,
                "bid_markup": p.bid_markup,
                "ask_markup": p.ask_markup,
                "created_at": p.created_at,
                "updated_at": p.updated_at,
            })
        })
        .collect();

    Ok(Json(items))
}

async fn create_profile(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<CreateProfileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "markup:create")
        .await
        .map_err(permission_denied_to_response)?;
    ensure_percent_markup(&payload.markup_type)?;

    let service = AdminMarkupService::new(pool);
    let profile = service
        .create_profile(
            &payload.name,
            payload.description.as_deref(),
            None,
            "percent",
            &payload.bid_markup,
            &payload.ask_markup,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "CREATE_PROFILE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    Ok(Json(serde_json::json!({
        "id": profile.id,
        "name": profile.name,
        "description": profile.description,
        "group_id": profile.group_id,
        "markup_type": profile.markup_type,
        "bid_markup": profile.bid_markup,
        "ask_markup": profile.ask_markup,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    })))
}

async fn get_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "markup:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminMarkupService::new(pool);
    let profile = service.get_profile_by_id(id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "PROFILE_NOT_FOUND".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(Json(serde_json::json!({
        "id": profile.id,
        "name": profile.name,
        "description": profile.description,
        "group_id": profile.group_id,
        "markup_type": profile.markup_type,
        "bid_markup": profile.bid_markup,
        "ask_markup": profile.ask_markup,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    })))
}

async fn update_profile(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "markup:edit")
        .await
        .map_err(permission_denied_to_response)?;
    ensure_percent_markup(&payload.markup_type)?;

    let service = AdminMarkupService::new(pool);
    let profile = service
        .update_profile(
            id,
            &payload.name,
            None,
            "percent",
            &payload.bid_markup,
            &payload.ask_markup,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_PROFILE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    Ok(Json(serde_json::json!({
        "id": profile.id,
        "name": profile.name,
        "description": profile.description,
        "group_id": profile.group_id,
        "markup_type": profile.markup_type,
        "bid_markup": profile.bid_markup,
        "ask_markup": profile.ask_markup,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    })))
}

async fn get_symbol_overrides(
    State(pool): State<PgPool>,
    Path(profile_id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "markup:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminMarkupService::new(pool);
    let overrides = service.get_symbol_overrides(profile_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_OVERRIDES_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let items: Vec<serde_json::Value> = overrides
        .into_iter()
        .map(|o| {
            serde_json::json!({
                "id": o.id,
                "profile_id": o.profile_id,
                "symbol_id": o.symbol_id,
                "symbol_code": o.symbol_code,
                "bid_markup": o.bid_markup,
                "ask_markup": o.ask_markup,
                "created_at": o.created_at,
                "updated_at": o.updated_at,
            })
        })
        .collect();

    Ok(Json(items))
}

/// Normalize markup string for DB: empty or non-numeric becomes "0".
fn normalize_markup(s: &str) -> String {
    let s = s.trim();
    if s.is_empty() {
        return "0".to_string();
    }
    if s.parse::<f64>().is_ok() {
        return s.to_string();
    }
    "0".to_string()
}

async fn upsert_symbol_override(
    State(pool): State<PgPool>,
    Path((profile_id, symbol_id)): Path<(Uuid, Uuid)>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<UpsertSymbolOverrideRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "markup:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let bid_markup = normalize_markup(payload.bid_markup.as_deref().unwrap_or(""));
    let ask_markup = normalize_markup(payload.ask_markup.as_deref().unwrap_or(""));

    let service = AdminMarkupService::new(pool);

    let override_data = service
        .upsert_symbol_override(
            profile_id,
            symbol_id,
            &bid_markup,
            &ask_markup,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPSERT_OVERRIDE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    // Resolve groups that use this profile and sync Redis (SET keys, SADD price:groups, PUBLISH)
    let group_ids = service
        .get_group_ids_by_profile_id(profile_id)
        .await
        .unwrap_or_default();
    sync_redis_markup_for_override(
        &override_data.symbol_code,
        &bid_markup,
        &ask_markup,
        &group_ids,
    )
    .await;

    Ok(Json(serde_json::json!({
        "id": override_data.id,
        "profile_id": override_data.profile_id,
        "symbol_id": override_data.symbol_id,
        "symbol_code": override_data.symbol_code,
        "bid_markup": override_data.bid_markup,
        "ask_markup": override_data.ask_markup,
        "created_at": override_data.created_at,
        "updated_at": override_data.updated_at,
    })))
}

async fn transfer_markups(
    State(pool): State<PgPool>,
    Path(source_id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<TransferMarkupsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "markup:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let target_ids: Vec<Uuid> = payload
        .target_profile_ids
        .iter()
        .filter_map(|s| Uuid::parse_str(s).ok())
        .collect();
    if target_ids.len() != payload.target_profile_ids.len() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_TARGET_IDS".to_string(),
                    message: "All target_profile_ids must be valid UUIDs.".to_string(),
                },
            }),
        ));
    }

    let service = AdminMarkupService::new(pool.clone());
    let copied = service
        .copy_profile_markups_to_profiles(source_id, &target_ids, payload.include_markups)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "TRANSFER_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    // Sync Redis for each target profile so groups get updated markups
    for &target_id in &target_ids {
        let group_ids = service
            .get_group_ids_by_profile_id(target_id)
            .await
            .unwrap_or_default();
        let overrides = service.get_symbol_overrides(target_id).await.unwrap_or_default();
        for o in &overrides {
            sync_redis_markup_for_override(
                &o.symbol_code,
                &o.bid_markup,
                &o.ask_markup,
                &group_ids,
            )
            .await;
        }
    }

    Ok(Json(serde_json::json!({
        "message": "Transfer completed",
        "copied_overrides": copied,
    })))
}

/// Per-group price stream: write markup to Redis for each group that uses the profile,
/// add groups to price:groups set, and publish markup:update so data-provider can refresh.
async fn sync_redis_markup_for_override(
    symbol_code: &str,
    bid_markup: &str,
    ask_markup: &str,
    group_ids: &[Uuid],
) {
    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());

    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_connection() {
            let markup_value = serde_json::json!({
                "bid_markup": bid_markup.parse::<f64>().unwrap_or(0.0),
                "ask_markup": ask_markup.parse::<f64>().unwrap_or(0.0),
                "type": "percent",
            })
            .to_string();

            for &group_id in group_ids {
                let key = format!("symbol:markup:{}:{}", symbol_code, group_id);
                let _: Result<(), _> = redis::cmd("SET").arg(&key).arg(&markup_value).query(&mut conn);
                let _: Result<(), _> = redis::cmd("SADD").arg("price:groups").arg(group_id.to_string()).query(&mut conn);
            }

            let channel = "markup:update";
            let message = serde_json::json!({
                "symbol": symbol_code,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            let _: Result<(), _> = redis::cmd("PUBLISH")
                .arg(channel)
                .arg(message.to_string())
                .query(&mut conn);
        }
    }
}

