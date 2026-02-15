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
    pub bid_markup: String,
    pub ask_markup: String,
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

pub fn create_admin_markup_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/profiles", get(list_profiles).post(create_profile))
        .route("/profiles/:id", get(get_profile).put(update_profile))
        .route("/profiles/:id/symbols", get(get_symbol_overrides))
        .route("/profiles/:id/symbols/:symbol_id", put(upsert_symbol_override))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

fn check_admin(claims: &Claims) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Admin access required".to_string(),
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
    check_admin(&claims)?;

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
    check_admin(&claims)?;

    let service = AdminMarkupService::new(pool);
    // Assignment is group → profile (on Groups page); profile no longer has group_id
    let profile = service
        .create_profile(
            &payload.name,
            payload.description.as_deref(),
            None,
            &payload.markup_type,
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
    check_admin(&claims)?;

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
    check_admin(&claims)?;

    let service = AdminMarkupService::new(pool);
    // Assignment is group → profile (on Groups page); profile no longer has group_id
    let profile = service
        .update_profile(
            id,
            &payload.name,
            None,
            &payload.markup_type,
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
    check_admin(&claims)?;

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

async fn upsert_symbol_override(
    State(pool): State<PgPool>,
    Path((profile_id, symbol_id)): Path<(Uuid, Uuid)>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<UpsertSymbolOverrideRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let service = AdminMarkupService::new(pool);

    let override_data = service
        .upsert_symbol_override(
            profile_id,
            symbol_id,
            &payload.bid_markup,
            &payload.ask_markup,
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

    // Publish Redis event
    publish_markup_update(&override_data.symbol_code, &payload.bid_markup, &payload.ask_markup, profile_id).await;

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

// Redis pubsub helper
async fn publish_markup_update(symbol_code: &str, bid_markup: &str, ask_markup: &str, profile_id: Uuid) {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    
    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_connection() {
            // Get group name from profile - simplified version
            let group_name = "default"; // TODO: Fetch from DB if needed
            
            let channel = "markup:update";
            let message = serde_json::json!({
                "symbol": symbol_code,
                "group": group_name,
                "bid_markup": bid_markup,
                "ask_markup": ask_markup,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            
            let _: Result<(), _> = redis::cmd("PUBLISH")
                .arg(channel)
                .arg(message.to_string())
                .query(&mut conn);
        }
    }
}

