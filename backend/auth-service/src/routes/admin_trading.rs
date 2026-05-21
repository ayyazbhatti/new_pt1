use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use contracts::{
    commands::{CancelOrderCommand, PlaceOrderCommand},
    enums::{OrderType, Side, TimeInForce},
    VersionedMessage,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::routes::deposits::{compute_and_cache_account_summary, get_free_margin_from_db_fast};
use crate::routes::orders::{compute_order_margin_details, PlaceOrderError, MIN_REQUIRED_MARGIN_USD};
use crate::routes::scoped_access;
use crate::services::bonus_service;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;
use redis::AsyncCommands;
use redis_model::keys::Keys;

#[derive(Clone)]
pub struct AdminTradingState {
    pub redis: Arc<crate::redis_pool::RedisPool>,
    pub nats: Arc<async_nats::Client>,
}

// ============================================================================
// TYPES
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOrder {
    pub id: String,
    pub user_id: String,
    pub user_name: String,
    pub user_email: Option<String>,
    pub group_id: String,
    pub group_name: String,
    pub symbol_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub size: f64,
    pub filled_size: Option<f64>,
    pub price: Option<f64>,
    pub stop_price: Option<f64>,
    pub time_in_force: Option<String>,
    pub status: String,
    pub average_price: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
    pub cancelled_at: Option<String>,
    pub filled_at: Option<String>,
    pub rejected_at: Option<String>,
    pub rejection_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminPosition {
    pub id: String,
    pub user_id: String,
    pub user_name: String,
    pub user_email: Option<String>,
    pub group_id: String,
    pub group_name: String,
    pub symbol_id: String,
    pub symbol: String,
    pub side: String,
    pub size: f64,
    pub entry_price: f64,
    pub mark_price: f64,
    pub leverage: i32,
    pub margin_used: f64,
    pub margin_available: Option<f64>,
    pub liquidation_price: f64,
    pub pnl: f64,
    pub pnl_percent: f64,
    pub status: String,
    pub stop_loss: Option<f64>,
    pub take_profit: Option<f64>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub last_updated_at: String,
    pub accumulated_swap_usd: f64,
    pub accumulated_fees_usd: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuditLog {
    pub id: String,
    pub timestamp: String,
    pub admin_id: String,
    pub admin_email: String,
    pub action: String,
    pub target_type: String,
    pub target_id: String,
    pub details: Option<serde_json::Value>,
    pub ip_address: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    pub status: Option<String>,
    pub symbol: Option<String>,
    pub user_id: Option<String>,
    pub group_id: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPositionsQuery {
    pub status: Option<String>,
    pub symbol: Option<String>,
    pub user_id: Option<String>,
    pub group_id: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListAuditQuery {
    pub r#type: Option<String>,
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderRequest {
    pub user_id: String,
    pub symbol_id: String,
    pub side: String,
    pub order_type: String,
    pub size: f64,
    pub price: Option<f64>,
    pub stop_price: Option<f64>,
    pub time_in_force: Option<String>,
    pub stop_loss: Option<f64>,
    pub take_profit: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct ClosePositionRequest {
    pub size: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifySltpRequest {
    pub stop_loss: Option<f64>,
    pub take_profit: Option<f64>,
}

/// Body for POST /api/admin/positions/:id/reopen-with-params (restore same position with edited fields).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReopenWithParamsRequest {
    pub size: f64,
    pub entry_price: Option<f64>,
    pub side: Option<String>,
    pub stop_loss: Option<f64>,
    pub take_profit: Option<f64>,
}

/// Body for POST /api/admin/positions/:id/update-params (update open position size, entry, SL, TP).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePositionParamsRequest {
    pub size: Option<f64>,
    pub entry_price: Option<f64>,
    pub stop_loss: Option<f64>,
    pub take_profit: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub cursor: Option<String>,
    pub has_more: bool,
    pub total: Option<i64>,
    /// Open positions only: sum of margin_used across all matching rows (not just this page).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_margin_used: Option<f64>,
    /// Open positions only: sum of unrealized PnL from Redis across all matching rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_unrealized_pnl: Option<f64>,
    /// Closed/liquidated positions only: sum of realized PnL across all matching rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_realized_pnl: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

impl ErrorResponse {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: ErrorDetail {
                code: code.into(),
                message: message.into(),
            },
            current_status: None,
            suggestion: None,
        }
    }

    pub fn with_order_hint(
        code: impl Into<String>,
        message: impl Into<String>,
        current_status: String,
        suggestion: impl Into<String>,
    ) -> Self {
        Self {
            error: ErrorDetail {
                code: code.into(),
                message: message.into(),
            },
            current_status: Some(current_status),
            suggestion: Some(suggestion.into()),
        }
    }
}

// Types are already public and can be accessed via crate::routes::admin_trading::

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn permission_denied_to_response(
    e: permission_check::PermissionDenied,
) -> (StatusCode, Json<ErrorResponse>) {
    (
        e.status,
        Json(ErrorResponse::new(e.code, e.message)),
    )
}

// ============================================================================
// LIST ORDERS (ADMIN)
// ============================================================================

async fn list_admin_orders(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ListOrdersQuery>,
) -> Result<Json<PaginatedResponse<AdminOrder>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "trading:view")
        .await
        .map_err(permission_denied_to_response)?;

    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, Json(se))| {
            (
                status,
                Json(ErrorResponse::new(se.error.code, se.error.message)),
            )
        })?;

    let limit = params.limit.unwrap_or(50).min(500);
    let offset = params
        .cursor
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);
    let is_order_history = params.status.as_deref() == Some("order-history");

    let status_filter = if is_order_history {
        None::<&str>
    } else {
        params.status.as_deref()
    };

    let count_row: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN user_groups ug ON u.group_id = ug.id
        LEFT JOIN symbols s ON o.symbol_id = s.id
        WHERE 
            (
                ($7::bool AND o.status::text IN ('filled', 'cancelled'))
                OR (NOT $7::bool AND ($1::text IS NULL OR o.status::text = $1))
            )
            AND ($2::text IS NULL OR s.code = $2)
            AND ($3::text IS NULL OR o.user_id::text = $3)
            AND ($4::text IS NULL OR u.group_id::text = $4)
            AND ($5::text IS NULL OR (
                s.code ILIKE $5 OR 
                u.email ILIKE $5 OR 
                u.first_name ILIKE $5 OR 
                u.last_name ILIKE $5
            ))
            AND ($6::uuid[] IS NULL OR o.user_id = ANY($6))
        "#,
    )
    .bind(status_filter)
    .bind(params.symbol.as_deref())
    .bind(params.user_id.as_deref())
    .bind(params.group_id.as_deref())
    .bind(params.search.as_ref().map(|s| format!("%{}%", s)))
    .bind(allowed_user_ids.as_deref())
    .bind(is_order_history)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        error!("Failed to count orders: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to fetch orders".to_string())),
        )
    })?;
    let total_count = count_row.0;

    // Use a single query with COALESCE for optional filters. When allowed_user_ids is Some(ids), restrict to those users.
    let rows = sqlx::query(
        r#"
        SELECT 
            o.id,
            o.user_id,
            u.first_name || ' ' || u.last_name as user_name,
            u.email as user_email,
            COALESCE(ug.id::text, '') as group_id,
            COALESCE(ug.name, '') as group_name,
            o.symbol_id::text as symbol_id,
            s.code as symbol,
            o.side::text as side,
            o.type::text as order_type,
            o.size,
            o.filled_size,
            o.price,
            o.stop_price,
            o.status::text as status,
            o.average_price,
            o.created_at,
            o.updated_at,
            o.reference
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN user_groups ug ON u.group_id = ug.id
        LEFT JOIN symbols s ON o.symbol_id = s.id
        WHERE 
            (
                ($9::bool AND o.status::text IN ('filled', 'cancelled'))
                OR (NOT $9::bool AND ($1::text IS NULL OR o.status::text = $1))
            )
            AND ($2::text IS NULL OR s.code = $2)
            AND ($3::text IS NULL OR o.user_id::text = $3)
            AND ($4::text IS NULL OR u.group_id::text = $4)
            AND ($5::text IS NULL OR (
                s.code ILIKE $5 OR 
                u.email ILIKE $5 OR 
                u.first_name ILIKE $5 OR 
                u.last_name ILIKE $5
            ))
            AND ($8::uuid[] IS NULL OR o.user_id = ANY($8))
        ORDER BY CASE WHEN $9::bool THEN o.updated_at ELSE o.created_at END DESC NULLS LAST
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(status_filter)
    .bind(params.symbol.as_deref())
    .bind(params.user_id.as_deref())
    .bind(params.group_id.as_deref())
    .bind(params.search.as_ref().map(|s| format!("%{}%", s)))
    .bind(limit)
    .bind(offset)
    .bind(allowed_user_ids.as_deref())
    .bind(is_order_history)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch orders: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to fetch orders".to_string())),
        )
    })?;

    let orders: Vec<AdminOrder> = rows
        .into_iter()
        .map(|row| {
            let size: Decimal = row.get(10);
            let filled_size: Option<Decimal> = row.get(11);
            let price: Option<Decimal> = row.get(12);
            let stop_price: Option<Decimal> = row.get(13);
            let average_price: Option<Decimal> = row.get(15); // Column 15 is average_price

            AdminOrder {
                id: row.get::<Uuid, _>(0).to_string(),
                user_id: row.get::<Uuid, _>(1).to_string(),
                user_name: row.get(2),
                user_email: row.get(3),
                group_id: row.get(4),
                group_name: row.get(5),
                symbol_id: row.get(6),
                symbol: row.get(7),
                side: row.get(8),
                order_type: row.get(9),
                size: size.to_string().parse::<f64>().unwrap_or(0.0),
                filled_size: filled_size.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
                price: price.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
                stop_price: stop_price.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
                time_in_force: None, // Column doesn't exist in orders table
                status: row.get(14),
                average_price: average_price.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
                created_at: row.get::<chrono::DateTime<Utc>, _>(16).to_rfc3339(), // Column 16 is created_at
                updated_at: row.get::<chrono::DateTime<Utc>, _>(17).to_rfc3339(), // Column 17 is updated_at
                cancelled_at: None,     // Column doesn't exist in orders table
                filled_at: None,        // Column doesn't exist in orders table
                rejected_at: None,      // Column doesn't exist in orders table
                rejection_reason: None, // Column doesn't exist in orders table (reference exists but not rejection_reason)
            }
        })
        .collect();

    let has_more = offset + (orders.len() as i64) < total_count;
    let next_cursor = if has_more {
        Some((offset + limit).to_string())
    } else {
        None
    };

    Ok(Json(PaginatedResponse {
        items: orders,
        cursor: next_cursor,
        has_more,
        total: Some(total_count),
        total_margin_used: None,
        total_unrealized_pnl: None,
        total_realized_pnl: None,
    }))
}

