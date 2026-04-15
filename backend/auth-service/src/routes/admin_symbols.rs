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
use crate::services::admin_symbols_service::{AdminSymbolsService, SyncMmdpsResult};
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Deserialize)]
pub struct CreateSymbolRequest {
    pub symbol_code: String,
    pub provider_symbol: String,
    pub asset_class: String,
    pub base_currency: String,
    pub quote_currency: String,
    pub price_precision: i32,
    pub volume_precision: i32,
    pub contract_size: String,
    pub tick_size: Option<String>,
    pub lot_min: Option<String>,
    pub lot_max: Option<String>,
    pub default_pip_position: Option<String>,
    pub pip_position_min: Option<String>,
    pub pip_position_max: Option<String>,
    pub leverage_profile_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSymbolRequest {
    pub symbol_code: String,
    pub provider_symbol: String,
    pub asset_class: String,
    pub base_currency: String,
    pub quote_currency: String,
    pub price_precision: i32,
    pub volume_precision: i32,
    pub contract_size: String,
    pub tick_size: Option<String>,
    pub lot_min: Option<String>,
    pub lot_max: Option<String>,
    pub default_pip_position: Option<String>,
    pub pip_position_min: Option<String>,
    pub pip_position_max: Option<String>,
    pub is_enabled: bool,
    pub trading_enabled: bool,
    pub leverage_profile_id: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct SyncMmdpsRequest {
    /// When true (default), imports Forex pairs that match the 6-letter pattern.
    #[serde(default = "default_true")]
    pub enable_forex: bool,
    /// When true (default), imports Metals CFDs that match the 6-letter pattern.
    #[serde(default = "default_true")]
    pub enable_metals: bool,
    /// When true (default), imports equities, indices, and any unknown category (catch-all).
    #[serde(default = "default_true")]
    pub enable_stocks: bool,
    #[serde(default = "default_true")]
    pub enable_crypto: bool,
    /// When true: after import, set `is_enabled`/`trading_enabled` false for **Stocks** and **Indices**
    /// rows whose `code` is not in the MMDPS `/feed/symbols` response. **Does not** change Crypto/Binance
    /// or forex/metals/commodities rows.
    #[serde(default)]
    pub prune_stocks_not_in_mmdps_feed: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListSymbolsQuery {
    pub search: Option<String>,
    pub asset_class: Option<String>,
    pub is_enabled: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub sort: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListSymbolsResponse {
    pub items: Vec<serde_json::Value>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
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

pub fn create_admin_symbols_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_symbols).post(create_symbol))
        .route("/sync-mmdps", post(sync_mmdps))
        .route("/:id", get(get_symbol).put(update_symbol).delete(delete_symbol))
        .route("/:id/toggle-enabled", put(toggle_enabled))
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

async fn list_symbols(
    State(pool): State<PgPool>,
    Query(params): Query<ListSymbolsQuery>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<ListSymbolsResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "symbols:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminSymbolsService::new(pool);
    let is_enabled = params.is_enabled.as_ref().and_then(|s| {
        match s.as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        }
    });

    let (symbols, total) = service
        .list_symbols(
            params.search.as_deref(),
            params.asset_class.as_deref(),
            is_enabled,
            params.page,
            params.page_size,
            params.sort.as_deref(),
        )
        .await
        .map_err(|e| {
            let msg = e.to_string();
            tracing::error!(error = %msg, "admin symbols list failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "LIST_SYMBOLS_FAILED".to_string(),
                        message: msg,
                    },
                }),
            )
        })?;

    let items: Vec<serde_json::Value> = symbols
        .into_iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id,
                "symbol_code": s.symbol_code,
                "provider_symbol": s.provider_symbol,
                "asset_class": s.asset_class,
                "base_currency": s.base_currency,
                "quote_currency": s.quote_currency,
                "price_precision": s.price_precision,
                "volume_precision": s.volume_precision,
                "contract_size": s.contract_size,
                "tick_size": s.tick_size.map(|v| v.to_string()),
                "lot_min": s.lot_min.map(|v| v.to_string()),
                "lot_max": s.lot_max.map(|v| v.to_string()),
                "default_pip_position": s.default_pip_position.map(|v| v.to_string()),
                "pip_position_min": s.pip_position_min.map(|v| v.to_string()),
                "pip_position_max": s.pip_position_max.map(|v| v.to_string()),
                "is_enabled": s.is_enabled,
                "trading_enabled": s.trading_enabled,
                "leverage_profile_id": s.leverage_profile_id,
                "leverage_profile_name": s.leverage_profile_name,
                "mmdps_category": s.mmdps_category,
                "provider_description": s.provider_description,
                "created_at": s.created_at,
                "updated_at": s.updated_at,
            })
        })
        .collect();

    Ok(Json(ListSymbolsResponse {
        items,
        page: params.page.unwrap_or(1),
        page_size: params.page_size.unwrap_or(20),
        total,
    }))
}

