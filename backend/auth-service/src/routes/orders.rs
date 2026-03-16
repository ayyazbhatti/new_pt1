use axum::{
    extract::{Path, Query, State, Extension},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use contracts::{VersionedMessage, commands::{PlaceOrderCommand, LeverageTier as CmdLeverageTier}, enums::{Side, OrderType, TimeInForce}};
use crate::models::leverage_profile::LeverageProfileTier;
use redis::AsyncCommands;
use redis_model::keys::Keys;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::routes::deposits::{compute_and_cache_account_summary, get_free_margin_from_db_fast, get_price_from_redis};
use crate::utils::jwt::Claims;
use crate::utils::permission_check;
use crate::middleware::auth_middleware;

#[derive(Clone)]
pub struct OrdersState {
    pub redis: Arc<crate::redis_pool::RedisPool>,
    pub nats: Arc<async_nats::Client>,
}

/// Error type for place_order: status-only or 403 with body (margin / trading restricted).
pub enum PlaceOrderError {
    Status(StatusCode),
    InsufficientMargin { required_margin: String, free_margin: String },
    /// Trading access is not "full" (close_only or disabled) — return 403 with message.
    TradingRestricted { message: String },
}

impl IntoResponse for PlaceOrderError {
    fn into_response(self) -> axum::response::Response {
        match self {
            PlaceOrderError::Status(c) => c.into_response(),
            PlaceOrderError::InsufficientMargin { required_margin, free_margin } => {
                let body = serde_json::json!({
                    "error": "INSUFFICIENT_FREE_MARGIN",
                    "message": format!("Estimated margin ({}) exceeds free margin ({}).", required_margin, free_margin)
                });
                (StatusCode::FORBIDDEN, Json(body)).into_response()
            }
            PlaceOrderError::TradingRestricted { message } => {
                let body = serde_json::json!({
                    "error": { "code": "TRADING_DISABLED", "message": message }
                });
                (StatusCode::FORBIDDEN, Json(body)).into_response()
            }
        }
    }
}

/// Effective leverage for a given notional: tier lookup then clamp to [user_min, user_max]. Default 50 if no tiers.
fn effective_leverage_for_notional(
    notional: Decimal,
    tiers: Option<&[CmdLeverageTier]>,
    user_min: Option<i32>,
    user_max: Option<i32>,
) -> Decimal {
    const DEFAULT_LEVERAGE: i32 = 50;
    let Some(tiers) = tiers else { return Decimal::from(DEFAULT_LEVERAGE); };
    if tiers.is_empty() {
        return Decimal::from(DEFAULT_LEVERAGE);
    }
    let mut symbol_leverage = DEFAULT_LEVERAGE;
    for t in tiers {
        let from = Decimal::from_str(&t.notional_from).unwrap_or(Decimal::ZERO);
        let to = t.notional_to.as_ref()
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::MAX);
        if notional >= from && notional < to {
            symbol_leverage = t.max_leverage;
            break;
        }
    }
    let min_l = user_min.unwrap_or(1);
    let max_l = user_max.unwrap_or(1000);
    let clamped = symbol_leverage.clamp(min_l, max_l);
    Decimal::from(clamped)
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
) -> Result<Json<PlaceOrderResponse>, PlaceOrderError> {
    let user_id = claims.sub;
    let order_id = Uuid::new_v4();
    let now = Utc::now();
    info!(
        order_id = %order_id,
        user_id = %user_id,
        symbol = %req.symbol,
        side = %req.side,
        order_type = %req.order_type,
        idempotency_key = %req.idempotency_key,
        "📥 place_order started"
    );

    // Validate order type
    let order_type_upper = req.order_type.to_uppercase();
    if order_type_upper != "MARKET" && order_type_upper != "LIMIT" {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=validate_order_type reason=invalid order_type");
        return Err(PlaceOrderError::Status(StatusCode::BAD_REQUEST));
    }

    // Validate side
    let side_upper = req.side.to_uppercase();
    if side_upper != "BUY" && side_upper != "SELL" {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=validate_side reason=invalid side");
        return Err(PlaceOrderError::Status(StatusCode::BAD_REQUEST));
    }

    // Parse size
    let size = Decimal::from_str(&req.size).map_err(|_| {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=parse_size reason=invalid size");
        PlaceOrderError::Status(StatusCode::BAD_REQUEST)
    })?;

    if size <= Decimal::ZERO {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=validate_size reason=size <= 0");
        return Err(PlaceOrderError::Status(StatusCode::BAD_REQUEST));
    }

    // Parse limit price if provided
    let limit_price = if let Some(price_str) = &req.limit_price {
        Some(Decimal::from_str(price_str).map_err(|_| {
            error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=parse_limit_price reason=invalid limit_price");
            PlaceOrderError::Status(StatusCode::BAD_REQUEST)
        })?)
    } else {
        None
    };

    // Validate limit order has price
    if order_type_upper == "LIMIT" && limit_price.is_none() {
        error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=limit_order_no_price reason=limit order requires limit_price");
        return Err(PlaceOrderError::Status(StatusCode::BAD_REQUEST));
    }

    // Get symbol_id from symbol code
    let symbol_row = sqlx::query!(
        r#"SELECT id FROM symbols WHERE code = $1 LIMIT 1"#,
        req.symbol
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!(order_id = %order_id, user_id = %user_id, symbol = %req.symbol, error = %e, "place_order FAILED stage=fetch_symbol status=500");
        PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
    })?
    .ok_or_else(|| {
        error!(order_id = %order_id, user_id = %user_id, symbol = %req.symbol, "place_order FAILED stage=symbol_not_found status=404");
        PlaceOrderError::Status(StatusCode::NOT_FOUND)
    })?;

    let symbol_id = symbol_row.id;

    // Fetch user leverage limits, account_type, and trading_access for order-engine
    #[derive(sqlx::FromRow)]
    struct UserLeverageRow { min_leverage: Option<i32>, max_leverage: Option<i32>, account_type: Option<String>, trading_access: Option<String> }
    let user_lev = sqlx::query_as::<_, UserLeverageRow>(
        r#"SELECT min_leverage, max_leverage, account_type, COALESCE(trading_access, 'full') as trading_access FROM users WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=fetch_user_leverage status=500");
        PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
    })?;
    let (user_min_lev, user_max_lev, account_type, trading_access) = user_lev
        .as_ref()
        .map(|r| (r.min_leverage, r.max_leverage, r.account_type.clone(), r.trading_access.clone()))
        .unwrap_or((None, None, None, Some("full".to_string())));
    let trading_access = trading_access.as_deref().unwrap_or("full");
    if trading_access != "full" {
        error!(order_id = %order_id, user_id = %user_id, trading_access = %trading_access, "place_order FAILED stage=trading_restricted status=403");
        return Err(PlaceOrderError::TradingRestricted {
            message: "Trading is disabled. You cannot open new positions.".to_string(),
        });
    }
    let account_type = account_type
        .filter(|s| s == "hedging" || s == "netting")
        .or_else(|| Some("hedging".to_string()));

    #[derive(sqlx::FromRow)]
    struct ProfileRow { leverage_profile_id: Option<Uuid> }
    let profile_row = sqlx::query_as::<_, ProfileRow>(
        r#"
        SELECT COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id) AS leverage_profile_id
        FROM users u
        INNER JOIN user_groups ug ON ug.id = u.group_id
        INNER JOIN symbols s ON LOWER(TRIM(s.code)) = LOWER(TRIM($2))
        LEFT JOIN group_symbols gs ON gs.symbol_id = s.id AND gs.group_id = ug.id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .bind(&req.symbol)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!(order_id = %order_id, user_id = %user_id, symbol = %req.symbol, error = %e, "place_order FAILED stage=fetch_symbol_leverage_profile status=500");
        PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
    })?;

    let leverage_tiers: Option<Vec<CmdLeverageTier>> = match profile_row.and_then(|r| r.leverage_profile_id) {
        Some(pid) => {
            let tiers: Vec<LeverageProfileTier> = sqlx::query_as(
                r#"
                SELECT id, profile_id, tier_index,
                    notional_from::text AS notional_from, notional_to::text AS notional_to,
                    max_leverage, initial_margin_percent::text AS initial_margin_percent,
                    maintenance_margin_percent::text AS maintenance_margin_percent,
                    created_at, updated_at
                FROM leverage_profile_tiers WHERE profile_id = $1 ORDER BY tier_index ASC
                "#,
            )
            .bind(pid)
            .fetch_all(&pool)
            .await
            .map_err(|e| {
                error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=fetch_leverage_tiers status=500");
                PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
            })?;
            if tiers.is_empty() {
                None
            } else {
                Some(tiers.into_iter().map(|t| CmdLeverageTier {
                    notional_from: t.notional_from,
                    notional_to: t.notional_to,
                    max_leverage: t.max_leverage,
                }).collect())
            }
        }
        None => None,
    };

    // Check idempotency
    let mut conn = orders_state.redis.get().await
        .map_err(|_| {
            error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=redis_connection status=503");
            PlaceOrderError::Status(StatusCode::SERVICE_UNAVAILABLE)
        })?;

    let idempotency_key = format!("order:idempotency:{}", req.idempotency_key);
    let existing_order_id: Option<String> = conn.get(&idempotency_key).await
        .map_err(|e| {
            error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=idempotency_check status=500");
            PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
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
            error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=idempotency_store status=500");
            PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    // ---------- Free margin vs required margin check (block order if insufficient) ----------
    let summary_key = Keys::account_summary(user_id);
    let free_margin_str: Option<String> = conn.hget(&summary_key, "free_margin").await
        .map_err(|e| {
            error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=free_margin_read status=500");
            PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
        })?;
    let free_margin = free_margin_str
        .and_then(|s| Decimal::from_str(&s).ok())
        .or_else(|| {
            // Cache miss: try to compute and re-read (no second connection in same conn)
            None
        });
    let free_margin = match free_margin {
        Some(fm) => fm,
        None => {
            // Cache miss: use fast DB-only path so we don't block the request on full account summary.
            drop(conn);
            let fast_fm = get_free_margin_from_db_fast(&pool, user_id).await
                .unwrap_or(Decimal::ZERO);
            // Warm cache in background for next request (no await).
            let pool_bg = pool.clone();
            let redis_bg = Arc::clone(&orders_state.redis);
            let user_id_bg = user_id;
            tokio::spawn(async move {
                compute_and_cache_account_summary(&pool_bg, redis_bg.as_ref(), user_id_bg).await;
            });
            fast_fm
        }
    };

    let execution_price = if order_type_upper == "LIMIT" {
        limit_price.ok_or_else(|| {
            error!(order_id = %order_id, user_id = %user_id, "place_order FAILED stage=limit_price_missing reason=limit order missing limit_price");
            PlaceOrderError::Status(StatusCode::BAD_REQUEST)
        })?
    } else {
        let group_id_str = claims.group_id.map(|u| u.to_string()).unwrap_or_default();
        let (bid, ask) = get_price_from_redis(orders_state.redis.as_ref(), &req.symbol, &group_id_str).await
            .ok_or_else(|| {
                error!(order_id = %order_id, user_id = %user_id, symbol = %req.symbol, group_id = %group_id_str, "place_order FAILED stage=market_no_price reason=no price in Redis");
                PlaceOrderError::Status(StatusCode::BAD_REQUEST)
            })?;
        if side_upper == "BUY" { ask } else { bid }
    };

    let notional = size * execution_price;
    let eff_lev = effective_leverage_for_notional(
        notional,
        leverage_tiers.as_deref(),
        user_min_lev,
        user_max_lev,
    );
    let required_margin = if eff_lev > Decimal::ZERO {
        notional / eff_lev
    } else {
        notional * Decimal::from(2) / Decimal::from(100) // 2% fallback
    };
    if required_margin > free_margin {
        error!(order_id = %order_id, user_id = %user_id, required = %required_margin, free = %free_margin, "place_order FAILED stage=insufficient_margin status=403");
        return Err(PlaceOrderError::InsufficientMargin {
            required_margin: required_margin.to_string(),
            free_margin: free_margin.to_string(),
        });
    }

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
        error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=db_insert_order status=500");
        PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
    })?;

    // Publish to NATS for order-engine to process
    // Convert to PlaceOrderCommand format
    let side = match side_upper.as_str() {
        "BUY" => Side::Buy,
        "SELL" => Side::Sell,
        _ => return Err(PlaceOrderError::Status(StatusCode::BAD_REQUEST)),
    };
    
    let order_type = match order_type_upper.as_str() {
        "MARKET" => OrderType::Market,
        "LIMIT" => OrderType::Limit,
        _ => return Err(PlaceOrderError::Status(StatusCode::BAD_REQUEST)),
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
        group_id: claims.group_id.map(|u| u.to_string()),
        min_leverage: user_min_lev,
        max_leverage: user_max_lev,
        leverage_tiers: leverage_tiers,
        account_type: account_type.clone(),
    };

    let msg = VersionedMessage::new("cmd.order.place", &place_order_cmd)
        .map_err(|e| {
            error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=versioned_message status=500");
            PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
        })?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|e| {
            error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=serialize_command status=500");
            PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
        })?;

    info!("📤 Publishing order command to NATS: cmd.order.place, order_id={}, user_id={}, symbol={}, account_type={:?}",
          order_id, user_id, req.symbol, account_type);

    // Sync balance to Redis so order-engine validation sees the same balance we validated
    if let Ok(mut conn_bal) = orders_state.redis.get().await {
        let summary_key = Keys::account_summary(user_id);
        let equity_val: Option<String> = conn_bal.hget(&summary_key, "equity").await.ok().flatten();
        let margin_used_val: Option<String> = conn_bal.hget(&summary_key, "margin_used").await.ok().flatten();
        let free_margin_synced: String = conn_bal.hget(&summary_key, "free_margin").await.ok().flatten()
            .unwrap_or_else(|| free_margin.to_string());
        let equity = equity_val.as_deref().unwrap_or(&free_margin_synced);
        let margin_used = margin_used_val.as_deref().unwrap_or("0");
        let balance_json = serde_json::json!({
            "currency": "USD",
            "available": free_margin_synced,
            "locked": "0",
            "equity": equity,
            "margin_used": margin_used,
            "free_margin": free_margin_synced,
            "updated_at": now.timestamp_millis()
        });
        let balance_key = format!("user:{}:balance", user_id);
        if let Err(e) = conn_bal.set::<_, _, ()>(&balance_key, balance_json.to_string()).await {
            warn!(order_id = %order_id, user_id = %user_id, error = %e, "Failed to sync balance to Redis for order-engine");
        }
    }
    
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
            error!(order_id = %order_id, user_id = %user_id, error = %e, "place_order FAILED stage=nats_publish status=500");
            PlaceOrderError::Status(StatusCode::INTERNAL_SERVER_ERROR)
        })?;
    info!(order_id = %order_id, user_id = %user_id, symbol = %req.symbol, "✅ Published to NATS (basic pub/sub): cmd.order.place");

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
    if let Ok(mut conn) = orders_state.redis.get().await {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("orders:updates")
            .arg(redis_payload.to_string())
            .query_async(&mut conn)
            .await;
    }

    info!(
        order_id = %order_id,
        user_id = %user_id,
        symbol = %req.symbol,
        side = %side_upper,
        order_type = %order_type_upper,
        "place_order SUCCESS status=200"
    );

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
    if let Ok(mut conn) = orders_state.redis.get().await {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("orders:updates")
            .arg(redis_payload.to_string())
            .query_async(&mut conn)
            .await;
    }

    info!("Order cancelled: order_id={}, user_id={}", order_id, user_id);
    // Return 204 No Content so the frontend does not try to parse a JSON body (cancel has no response body).
    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// SYNC PENDING ORDERS (ADMIN) — recover orders that are pending in DB but missing in Redis
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPendingOrdersResponse {
    pub synced: u32,
    pub skipped: u32,
    pub errors: u32,
    pub order_ids_synced: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct PendingOrderRow {
    id: Uuid,
    user_id: Uuid,
    symbol_code: String,
    side: String,
    order_type: String,
    size: rust_decimal::Decimal,
    price: Option<rust_decimal::Decimal>,
    stop_price: Option<rust_decimal::Decimal>,
    reference: Option<String>,
    created_at: chrono::DateTime<Utc>,
}

async fn sync_pending_orders(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(orders_state): Extension<OrdersState>,
) -> Result<Json<SyncPendingOrdersResponse>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "trading:view")
        .await
        .map_err(|e| {
            (
                e.status,
                Json(serde_json::json!({
                    "error": { "message": e.message }
                })),
            )
        })?;

    let pending: Vec<PendingOrderRow> = sqlx::query_as(
        r#"
        SELECT o.id, o.user_id, s.code AS symbol_code,
               o.side::text AS side, o.type::text AS order_type,
               o.size, o.price, o.stop_price, o.reference, o.created_at
        FROM orders o
        JOIN symbols s ON s.id = o.symbol_id
        WHERE o.status = 'pending'::order_status
        ORDER BY o.created_at DESC
        LIMIT 500
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Sync pending orders: failed to fetch: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "message": "Failed to fetch pending orders" } })),
        )
    })?;

    let mut conn = orders_state
        .redis
        .get()
        .await
        .map_err(|_| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": { "message": "Redis unavailable" } })),
            )
        })?;

    let mut synced = 0u32;
    let mut skipped = 0u32;
    let mut errors = 0u32;
    let mut order_ids_synced = Vec::new();

    for row in pending {
        let order_key = format!("order:{}", row.id);
        let value: Option<String> = conn.get(&order_key).await.ok().flatten();
        let exists = value.is_some();
        if exists {
            skipped += 1;
            continue;
        }

        let side = match row.side.to_uppercase().as_str() {
            "BUY" => Side::Buy,
            "SELL" => Side::Sell,
            _ => {
                warn!("Sync: order {} has invalid side {}", row.id, row.side);
                errors += 1;
                continue;
            }
        };
        let order_type = match row.order_type.to_uppercase().as_str() {
            "MARKET" => OrderType::Market,
            "LIMIT" => OrderType::Limit,
            _ => {
                warn!("Sync: order {} has invalid type {}", row.id, row.order_type);
                errors += 1;
                continue;
            }
        };

        #[derive(sqlx::FromRow)]
        struct UserLevRow {
            min_leverage: Option<i32>,
            max_leverage: Option<i32>,
            account_type: Option<String>,
            group_id: Option<Uuid>,
        }
        let user_lev: Option<UserLevRow> = sqlx::query_as(
            r#"SELECT min_leverage, max_leverage, account_type, group_id FROM users WHERE id = $1"#,
        )
        .bind(row.user_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
        let (user_min_lev, user_max_lev, account_type, group_id) = user_lev
            .as_ref()
            .map(|r| (r.min_leverage, r.max_leverage, r.account_type.clone(), r.group_id))
            .unwrap_or((None, None, None, None));
        let account_type = account_type
            .filter(|s| s == "hedging" || s == "netting")
            .or_else(|| Some("hedging".to_string()));

        #[derive(sqlx::FromRow)]
        struct ProfileIdRow {
            leverage_profile_id: Option<Uuid>,
        }
        let profile_row: Option<ProfileIdRow> = sqlx::query_as(
            r#"
            SELECT COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id) AS leverage_profile_id
            FROM users u
            INNER JOIN user_groups ug ON ug.id = u.group_id
            INNER JOIN symbols s ON LOWER(TRIM(s.code)) = LOWER(TRIM($2))
            LEFT JOIN group_symbols gs ON gs.symbol_id = s.id AND gs.group_id = ug.id
            WHERE u.id = $1
            "#,
        )
        .bind(row.user_id)
        .bind(&row.symbol_code)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();

        let leverage_tiers: Option<Vec<CmdLeverageTier>> = match profile_row.and_then(|r| r.leverage_profile_id) {
            Some(pid) => {
                let tiers: Vec<LeverageProfileTier> = sqlx::query_as(
                    r#"
                    SELECT id, profile_id, tier_index,
                        notional_from::text AS notional_from, notional_to::text AS notional_to,
                        max_leverage, initial_margin_percent::text AS initial_margin_percent,
                        maintenance_margin_percent::text AS maintenance_margin_percent,
                        created_at, updated_at
                    FROM leverage_profile_tiers WHERE profile_id = $1 ORDER BY tier_index ASC
                    "#,
                )
                .bind(pid)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
                if tiers.is_empty() {
                    None
                } else {
                    Some(
                        tiers
                            .into_iter()
                            .map(|t| CmdLeverageTier {
                                notional_from: t.notional_from,
                                notional_to: t.notional_to,
                                max_leverage: t.max_leverage,
                            })
                            .collect(),
                    )
                }
            }
            None => None,
        };

        let idempotency_key = format!("sync-{}", row.id);
        let place_order_cmd = PlaceOrderCommand {
            order_id: row.id,
            user_id: row.user_id,
            symbol: row.symbol_code.clone(),
            side,
            order_type,
            size: row.size,
            limit_price: row.price,
            sl: row.stop_price,
            tp: None,
            tif: TimeInForce::Gtc,
            client_order_id: row.reference.clone(),
            idempotency_key: idempotency_key.clone(),
            ts: row.created_at,
            group_id: group_id.map(|u| u.to_string()),
            min_leverage: user_min_lev,
            max_leverage: user_max_lev,
            leverage_tiers,
            account_type: account_type.clone(),
        };

        let msg = match VersionedMessage::new("cmd.order.place", &place_order_cmd) {
            Ok(m) => m,
            Err(e) => {
                error!("Sync: failed to build message for order {}: {}", row.id, e);
                errors += 1;
                continue;
            }
        };
        let payload = match serde_json::to_vec(&msg) {
            Ok(p) => p,
            Err(e) => {
                error!("Sync: failed to serialize order {}: {}", row.id, e);
                errors += 1;
                continue;
            }
        };

        if let Err(e) = orders_state
            .nats
            .publish("cmd.order.place".to_string(), payload.into())
            .await
        {
            error!("Sync: failed to publish order {}: {}", row.id, e);
            errors += 1;
            continue;
        }

        synced += 1;
        order_ids_synced.push(row.id.to_string());
        info!(
            "Sync: republished pending order {} to order-engine (user={}, symbol={})",
            row.id, row.user_id, row.symbol_code
        );
    }

    info!(
        "Sync pending orders: synced={}, skipped={}, errors={}",
        synced, skipped, errors
    );

    Ok(Json(SyncPendingOrdersResponse {
        synced,
        skipped,
        errors,
        order_ids_synced,
    }))
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
        .route("/sync-pending", post(sync_pending_orders))
        .route("/:order_id/cancel", post(cancel_order))
        .layer(axum::middleware::from_fn_with_state(
            pool.clone(),
            auth_middleware,
        ))
        .layer(axum::Extension(orders_state))
        .with_state(pool)
}