// ============================================================================
// CREATE ORDER (ADMIN)
// ============================================================================

async fn create_admin_order(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Json(req): Json<CreateOrderRequest>,
) -> Result<Json<AdminOrder>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "trading:create_order")
        .await
        .map_err(permission_denied_to_response)?;

    let order_id = Uuid::new_v4();
    let user_id = Uuid::parse_str(&req.user_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("INVALID_USER_ID".to_string(), "Invalid user_id format".to_string())),
        )
    })?;

    let symbol_id = Uuid::parse_str(&req.symbol_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("INVALID_SYMBOL_ID".to_string(), "Invalid symbol_id format".to_string())),
        )
    })?;

    let size = Decimal::try_from(req.size).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new("INVALID_SIZE".to_string(), "Invalid size".to_string())),
        )
    })?;

    let price = req.price.and_then(|p| Decimal::try_from(p).ok());
    let stop_price = req.stop_price.and_then(|p| Decimal::try_from(p).ok());

    let now = Utc::now();
    let side_lower = req.side.to_lowercase();
    let order_type_lower = req.order_type.to_lowercase();

    // Get user and symbol info
    #[derive(sqlx::FromRow)]
    struct AdminCreateTargetUser {
        first_name: String,
        last_name: String,
        email: String,
        group_id: Option<Uuid>,
        account_type: String,
        min_leverage: Option<i32>,
        max_leverage: Option<i32>,
        trading_access: Option<String>,
    }
    let user_row = sqlx::query_as::<_, AdminCreateTargetUser>(
        r#"SELECT COALESCE(first_name, '') AS first_name,
                  COALESCE(last_name, '') AS last_name,
                  email, group_id,
                  COALESCE(account_type, 'hedging') AS account_type,
                  min_leverage, max_leverage,
                  COALESCE(trading_access, 'full') AS trading_access
           FROM users WHERE id = $1"#,
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch user: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to fetch user".to_string())),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse::new("USER_NOT_FOUND".to_string(), "User not found".to_string())),
    ))?;

    let symbol_row = sqlx::query!(r#"SELECT code FROM symbols WHERE id = $1"#, symbol_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            error!("Failed to fetch symbol: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to fetch symbol".to_string())),
            )
        })?
        .ok_or((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse::new("SYMBOL_NOT_FOUND".to_string(), "Symbol not found".to_string())),
        ))?;

    let group_name = if let Some(group_id) = user_row.group_id {
        sqlx::query_scalar::<_, String>(r#"SELECT name FROM user_groups WHERE id = $1"#)
            .bind(group_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "Unknown".to_string())
    } else {
        "Unknown".to_string()
    };

    let side_upper = req.side.to_uppercase();
    let order_type_upper = req.order_type.to_uppercase();
    if user_row.trading_access.as_deref().unwrap_or("full") != "full" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse::new(
                "TRADING_DISABLED".to_string(),
                "Trading is disabled for this user.".to_string(),
            )),
        ));
    }

    let margin = compute_order_margin_details(
        &pool,
        admin_state.redis.as_ref(),
        user_id,
        user_row.group_id,
        &symbol_row.code,
        &side_upper,
        &order_type_upper,
        size,
        price,
        user_row.min_leverage,
        user_row.max_leverage,
        Some(user_row.account_type.clone()),
    )
    .await
    .map_err(|e| {
        let msg = match &e {
            PlaceOrderError::LeverageConfigurationInvalid { message } => message.clone(),
            PlaceOrderError::InsufficientMargin {
                required_margin,
                free_margin,
                estimated_fee_usd,
                total_required_usd,
            } => format!(
                "Insufficient free margin: required {} (margin {} + fee {}) available {}",
                total_required_usd, required_margin, estimated_fee_usd, free_margin
            ),
            PlaceOrderError::MinimumMarginNotMet {
                required_margin,
                min_required_margin,
            } => format!(
                "Minimum margin: required {} min {}",
                required_margin, min_required_margin
            ),
            PlaceOrderError::TradingRestricted { message } => message.clone(),
            PlaceOrderError::BonusLock(m) => m.clone(),
            PlaceOrderError::Status(_) => "Order margin validation failed".to_string(),
        };
        let code = match &e {
            PlaceOrderError::InsufficientMargin { .. } => "INSUFFICIENT_FREE_MARGIN",
            PlaceOrderError::MinimumMarginNotMet { .. } => "MIN_REQUIRED_MARGIN_NOT_MET",
            PlaceOrderError::LeverageConfigurationInvalid { .. } => "LEVERAGE_CONFIGURATION",
            PlaceOrderError::TradingRestricted { .. } => "TRADING_DISABLED",
            PlaceOrderError::BonusLock(_) => "BONUS_LOCK",
            PlaceOrderError::Status(_) => "ORDER_MARGIN",
        };
        let status = match &e {
            PlaceOrderError::InsufficientMargin { .. } => StatusCode::FORBIDDEN,
            PlaceOrderError::TradingRestricted { .. } => StatusCode::FORBIDDEN,
            PlaceOrderError::MinimumMarginNotMet { .. } | PlaceOrderError::LeverageConfigurationInvalid { .. } => {
                StatusCode::BAD_REQUEST
            }
            PlaceOrderError::Status(s) => *s,
            PlaceOrderError::BonusLock(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(ErrorResponse::new(code.to_string(), msg)))
    })?;

    let required_margin = margin.required_margin;
    let min_required = Decimal::from(MIN_REQUIRED_MARGIN_USD);
    if required_margin < min_required {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::new(
                "MIN_REQUIRED_MARGIN_NOT_MET".to_string(),
                format!(
                    "Estimated margin ({}) is below minimum {}.",
                    required_margin, min_required
                ),
            )),
        ));
    }

    let fm = get_free_margin_from_db_fast(&pool, user_id).await.unwrap_or(Decimal::ZERO);
    if required_margin > fm {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse::new(
                "INSUFFICIENT_FREE_MARGIN".to_string(),
                format!(
                    "Required margin {} exceeds free margin {}.",
                    required_margin, fm
                ),
            )),
        ));
    }

    let mut tx = pool.begin().await.map_err(|e| {
        error!("admin create order: begin tx: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(
                "INTERNAL_ERROR".to_string(),
                "Database error".to_string(),
            )),
        )
    })?;

    let alloc = bonus_service::lock_margin(&mut tx, user_id, required_margin)
        .await
        .map_err(|e| {
            let (code, status) = match &e {
                crate::services::bonus_service::BonusError::InsufficientMargin => {
                    ("INSUFFICIENT_FREE_MARGIN", StatusCode::FORBIDDEN)
                }
                _ => ("BONUS_LOCK", StatusCode::INTERNAL_SERVER_ERROR),
            };
            (
                status,
                Json(ErrorResponse::new(code.to_string(), e.to_string())),
            )
        })?;

    sqlx::query(
        r#"
        INSERT INTO orders (
            id, user_id, symbol_id, side, type, size, price, stop_price,
            status, reference, created_at, updated_at, margin_from_cash, margin_from_bonus
        )
        VALUES ($1, $2, $3, $4::order_side, $5::order_type, $6, $7, $8, $9::order_status, $10, $11, $12, $13, $14)
        "#,
    )
    .bind(order_id)
    .bind(user_id)
    .bind(symbol_id)
    .bind(&side_lower)
    .bind(&order_type_lower)
    .bind(size)
    .bind(price)
    .bind(stop_price)
    .bind("pending")
    .bind(Some("admin"))
    .bind(now)
    .bind(now)
    .bind(alloc.from_cash)
    .bind(alloc.from_bonus)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        error!("Failed to insert order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to create order".to_string())),
        )
    })?;

    tx.commit().await.map_err(|e| {
        error!("admin create order: commit: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(
                "INTERNAL_ERROR".to_string(),
                "Failed to commit order".to_string(),
            )),
        )
    })?;

    compute_and_cache_account_summary(&pool, admin_state.redis.as_ref(), user_id).await;

    // Publish to NATS as PlaceOrderCommand so order-engine can deserialize and process
    let side = match side_lower.as_str() {
        "buy" => Side::Buy,
        "sell" => Side::Sell,
        _ => {
            error!("Invalid side: {}", req.side);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("INVALID_SIDE".to_string(), "Side must be BUY or SELL".to_string())),
            ));
        }
    };
    let order_type = match order_type_lower.as_str() {
        "market" => OrderType::Market,
        "limit" => OrderType::Limit,
        _ => {
            error!("Invalid order type: {}", req.order_type);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::new("INVALID_ORDER_TYPE".to_string(), "Order type must be MARKET or LIMIT".to_string())),
            ));
        }
    };
    let tif = match req
        .time_in_force
        .as_deref()
        .unwrap_or("GTC")
        .to_uppercase()
        .as_str()
    {
        "GTC" => TimeInForce::Gtc,
        "IOC" => TimeInForce::Ioc,
        "FOK" => TimeInForce::Fok,
        _ => TimeInForce::Gtc,
    };
    let sl = req
        .stop_loss
        .or(req.stop_price)
        .and_then(|p| Decimal::try_from(p).ok());
    let tp = req.take_profit.and_then(|p| Decimal::try_from(p).ok());

    let account_type_cmd = if margin.account_type.as_deref() == Some("netting") {
        Some("netting".to_string())
    } else {
        Some("hedging".to_string())
    };
    let place_order_cmd = PlaceOrderCommand {
        order_id,
        user_id,
        symbol: symbol_row.code.clone(),
        side,
        order_type,
        size,
        limit_price: price,
        sl,
        tp,
        tif,
        client_order_id: None,
        idempotency_key: format!("admin:{}", order_id),
        ts: now,
        group_id: user_row.group_id.map(|g| g.to_string()),
        min_leverage: Some(margin.user_min_resolved),
        max_leverage: Some(margin.user_max_resolved),
        leverage_tiers: margin.leverage_tiers.clone(),
        account_type: account_type_cmd,
        margin_from_cash: Some(alloc.from_cash),
        margin_from_bonus: Some(alloc.from_bonus),
    };

    let msg = VersionedMessage::new("cmd.order.place", &place_order_cmd).map_err(|e| {
        error!("Failed to create versioned message: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to publish order event".to_string())),
        )
    })?;
    let payload = serde_json::to_vec(&msg).map_err(|e| {
        error!("Failed to serialize order command: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to serialize order event".to_string())),
        )
    })?;

    // Sync balance to Redis so order-engine validation matches post-lock summary.
    if let Ok(mut conn_bal) = admin_state.redis.get().await {
        let summary_key = Keys::account_summary(user_id);
        let equity_val: Option<String> = conn_bal.hget(&summary_key, "equity").await.ok().flatten();
        let margin_used_val: Option<String> = conn_bal.hget(&summary_key, "margin_used").await.ok().flatten();
        let free_margin_synced: String = conn_bal
            .hget(&summary_key, "free_margin")
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| fm.to_string());
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
        if let Err(e) = conn_bal
            .set::<_, _, ()>(&balance_key, balance_json.to_string())
            .await
        {
            tracing::warn!("Admin order: failed to sync balance to Redis: {}", e);
        }
    }

    info!(
        "Publishing admin order to NATS: cmd.order.place, order_id={}, user_id={}, symbol={}",
        order_id, user_id, symbol_row.code
    );
    // Publish to JetStream first — order-engine only consumes from JetStream, so this must succeed for the order to be processed.
    let js_context = async_nats::jetstream::new((*admin_state.nats).clone());
    let payload_bytes = payload.clone();
    js_context
        .publish("cmd.order.place".to_string(), payload_bytes.into())
        .await
        .map_err(|e| {
            error!("Admin order JetStream publish failed: {}", e);
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse::new("ORDER_QUEUE_UNAVAILABLE".to_string(), "Order queue temporarily unavailable. Please try again."
                            .to_string())),
            )
        })?;
    admin_state
        .nats
        .publish("cmd.order.place".to_string(), payload.into())
        .await
        .map_err(|e| {
            error!("Failed to publish to NATS: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to publish order event".to_string())),
            )
        })?;

    // Publish admin.order.created event
    let admin_event = serde_json::json!({
        "order": {
            "id": order_id.to_string(),
            "userId": user_id.to_string(),
            "userName": format!("{} {}", user_row.first_name, user_row.last_name),
            "userEmail": user_row.email.clone(),
            "groupId": user_row.group_id.map(|g| g.to_string()).unwrap_or_default(),
            "groupName": group_name,
            "symbolId": symbol_id.to_string(),
            "symbol": symbol_row.code.clone(),
            "side": req.side.clone(),
            "orderType": req.order_type.clone(),
            "size": req.size,
            "price": req.price,
            "stopPrice": req.stop_price,
            "timeInForce": req.time_in_force.clone(),
            "status": "pending",
            "createdAt": now.to_rfc3339(),
            "updatedAt": now.to_rfc3339(),
        }
    });

    let admin_msg = VersionedMessage::new("admin.order.created", &admin_event).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to publish admin event".to_string())),
        )
    })?;
    let admin_payload = serde_json::to_vec(&admin_msg).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to serialize admin event".to_string())),
        )
    })?;

    admin_state
        .nats
        .publish("admin.order.created".to_string(), admin_payload.into())
        .await
        .ok(); // Don't fail if this fails

    // Also publish to Redis
    let redis_payload = serde_json::json!({
        "type": "admin.order.created",
        "payload": admin_event,
    });
    if let Ok(mut conn) = admin_state.redis.get().await {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("admin:orders")
            .arg(redis_payload.to_string())
            .query_async(&mut conn)
            .await;
    }

    // Return created order
    Ok(Json(AdminOrder {
        id: order_id.to_string(),
        user_id: user_id.to_string(),
        user_name: format!(
            "{} {}",
            user_row.first_name,
            user_row.last_name
        ),
        user_email: Some(user_row.email.clone()),
        group_id: user_row.group_id.map(|g| g.to_string()).unwrap_or_default(),
        group_name: group_name,
        symbol_id: symbol_id.to_string(),
        symbol: symbol_row.code.clone(),
        side: req.side.clone(),
        order_type: req.order_type.clone(),
        size: req.size,
        filled_size: None,
        price: req.price,
        stop_price: req.stop_price,
        time_in_force: req.time_in_force,
        status: "pending".to_string(),
        average_price: None,
        created_at: now.to_rfc3339(),
        updated_at: now.to_rfc3339(),
        cancelled_at: None,
        filled_at: None,
        rejected_at: None,
        rejection_reason: None,
    }))
}