async fn sync_mmdps(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<SyncMmdpsRequest>,
) -> Result<Json<SyncMmdpsResult>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "symbols:create")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminSymbolsService::new(pool);
    let result = service
        .sync_from_mmdps(
            payload.enable_forex,
            payload.enable_metals,
            payload.enable_stocks,
            payload.enable_crypto,
            payload.prune_stocks_not_in_mmdps_feed,
        )
        .await
        .map_err(|e| {
            let msg = e.to_string();
            tracing::error!(error = %msg, "admin symbols MMDPS sync failed");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "SYNC_MMDPS_FAILED".to_string(),
                        message: msg,
                    },
                }),
            )
        })?;

    Ok(Json(result))
}

async fn get_symbol(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "symbols:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminSymbolsService::new(pool);
    let symbol = service.get_symbol_by_id(id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "SYMBOL_NOT_FOUND".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(Json(serde_json::json!({
        "id": symbol.id,
        "symbol_code": symbol.symbol_code,
        "provider_symbol": symbol.provider_symbol,
        "asset_class": symbol.asset_class,
        "base_currency": symbol.base_currency,
        "quote_currency": symbol.quote_currency,
        "price_precision": symbol.price_precision,
        "volume_precision": symbol.volume_precision,
        "contract_size": symbol.contract_size,
        "tick_size": symbol.tick_size.map(|v| v.to_string()),
        "lot_min": symbol.lot_min.map(|v| v.to_string()),
        "lot_max": symbol.lot_max.map(|v| v.to_string()),
        "default_pip_position": symbol.default_pip_position.map(|v| v.to_string()),
        "pip_position_min": symbol.pip_position_min.map(|v| v.to_string()),
        "pip_position_max": symbol.pip_position_max.map(|v| v.to_string()),
        "is_enabled": symbol.is_enabled,
        "trading_enabled": symbol.trading_enabled,
        "leverage_profile_id": symbol.leverage_profile_id,
        "mmdps_category": symbol.mmdps_category,
        "provider_description": symbol.provider_description,
        "created_at": symbol.created_at,
        "updated_at": symbol.updated_at,
    })))
}

async fn create_symbol(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<CreateSymbolRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "symbols:create")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminSymbolsService::new(pool);
    let leverage_profile_id = payload
        .leverage_profile_id
        .as_ref()
        .and_then(|s| Uuid::parse_str(s).ok());

    let symbol = service
        .create_symbol(
            &payload.symbol_code,
            &payload.provider_symbol,
            &payload.asset_class,
            &payload.base_currency,
            &payload.quote_currency,
            payload.price_precision,
            payload.volume_precision,
            &payload.contract_size,
            payload.tick_size.as_deref(),
            payload.lot_min.as_deref(),
            payload.lot_max.as_deref(),
            payload.default_pip_position.as_deref(),
            payload.pip_position_min.as_deref(),
            payload.pip_position_max.as_deref(),
            leverage_profile_id,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "CREATE_SYMBOL_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    // Publish Redis event
    publish_symbol_status_update(&symbol.symbol_code, symbol.is_enabled).await;

    Ok(Json(serde_json::json!({
        "id": symbol.id,
        "symbol_code": symbol.symbol_code,
        "provider_symbol": symbol.provider_symbol,
        "asset_class": symbol.asset_class,
        "base_currency": symbol.base_currency,
        "quote_currency": symbol.quote_currency,
        "price_precision": symbol.price_precision,
        "volume_precision": symbol.volume_precision,
        "contract_size": symbol.contract_size,
        "tick_size": symbol.tick_size.map(|v| v.to_string()),
        "lot_min": symbol.lot_min.map(|v| v.to_string()),
        "lot_max": symbol.lot_max.map(|v| v.to_string()),
        "default_pip_position": symbol.default_pip_position.map(|v| v.to_string()),
        "pip_position_min": symbol.pip_position_min.map(|v| v.to_string()),
        "pip_position_max": symbol.pip_position_max.map(|v| v.to_string()),
        "is_enabled": symbol.is_enabled,
        "trading_enabled": symbol.trading_enabled,
        "leverage_profile_id": symbol.leverage_profile_id,
        "mmdps_category": symbol.mmdps_category,
        "provider_description": symbol.provider_description,
        "created_at": symbol.created_at,
        "updated_at": symbol.updated_at,
    })))
}

async fn update_symbol(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<UpdateSymbolRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "symbols:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminSymbolsService::new(pool);
    let leverage_profile_id = payload
        .leverage_profile_id
        .as_ref()
        .and_then(|s| Uuid::parse_str(s).ok());

    let symbol = service
        .update_symbol(
            id,
            &payload.symbol_code,
            &payload.provider_symbol,
            &payload.asset_class,
            &payload.base_currency,
            &payload.quote_currency,
            payload.price_precision,
            payload.volume_precision,
            &payload.contract_size,
            payload.tick_size.as_deref(),
            payload.lot_min.as_deref(),
            payload.lot_max.as_deref(),
            payload.default_pip_position.as_deref(),
            payload.pip_position_min.as_deref(),
            payload.pip_position_max.as_deref(),
            payload.is_enabled,
            payload.trading_enabled,
            leverage_profile_id,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_SYMBOL_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    // Publish Redis event
    publish_symbol_status_update(&symbol.symbol_code, symbol.is_enabled).await;

    Ok(Json(serde_json::json!({
        "id": symbol.id,
        "symbol_code": symbol.symbol_code,
        "provider_symbol": symbol.provider_symbol,
        "asset_class": symbol.asset_class,
        "base_currency": symbol.base_currency,
        "quote_currency": symbol.quote_currency,
        "price_precision": symbol.price_precision,
        "volume_precision": symbol.volume_precision,
        "contract_size": symbol.contract_size,
        "tick_size": symbol.tick_size.map(|v| v.to_string()),
        "lot_min": symbol.lot_min.map(|v| v.to_string()),
        "lot_max": symbol.lot_max.map(|v| v.to_string()),
        "default_pip_position": symbol.default_pip_position.map(|v| v.to_string()),
        "pip_position_min": symbol.pip_position_min.map(|v| v.to_string()),
        "pip_position_max": symbol.pip_position_max.map(|v| v.to_string()),
        "is_enabled": symbol.is_enabled,
        "trading_enabled": symbol.trading_enabled,
        "leverage_profile_id": symbol.leverage_profile_id,
        "mmdps_category": symbol.mmdps_category,
        "provider_description": symbol.provider_description,
        "created_at": symbol.created_at,
        "updated_at": symbol.updated_at,
    })))
}

async fn delete_symbol(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "symbols:delete")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminSymbolsService::new(pool);
    service.delete_symbol(id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DELETE_SYMBOL_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

async fn toggle_enabled(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<HashMap<String, bool>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "symbols:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let is_enabled = payload.get("is_enabled").copied().unwrap_or(false);
    let service = AdminSymbolsService::new(pool);
    let symbol = service.toggle_enabled(id, is_enabled).await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "TOGGLE_ENABLED_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    // Publish Redis event
    publish_symbol_status_update(&symbol.symbol_code, symbol.is_enabled).await;

    Ok(Json(serde_json::json!({
        "id": symbol.id,
        "symbol_code": symbol.symbol_code,
        "is_enabled": symbol.is_enabled,
        "updated_at": symbol.updated_at,
    })))
}

// Redis pubsub helper
async fn publish_symbol_status_update(symbol_code: &str, is_enabled: bool) {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    
    // Use blocking connection for simplicity (Redis operations are fast)
    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_connection() {
            let channel = "symbol:status:update";
            let message = serde_json::json!({
                "symbol_code": symbol_code,
                "is_enabled": is_enabled,
                "timestamp": chrono::Utc::now().to_rfc3339(),
            });
            
            let _: Result<(), _> = redis::cmd("PUBLISH")
                .arg(channel)
                .arg(message.to_string())
                .query(&mut conn);
            
            // Also update Redis key for data provider
            let key = format!("symbol:status:{}", symbol_code);
            let value = if is_enabled { "enabled" } else { "disabled" };
            let _: Result<(), _> = redis::cmd("SET")
                .arg(&key)
                .arg(value)
                .query(&mut conn);
        }
    }
}

