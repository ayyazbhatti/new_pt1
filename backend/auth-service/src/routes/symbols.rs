use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use crate::services::admin_symbols_service::AdminSymbolsService;

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

pub fn create_symbols_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_symbols))
        .with_state(pool)
}

async fn list_symbols(
    State(pool): State<PgPool>,
    Query(params): Query<ListSymbolsQuery>,
) -> Result<Json<ListSymbolsResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Public endpoint - no auth required, but only returns enabled symbols
    let service = AdminSymbolsService::new(pool);
    
    // Force is_enabled to true for public endpoint
    let is_enabled = Some(true);

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
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "LIST_SYMBOLS_FAILED".to_string(),
                        message: e.to_string(),
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
                "is_enabled": s.is_enabled,
                "trading_enabled": s.trading_enabled,
                "leverage_profile_id": s.leverage_profile_id,
                "leverage_profile_name": s.leverage_profile_name,
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