// ============================================================================
// CANCEL ORDER (ADMIN)
// ============================================================================

async fn cancel_admin_order(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(order_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "trading:cancel_order")
        .await
        .map_err(permission_denied_to_response)?;

    let now = Utc::now();

    // Check if order exists
    let order_row = sqlx::query!(
        r#"SELECT user_id, status::text as status FROM orders WHERE id = $1"#,
        order_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to fetch order".to_string())),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse::new("ORDER_NOT_FOUND".to_string(), "Order not found".to_string())),
    ))?;

    let user_id = order_row.user_id;

    // Only pending orders go through engine cancel; use force_cancel for terminal-state overrides.
    let result = sqlx::query(
        r#"
        UPDATE orders
        SET status = 'cancelling'::order_status, updated_at = $1
        WHERE id = $2 AND status = 'pending'::order_status
        "#,
    )
    .bind(now)
    .bind(order_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to cancel order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to cancel order".to_string())),
        )
    })?;

    if result.rows_affected() == 0 {
        let current_status = order_row.status.as_deref().unwrap_or("unknown").to_string();
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::with_order_hint(
                "ORDER_NOT_CANCELLABLE",
                "Order is not in pending state. Use force cancel to mark non-pending orders as cancelled.",
                current_status,
                "force_cancel",
            )),
        ));
    }

    let cancel_cmd = CancelOrderCommand {
        user_id,
        order_id,
        idempotency_key: Uuid::new_v4().to_string(),
        ts: now,
    };

    let msg = VersionedMessage::new("cmd.order.cancel", &cancel_cmd).map_err(|e| {
        error!("Failed to create VersionedMessage for admin cancel: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to publish cancel command".to_string())),
        )
    })?;
    let payload = serde_json::to_vec(&msg).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to serialize cancel command".to_string())),
        )
    })?;

    // TODO: If NATS publish fails, order is stuck in 'cancelling' state.
    // Consider implementing a sweeper that reverts cancelling orders older than N minutes back to pending if no engine event arrives.
    admin_state
        .nats
        .publish("cmd.order.cancel".to_string(), payload.into())
        .await
        .map_err(|e| {
            error!(
                "Failed to publish cancel command to NATS for order {}: {}",
                order_id, e
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to publish cancel command to NATS".to_string())),
            )
        })?;

    // Notify admin UI via Redis (engine evt.order.updated will finalize DB + user WS)
    let redis_payload = serde_json::json!({
        "type": "admin.order.cancelling",
        "payload": {
            "orderId": order_id.to_string(),
            "userId": user_id.to_string(),
            "timestamp": now.to_rfc3339(),
        },
    });
    if let Ok(mut conn) = admin_state.redis.get().await {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("admin:orders")
            .arg(redis_payload.to_string())
            .query_async(&mut conn)
            .await;
    }

    info!(
        "Admin cancel requested: order_id={}, admin_id={}",
        order_id, claims.sub
    );
    Ok(StatusCode::OK)
}

