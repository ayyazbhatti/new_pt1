use axum::{
    extract::{Path, Query, State, Extension},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use contracts::{VersionedMessage, commands::PlaceOrderCommand, enums::{Side, OrderType, TimeInForce}};
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;

#[derive(Clone)]
pub struct OrdersState {
    pub redis: Arc<redis::Client>,
    pub nats: Arc<async_nats::Client>,
}

// ============================================================================
// PLACE ORDER (USER)
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceOrderRequest {
    pub symbol: String, // Symbol code like "BTCUSDT"
    pub side: String,   // "BUY" or "SELL"
    #[serde(rename = "order_type")]
    pub order_type: String, // "MARKET" or "LIMIT"
    pub size: String,
    #[serde(rename = "limit_price")]
    pub limit_price: Option<String>,
    pub sl: Option<String>, // Stop loss
    pub tp: Option<String>, // Take profit
    pub tif: Option<String>, // Time in force: "GTC", "IOC", "FOK"
    #[serde(rename = "client_order_id")]
    pub client_order_id: Option<String>,
    #[serde(rename = "idempotency_key")]
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceOrderResponse {
    pub order_id: String,
    pub status: String,
}

async fn place_order(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(orders_state): Extension<OrdersState>,
    Json(req): Json<PlaceOrderRequest>,
) -> Result<Json<PlaceOrderResponse>, StatusCode> {
    let user_id = claims.sub;
    let order_id = Uuid::new_v4();
    let now = Utc::now();

    // Validate order type
    let order_type_upper = req.order_type.to_uppercase();
    if order_type_upper != "MARKET" && order_type_upper != "LIMIT" {
        error!("Invalid order type: {}", req.order_type);
        return Err(StatusCode::BAD_REQUEST);
    }

    // Validate side
    let side_upper = req.side.to_uppercase();
    if side_upper != "BUY" && side_upper != "SELL" {
        error!("Invalid side: {}", req.side);
        return Err(StatusCode::BAD_REQUEST);
    }

    // Parse size
    let size = Decimal::from_str(&req.size).map_err(|_| {
        error!("Invalid size: {}", req.size);
        StatusCode::BAD_REQUEST
    })?;

    if size <= Decimal::ZERO {
        error!("Size must be greater than zero");
        return Err(StatusCode::BAD_REQUEST);
    }

    // Parse limit price if provided
    let limit_price = if let Some(price_str) = &req.limit_price {
        Some(Decimal::from_str(price_str).map_err(|_| {
            error!("Invalid limit price: {}", price_str);
            StatusCode::BAD_REQUEST
        })?)
    } else {
        None
    };

    // Validate limit order has price
    if order_type_upper == "LIMIT" && limit_price.is_none() {
        error!("Limit order requires limit_price");
        return Err(StatusCode::BAD_REQUEST);
    }

    // Get symbol_id from symbol code
    let symbol_row = sqlx::query!(
        r#"SELECT id FROM symbols WHERE code = $1 LIMIT 1"#,
        req.symbol
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch symbol: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or_else(|| {
        error!("Symbol not found: {}", req.symbol);
        StatusCode::NOT_FOUND
    })?;

    let symbol_id = symbol_row.id;

    // Check idempotency
    let mut conn = orders_state.redis.get_async_connection().await
        .map_err(|e| {
            error!("Failed to get Redis connection: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let idempotency_key = format!("order:idempotency:{}", req.idempotency_key);
    let existing_order_id: Option<String> = conn.get(&idempotency_key).await
        .map_err(|e| {
            error!("Failed to check idempotency: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if let Some(existing_id) = existing_order_id {
        info!("Idempotent order request, returning existing order: {}", existing_id);
        return Ok(Json(PlaceOrderResponse {
            order_id: existing_id,
            status: "PENDING".to_string(),
        }));
    }

    // Store idempotency key (expires in 24 hours)
    let _: () = conn.set_ex(&idempotency_key, order_id.to_string(), 86400).await
        .map_err(|e| {
            error!("Failed to store idempotency key: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Parse stop price if provided
    let stop_price = req.sl.as_ref().and_then(|s| Decimal::from_str(s).ok());
    let stop_price_str = req.sl.clone();

    // Insert order into database (using raw query to handle enums)
    sqlx::query(
        r#"
        INSERT INTO orders (
            id, user_id, symbol_id, side, type, size, price, stop_price,
            status, reference, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4::order_side, $5::order_type, $6, $7, $8, $9::order_status, $10, $11, $12)
        "#,
    )
    .bind(order_id)
    .bind(user_id)
    .bind(symbol_id)
    .bind(side_upper.to_lowercase())
    .bind(order_type_upper.to_lowercase())
    .bind(size)
    .bind(limit_price)
    .bind(stop_price)
    .bind("pending")
    .bind(req.client_order_id.as_deref())
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to insert order: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Publish to NATS for order-engine to process
    // Convert to PlaceOrderCommand format
    let side = match side_upper.as_str() {
        "BUY" => Side::Buy,
        "SELL" => Side::Sell,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    
    let order_type = match order_type_upper.as_str() {
        "MARKET" => OrderType::Market,
        "LIMIT" => OrderType::Limit,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    
    let tif = match req.tif.as_deref().unwrap_or("GTC") {
        "GTC" => TimeInForce::Gtc,
        "IOC" => TimeInForce::Ioc,
        "FOK" => TimeInForce::Fok,
        _ => TimeInForce::Gtc,
    };
    
    let tp_decimal = req.tp.as_ref().and_then(|s| Decimal::from_str(s).ok());
    
    let place_order_cmd = PlaceOrderCommand {
        order_id,
        user_id,
        symbol: req.symbol.clone(),
        side,
        order_type,
        size,
        limit_price,
        sl: stop_price,
        tp: tp_decimal,
        tif,
        client_order_id: req.client_order_id.clone(),
        idempotency_key: req.idempotency_key.clone(),
        ts: now,
    };

    let msg = VersionedMessage::new("cmd.order.place", &place_order_cmd)
        .map_err(|e| {
            error!("Failed to create versioned message: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|e| {
            error!("Failed to serialize order command: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    info!("📤 Publishing order command to NATS: cmd.order.place, order_id={}, user_id={}, symbol={}", 
          order_id, user_id, req.symbol);
    
    // Try JetStream first, but ALWAYS also publish to basic pub/sub
    // This ensures order-engine receives messages even if JetStream consumer fails
    let js_context = async_nats::jetstream::new((*orders_state.nats).clone());
    let jetstream_result = js_context.publish("cmd.order.place".to_string(), payload.clone().into()).await;
    
    match jetstream_result {
        Ok(_) => {
            info!("✅ Published to JetStream (persistent): cmd.order.place");
        }
        Err(e) => {
            warn!("JetStream publish failed: {}", e);
        }
    }
    
    // ALWAYS also publish to basic pub/sub to ensure delivery
    // This is a safety net in case JetStream consumer isn't working
    orders_state.nats.publish("cmd.order.place".to_string(), payload.into()).await
        .map_err(|e| {
            error!("❌ Failed to publish order to NATS basic pub/sub: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    info!("✅ Published to NATS (basic pub/sub): cmd.order.place");

    // Also publish to Redis for ws-gateway
    let redis_payload = serde_json::json!({
        "type": "order.update",
        "payload": {
            "order_id": order_id.to_string(),
            "status": "PENDING",
            "symbol": req.symbol,
            "side": side_upper,
            "quantity": req.size,
            "price": limit_price.map(|p| p.to_string()),
            "ts": now.timestamp_millis(),
        }
    });
    if let Ok(mut conn_sync) = orders_state.redis.get_connection() {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("orders:updates")
            .arg(redis_payload.to_string())
            .query(&mut conn_sync);
    }

    info!("Order created: order_id={}, user_id={}, symbol={}, side={}, type={}", 
          order_id, user_id, req.symbol, side_upper, order_type_upper);

    Ok(Json(PlaceOrderResponse {
        order_id: order_id.to_string(),
        status: "PENDING".to_string(),
    }))
}

// ============================================================================
// LIST ORDERS (USER)
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    pub status: Option<String>, // "pending", "filled", "cancelled", etc.
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct OrderResponse {
    pub id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub size: String,
    pub price: Option<String>,
    pub stop_price: Option<String>,
    pub filled_size: Option<String>,
    pub average_price: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub filled_at: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListOrdersResponse {
    pub items: Vec<OrderResponse>,
    pub total: i64,
}

async fn list_orders(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ListOrdersQuery>,
) -> Result<Json<ListOrdersResponse>, StatusCode> {
    let user_id = claims.sub;
    let limit = params.limit.unwrap_or(100).min(1000);
    let offset = params.offset.unwrap_or(0);

    // Build query with optional status filter
    let (orders, total) = if let Some(status) = &params.status {
        let status_lower = status.to_lowercase();
        let status_lower_clone = status_lower.clone();
        let orders: Vec<(Uuid, Option<Uuid>, Option<String>, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String, chrono::DateTime<Utc>, chrono::DateTime<Utc>, Option<chrono::DateTime<Utc>>, Option<chrono::DateTime<Utc>>)> = sqlx::query_as(
            r#"
            SELECT 
                o.id,
                o.symbol_id,
                s.code as symbol_code,
                o.side::text as side,
                o.type::text as order_type,
                o.size::text as size,
                o.price::text as price,
                o.stop_price::text as stop_price,
                o.filled_size::text as filled_size,
                o.average_price::text as average_price,
                o.status::text as status,
                o.created_at,
                o.updated_at,
                o.filled_at,
                o.cancelled_at
            FROM orders o
            LEFT JOIN symbols s ON o.symbol_id = s.id
            WHERE o.user_id = $1 AND o.status::text = $2
            ORDER BY o.created_at DESC
            LIMIT $3 OFFSET $4
            "#
        )
        .bind(user_id)
        .bind(&status_lower)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            error!("Failed to fetch orders: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM orders WHERE user_id = $1 AND status::text = $2"
        )
        .bind(user_id)
        .bind(&status_lower_clone)
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

        (orders, total)
    } else {
        let orders: Vec<(Uuid, Option<Uuid>, Option<String>, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, String, chrono::DateTime<Utc>, chrono::DateTime<Utc>, Option<chrono::DateTime<Utc>>, Option<chrono::DateTime<Utc>>)> = sqlx::query_as(
            r#"
            SELECT 
                o.id,
                o.symbol_id,
                s.code as symbol_code,
                o.side::text as side,
                o.type::text as order_type,
                o.size::text as size,
                o.price::text as price,
                o.stop_price::text as stop_price,
                o.filled_size::text as filled_size,
                o.average_price::text as average_price,
                o.status::text as status,
                o.created_at,
                o.updated_at,
                o.filled_at,
                o.cancelled_at
            FROM orders o
            LEFT JOIN symbols s ON o.symbol_id = s.id
            WHERE o.user_id = $1
            ORDER BY o.created_at DESC
            LIMIT $2 OFFSET $3
            "#
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            error!("Failed to fetch orders: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM orders WHERE user_id = $1"
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

        (orders, total)
    };

    let items: Vec<OrderResponse> = orders
        .into_iter()
        .map(|(id, _, symbol_code, side, order_type, size, price, stop_price, filled_size, average_price, status, created_at, updated_at, filled_at, cancelled_at)| {
            OrderResponse {
                id: id.to_string(),
                symbol: symbol_code.unwrap_or_else(|| "UNKNOWN".to_string()),
                side: side.to_uppercase(),
                order_type: order_type.to_uppercase(),
                size,
                price,
                stop_price,
                filled_size,
                average_price,
                status: status.to_lowercase(),
                created_at: created_at.to_rfc3339(),
                updated_at: updated_at.to_rfc3339(),
                filled_at: filled_at.map(|dt| dt.to_rfc3339()),
                cancelled_at: cancelled_at.map(|dt| dt.to_rfc3339()),
            }
        })
        .collect();

    Ok(Json(ListOrdersResponse { items, total }))
}

// ============================================================================
// CANCEL ORDER (USER)
// ============================================================================

async fn cancel_order(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(orders_state): Extension<OrdersState>,
    Path(order_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let user_id = claims.sub;
    let now = Utc::now();

    // Check if order exists and belongs to user
    let status_row: Option<(Uuid, String)> = sqlx::query_as(
        r#"SELECT id, status::text as status FROM orders WHERE id = $1 AND user_id = $2"#,
    )
    .bind(order_id)
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch order: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let (_, status_str) = status_row.ok_or(StatusCode::NOT_FOUND)?;

    // Check if order can be cancelled
    if status_str != "pending" {
        error!("Order {} cannot be cancelled, status: {}", order_id, status_str);
        return Err(StatusCode::BAD_REQUEST);
    }

    // Update order status
    sqlx::query(
        r#"
        UPDATE orders
        SET status = 'cancelled'::order_status, cancelled_at = $1, updated_at = $1
        WHERE id = $2
        "#,
    )
    .bind(now)
    .bind(order_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to cancel order: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Publish to NATS
    let cancel_event = serde_json::json!({
        "orderId": order_id.to_string(),
        "userId": user_id.to_string(),
        "cancelledAt": now.to_rfc3339(),
    });

    let msg = VersionedMessage::new("order.cancel", &cancel_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    orders_state.nats.publish("cmd.order.cancel".to_string(), payload.into()).await
        .ok(); // Don't fail if NATS publish fails

    // Also publish to Redis for ws-gateway
    let redis_payload = serde_json::json!({
        "type": "order.update",
        "payload": {
            "order_id": order_id.to_string(),
            "status": "CANCELLED",
            "ts": now.timestamp_millis(),
        }
    });
    if let Ok(mut conn_sync) = orders_state.redis.get_connection() {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("orders:updates")
            .arg(redis_payload.to_string())
            .query(&mut conn_sync);
    }

    info!("Order cancelled: order_id={}, user_id={}", order_id, user_id);
    Ok(StatusCode::OK)
}

// ============================================================================
// ROUTER
// ============================================================================

pub fn create_orders_router(
    pool: PgPool,
    orders_state: OrdersState,
) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_orders).post(place_order))
        .route("/:order_id/cancel", post(cancel_order))
        .layer(axum::middleware::from_fn_with_state(
            pool.clone(),
            auth_middleware,
        ))
        .layer(axum::Extension(orders_state))
        .with_state(pool)
}

