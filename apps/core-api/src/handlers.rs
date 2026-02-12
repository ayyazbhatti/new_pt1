use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use chrono::Utc;
use contracts::{
    commands::{CancelOrderCommand, PlaceOrderCommand},
    enums::{OrderType, Side, TimeInForce},
    VersionedMessage,
};
use redis::AsyncCommands;
use redis_model::keys::Keys;
use risk::validation::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tracing::{error, info};
use uuid::Uuid;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct PlaceOrderRequest {
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub size: Decimal,
    pub limit_price: Option<Decimal>,
    pub sl: Option<Decimal>,
    pub tp: Option<Decimal>,
    pub tif: Option<String>,
    pub client_order_id: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
pub struct PlaceOrderResponse {
    pub order_id: Uuid,
    pub status: String,
}

pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "core-api"
    }))
}

pub async fn place_order(
    State(state): State<AppState>,
    Json(req): Json<PlaceOrderRequest>,
) -> Result<Json<PlaceOrderResponse>, StatusCode> {
    // TODO: Extract user_id from JWT token
    let user_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    info!("Place order request: user={}, symbol={}, side={}", user_id, req.symbol, req.side);

    // Validate order type
    let order_type = match req.order_type.as_str() {
        "MARKET" => OrderType::Market,
        "LIMIT" => OrderType::Limit,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let side = match req.side.as_str() {
        "BUY" => Side::Buy,
        "SELL" => Side::Sell,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    let tif = match req.tif.as_deref().unwrap_or("GTC") {
        "GTC" => TimeInForce::Gtc,
        "IOC" => TimeInForce::Ioc,
        "FOK" => TimeInForce::Fok,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    // Validate order type and price consistency
    if let Err(e) = validate_order_type_price(order_type, req.limit_price) {
        error!("Validation error: {}", e);
        return Err(StatusCode::BAD_REQUEST);
    }

    // TODO: Get symbol config from Redis and validate size, price_tick, etc.
    // For now, basic validation
    if req.size <= Decimal::ZERO {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check idempotency
    let mut conn = state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let idempotency_key = Keys::idempotency(user_id, &req.idempotency_key);
    let existing: Option<String> = conn.get(&idempotency_key).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    if let Some(existing_order_id) = existing {
        info!("Duplicate order, returning existing: {}", existing_order_id);
        return Ok(Json(PlaceOrderResponse {
            order_id: Uuid::parse_str(&existing_order_id)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            status: "PENDING".to_string(),
        }));
    }

    // Generate order_id before creating command
    let order_id = Uuid::new_v4();

    // Create command
    let cmd = PlaceOrderCommand {
        order_id,
        user_id,
        symbol: req.symbol,
        side,
        order_type,
        size: req.size,
        limit_price: req.limit_price,
        sl: req.sl,
        tp: req.tp,
        tif,
        client_order_id: req.client_order_id,
        idempotency_key: req.idempotency_key,
        ts: Utc::now(),
    };

    // Publish to NATS
    let subject = "cmd.order.place";
    let msg = VersionedMessage::new(subject, &cmd)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.nats.publish(subject.to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(PlaceOrderResponse {
        order_id,
        status: "PENDING".to_string(),
    }))
}

pub async fn cancel_order(
    State(state): State<AppState>,
    Path(order_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // TODO: Extract user_id from JWT
    let user_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let cmd = CancelOrderCommand {
        user_id,
        order_id,
        idempotency_key: Uuid::new_v4().to_string(),
        ts: Utc::now(),
    };

    let subject = "cmd.order.cancel";
    let msg = VersionedMessage::new(subject, &cmd)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.nats.publish(subject.to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({
        "status": "cancelled"
    })))
}

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    pub status: Option<String>, // "pending", "filled", "cancelled"
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ListOrdersResponse {
    pub items: Vec<serde_json::Value>,
    pub total: u64,
}

pub async fn list_orders(
    State(state): State<AppState>,
    Query(params): Query<ListOrdersQuery>,
) -> Result<Json<ListOrdersResponse>, StatusCode> {
    // TODO: Extract user_id from JWT
    let user_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut conn = state.redis.get_async_connection().await
        .map_err(|e| {
            error!("Failed to get Redis connection: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Get all order IDs for this user from Redis
    // Orders are stored with key pattern: order:{order_id}
    // We need to scan for all orders and filter by user_id and status
    let limit = params.limit.unwrap_or(100);
    let offset = params.offset.unwrap_or(0);
    
    // Scan for order keys using KEYS command (for simplicity, though SCAN is preferred for production)
    // Note: In production, consider using SCAN with a cursor for better performance
    let pattern = "order:*";
    let all_keys: Vec<String> = conn.keys(pattern).await
        .map_err(|e| {
            error!("Failed to get order keys from Redis: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    // Filter out idempotency keys - only process actual order keys (UUID format)
    let order_keys: Vec<String> = all_keys
        .into_iter()
        .filter(|key| {
            // Skip idempotency keys - they have format "order:idempotency:..."
            // Actual order keys have format "order:{uuid}" where uuid is a valid UUID
            !key.contains(":idempotency:")
        })
        .collect();
    
    let mut orders = Vec::new();
    
    for order_key in order_keys {
        let order_data: Option<String> = conn.get(&order_key).await
            .map_err(|e| {
                error!("Failed to get order data: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;
        
        if let Some(order_json) = order_data {
            // Skip empty or invalid JSON
            if order_json.trim().is_empty() {
                continue;
            }
            
            let order_value = match serde_json::from_str::<serde_json::Value>(&order_json) {
                Ok(v) => v,
                Err(e) => {
                    // Log but don't fail - skip invalid JSON entries
                    error!("Failed to parse JSON for key {}: {}", order_key, e);
                    continue;
                }
            };
            
            // Filter by user_id - orders must have user_id matching the request
            let order_user_id_str = order_value.get("user_id")
                .and_then(|v| {
                    // Handle both string and number user_id formats
                    if let Some(s) = v.as_str() {
                        Some(s.to_string())
                    } else if let Some(n) = v.as_u64() {
                        Some(n.to_string())
                    } else {
                        None
                    }
                });
            
            match order_user_id_str {
                Some(uid) if uid == user_id.to_string() => {
                    // User ID matches, continue processing
                }
                Some(_) => {
                    // User ID doesn't match, skip this order
                    continue;
                }
                None => {
                    // No user_id field, skip this order (shouldn't happen but handle gracefully)
                    continue;
                }
            }
            
            // Filter by status if provided
            if let Some(status_filter) = &params.status {
                if let Some(order_status) = order_value.get("status").and_then(|v| v.as_str()) {
                    let status_match = match status_filter.to_uppercase().as_str() {
                        "FILLED" => order_status == "FILLED",
                        "PENDING" => order_status == "PENDING",
                        "CANCELLED" => order_status == "CANCELLED",
                        _ => true,
                    };
                    if !status_match {
                        continue;
                    }
                }
            }
            
            orders.push(order_value);
        }
    }
    
    // Sort by created_at descending (most recent first)
    orders.sort_by(|a, b| {
        let a_ts = a.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
        let b_ts = b.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
        b_ts.cmp(a_ts)
    });
    
    let total = orders.len() as u64;
    let paginated_orders: Vec<serde_json::Value> = orders
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();
    
    Ok(Json(ListOrdersResponse {
        items: paginated_orders,
        total,
    }))
}

pub async fn list_symbols(
    State(_state): State<AppState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // TODO: Fetch from Redis
    Ok(Json(serde_json::json!({
        "symbols": ["BTCUSD", "ETHUSD"]
    })))
}

pub async fn get_user_risk(
    State(_state): State<AppState>,
    Path(_user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // TODO: Calculate from Redis positions and balances
    Ok(Json(serde_json::json!({
        "margin_used": 0,
        "free_margin": 10000,
        "equity": 10000
    })))
}

#[derive(Debug, Serialize)]
pub struct PositionsResponse {
    pub positions: Vec<serde_json::Value>,
}

pub async fn get_user_positions(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<PositionsResponse>, StatusCode> {
    use redis::AsyncCommands;
    use redis_model::keys::Keys;
    use redis_model::models::PositionModel;
    
    let mut conn = state.redis.get_async_connection().await
        .map_err(|e| {
            error!("Failed to get Redis connection: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let positions_key = Keys::positions_set(user_id);
    let position_ids: Vec<String> = conn.smembers(&positions_key).await
        .map_err(|e| {
            error!("Failed to get position IDs: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let mut positions = Vec::new();
    
    for pos_id_str in position_ids {
        if let Ok(pos_id) = Uuid::parse_str(&pos_id_str) {
            let pos_key = Keys::position_by_id(pos_id);
            let pos_data: std::collections::HashMap<String, String> = conn.hgetall(&pos_key).await
                .map_err(|e| {
                    error!("Failed to get position data: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            
            if !pos_data.is_empty() {
                // Convert HashMap to JSON
                let mut pos_json = serde_json::Map::new();
                pos_json.insert("id".to_string(), serde_json::Value::String(pos_id_str));
                
                for (k, v) in pos_data {
                    // Try to parse as number if possible, otherwise keep as string
                    if let Ok(num) = v.parse::<f64>() {
                        pos_json.insert(k, serde_json::Value::Number(serde_json::Number::from_f64(num).unwrap_or(serde_json::Number::from(0))));
                    } else if v == "null" || v.is_empty() {
                        pos_json.insert(k, serde_json::Value::Null);
                    } else {
                        pos_json.insert(k, serde_json::Value::String(v));
                    }
                }
                
                positions.push(serde_json::Value::Object(pos_json));
            }
        }
    }

    Ok(Json(PositionsResponse { positions }))
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

pub async fn list_symbols_admin(
    State(state): State<AppState>,
    Query(params): Query<ListSymbolsQuery>,
) -> Result<Json<ListSymbolsResponse>, StatusCode> {
    let page = params.page.unwrap_or(1);
    let page_size = params.page_size.unwrap_or(100);
    
    // Build query - use simple query for now
    let mut query = "SELECT id, symbol, base, quote, enabled, min_size::text, step_size::text, price_tick::text, created_at, updated_at FROM symbols WHERE 1=1".to_string();
    
    // Filter by is_enabled if provided
    if let Some(is_enabled_str) = &params.is_enabled {
        let is_enabled_bool = is_enabled_str == "true";
        query.push_str(&format!(" AND enabled = {}", is_enabled_bool));
    }
    
    // Filter by search if provided
    if let Some(search) = &params.search {
        query.push_str(&format!(" AND symbol ILIKE '%{}%'", search.replace("'", "''")));
    }
    
    query.push_str(" ORDER BY symbol");
    
    // Execute query
    let rows = sqlx::query(&query)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            error!("Database error fetching symbols: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    // Convert rows to JSON format
    let mut items: Vec<serde_json::Value> = Vec::new();
    for row in rows {
        let id: uuid::Uuid = row.get(0);
        let symbol: String = row.get(1);
        let base: String = row.get(2);
        let quote: String = row.get(3);
        let enabled: bool = row.get(4);
        let min_size: String = row.get(5);
        let step_size: String = row.get(6);
        let price_tick: String = row.get(7);
        let created_at: chrono::DateTime<chrono::Utc> = row.get(8);
        let updated_at: chrono::DateTime<chrono::Utc> = row.get(9);
        
        // Determine price and volume precision from step_size and price_tick
        let price_precision = if price_tick.contains('.') {
            price_tick.split('.').nth(1).map(|s| s.len()).unwrap_or(2).min(8)
        } else {
            2
        };
        
        let volume_precision = if step_size.contains('.') {
            step_size.split('.').nth(1).map(|s| s.len()).unwrap_or(8).min(8)
        } else {
            8
        };
        
        items.push(serde_json::json!({
            "id": id.to_string(),
            "symbol_code": symbol,
            "provider_symbol": symbol,
            "asset_class": "crypto",
            "base_currency": base,
            "quote_currency": quote,
            "price_precision": price_precision,
            "volume_precision": volume_precision,
            "contract_size": "1",
            "is_enabled": enabled,
            "trading_enabled": enabled,
            "leverage_profile_id": null,
            "leverage_profile_name": null,
            "created_at": created_at.to_rfc3339(),
            "updated_at": updated_at.to_rfc3339()
        }));
    }
    
    let total = items.len() as i64;

    Ok(Json(ListSymbolsResponse {
        items,
        page,
        page_size,
        total,
    }))
}