// ============================================================================
// FORCE CANCEL ORDER (ADMIN)
// ============================================================================

async fn force_cancel_admin_order(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(order_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "trading:cancel_order")
        .await
        .map_err(permission_denied_to_response)?;

    let now = Utc::now();

    let order_row = sqlx::query!(
        r#"SELECT user_id, status::text as "status!" FROM orders WHERE id = $1"#,
        order_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to fetch order".to_string())),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse::new("ORDER_NOT_FOUND".to_string(), "Order not found".to_string())),
    ))?;

    let user_id = order_row.user_id;
    let current_status = order_row.status;
    let needs_engine_cancel = matches!(current_status.as_str(), "pending" | "cancelling");

    // Force cancel: mark DB cancelled immediately (admin intent is final).
    sqlx::query(
        r#"
        UPDATE orders
        SET status = 'cancelled'::order_status, cancelled_at = $1, updated_at = $1
        WHERE id = $2 AND status <> 'cancelled'::order_status
        "#,
    )
    .bind(now)
    .bind(order_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to force cancel order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to force cancel order".to_string())),
        )
    })?;

    if needs_engine_cancel {
        let cancel_cmd = CancelOrderCommand {
            user_id,
            order_id,
            idempotency_key: Uuid::new_v4().to_string(),
            ts: now,
        };

        let msg = VersionedMessage::new("cmd.order.cancel", &cancel_cmd).map_err(|e| {
            error!("Force cancel: failed to create VersionedMessage: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to build cancel command".to_string())),
            )
        })?;
        let payload = serde_json::to_vec(&msg).map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new("INTERNAL_ERROR".to_string(), "Failed to serialize cancel command".to_string())),
            )
        })?;

        if let Err(e) = admin_state
            .nats
            .publish("cmd.order.cancel".to_string(), payload.into())
            .await
        {
            warn!(
                "Force cancel: failed to publish engine cancel for order {}: {}. DB updated to cancelled regardless.",
                order_id, e
            );
        }
    }

    let redis_payload = serde_json::json!({
        "type": "admin.order.canceled",
        "payload": {
            "orderId": order_id.to_string(),
            "userId": user_id.to_string(),
            "timestamp": now.to_rfc3339(),
        },
    });
    if let Ok(mut conn) = admin_state.redis.get().await {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("admin:orders")
            .arg(redis_payload.to_string())
            .query_async(&mut conn)
            .await;
    }

    info!(
        "Admin force cancelled order: order_id={}, admin_id={}, previous_status={}, engine_notified={}",
        order_id, claims.sub, current_status, needs_engine_cancel
    );
    Ok(StatusCode::OK)
}

// Positions and audit functions moved to separate modules

// ============================================================================
// ROUTER
// ============================================================================

pub fn create_admin_trading_router(pool: PgPool, admin_state: AdminTradingState) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_admin_orders).post(create_admin_order))
        .route("/:id/cancel", post(cancel_admin_order))
        .route("/:id/force", post(force_cancel_admin_order))
        .layer(axum::middleware::from_fn_with_state(
            pool.clone(),
            auth_middleware,
        ))
        .layer(axum::Extension(admin_state))
        .with_state(pool)
}
