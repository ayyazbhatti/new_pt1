use axum::{
    extract::{Path, Query, State, Extension},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use contracts::{VersionedMessage, commands::PlaceOrderCommand, enums::{Side, OrderType, TimeInForce}};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;
use crate::utils::permission_check;
use crate::routes::scoped_access;

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

#[derive(Debug, Deserialize)]
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

// Types are already public and can be accessed via crate::routes::admin_trading::

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
        .map_err(|(status, Json(se))| (status, Json(ErrorResponse { error: ErrorDetail { code: se.error.code, message: se.error.message } })))?;

    let limit = params.limit.unwrap_or(100).min(1000);
    let offset = params.cursor.and_then(|c| c.parse::<i64>().ok()).unwrap_or(0);

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
            ($1::text IS NULL OR o.status::text = $1)
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
        ORDER BY o.created_at DESC
        LIMIT $6 OFFSET $7
        "#
    )
    .bind(params.status.as_deref())
    .bind(params.symbol.as_deref())
    .bind(params.user_id.as_deref())
    .bind(params.group_id.as_deref())
    .bind(params.search.as_ref().map(|s| format!("%{}%", s)))
    .bind(limit)
    .bind(offset)
    .bind(allowed_user_ids.as_deref())
    .fetch_all(&pool)
    .await
        .map_err(|e| {
            error!("Failed to fetch orders: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to fetch orders".to_string(),
                    },
                }),
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
                cancelled_at: None, // Column doesn't exist in orders table
                filled_at: None, // Column doesn't exist in orders table
                rejected_at: None, // Column doesn't exist in orders table
                rejection_reason: None, // Column doesn't exist in orders table (reference exists but not rejection_reason)
            }
        })
        .collect();

    let has_more = orders.len() as i64 == limit;
    let next_cursor = if has_more {
        Some((offset + limit).to_string())
    } else {
        None
    };

    Ok(Json(PaginatedResponse {
        items: orders,
        cursor: next_cursor,
        has_more,
        total: None, // Could add COUNT query if needed
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
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_USER_ID".to_string(),
                    message: "Invalid user_id format".to_string(),
                },
            }),
        )
    })?;

    let symbol_id = Uuid::parse_str(&req.symbol_id).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_SYMBOL_ID".to_string(),
                    message: "Invalid symbol_id format".to_string(),
                },
            }),
        )
    })?;

    let size = Decimal::try_from(req.size).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_SIZE".to_string(),
                    message: "Invalid size".to_string(),
                },
            }),
        )
    })?;

    let price = req.price.and_then(|p| Decimal::try_from(p).ok());
    let stop_price = req.stop_price.and_then(|p| Decimal::try_from(p).ok());

    let now = Utc::now();
    let side_lower = req.side.to_lowercase();
    let order_type_lower = req.order_type.to_lowercase();

    // Get user and symbol info
    let user_row = sqlx::query!(
        r#"SELECT COALESCE(first_name, '') as first_name, COALESCE(last_name, '') as last_name, email, group_id, COALESCE(account_type, 'hedging') as "account_type!" FROM users WHERE id = $1"#,
        user_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch user: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to fetch user".to_string(),
                },
            }),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: "USER_NOT_FOUND".to_string(),
                message: "User not found".to_string(),
            },
        }),
    ))?;

    let symbol_row = sqlx::query!(
        r#"SELECT code FROM symbols WHERE id = $1"#,
        symbol_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch symbol: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to fetch symbol".to_string(),
                },
            }),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: "SYMBOL_NOT_FOUND".to_string(),
                message: "Symbol not found".to_string(),
            },
        }),
    ))?;

    let group_name = if let Some(group_id) = user_row.group_id {
        sqlx::query_scalar::<_, String>(
            r#"SELECT name FROM user_groups WHERE id = $1"#,
        )
        .bind(group_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "Unknown".to_string())
    } else {
        "Unknown".to_string()
    };

    // Insert order (schema: reference nullable, no time_in_force column)
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
    .bind(&side_lower)
    .bind(&order_type_lower)
    .bind(size)
    .bind(price)
    .bind(stop_price)
    .bind("pending")
    .bind(Some("admin"))
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to insert order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to create order".to_string(),
                },
            }),
        )
    })?;

    // Publish to NATS as PlaceOrderCommand so order-engine can deserialize and process
    let side = match side_lower.as_str() {
        "buy" => Side::Buy,
        "sell" => Side::Sell,
        _ => {
            error!("Invalid side: {}", req.side);
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_SIDE".to_string(),
                        message: "Side must be BUY or SELL".to_string(),
                    },
                }),
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
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_ORDER_TYPE".to_string(),
                        message: "Order type must be MARKET or LIMIT".to_string(),
                    },
                }),
            ));
        }
    };
    let tif = match req.time_in_force.as_deref().unwrap_or("GTC").to_uppercase().as_str() {
        "GTC" => TimeInForce::Gtc,
        "IOC" => TimeInForce::Ioc,
        "FOK" => TimeInForce::Fok,
        _ => TimeInForce::Gtc,
    };
    let sl = req.stop_loss.or(req.stop_price).and_then(|p| Decimal::try_from(p).ok());
    let tp = req.take_profit.and_then(|p| Decimal::try_from(p).ok());

    let account_type = if user_row.account_type == "netting" {
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
        min_leverage: None,
        max_leverage: None,
        leverage_tiers: None,
        account_type,
    };

    let msg = VersionedMessage::new("cmd.order.place", &place_order_cmd)
        .map_err(|e| {
            error!("Failed to create versioned message: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to publish order event".to_string(),
                    },
                }),
            )
        })?;
    let payload = serde_json::to_vec(&msg).map_err(|e| {
        error!("Failed to serialize order command: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize order event".to_string(),
                },
            }),
        )
    })?;

    info!("Publishing admin order to NATS: cmd.order.place, order_id={}, user_id={}, symbol={}", order_id, user_id, symbol_row.code);
    admin_state.nats.publish("cmd.order.place".to_string(), payload.into()).await
        .map_err(|e| {
            error!("Failed to publish to NATS: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to publish order event".to_string(),
                    },
                }),
            )
        })?;

    // Publish admin.order.created event
    let admin_event = serde_json::json!({
        "order": {
            "id": order_id.to_string(),
            "userId": user_id.to_string(),
            "userName": format!("{} {}", user_row.first_name.clone().unwrap_or_default(), user_row.last_name.clone().unwrap_or_default()),
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

    let admin_msg = VersionedMessage::new("admin.order.created", &admin_event)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to publish admin event".to_string(),
                    },
                }),
            )
        })?;
    let admin_payload = serde_json::to_vec(&admin_msg).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize admin event".to_string(),
                },
            }),
        )
    })?;

    admin_state.nats.publish("admin.order.created".to_string(), admin_payload.into()).await
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
        user_name: format!("{} {}", user_row.first_name.clone().unwrap_or_default(), user_row.last_name.clone().unwrap_or_default()),
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
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to fetch order".to_string(),
                },
            }),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: "ORDER_NOT_FOUND".to_string(),
                message: "Order not found".to_string(),
            },
        }),
    ))?;

    let user_id = order_row.user_id;

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
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to cancel order".to_string(),
                },
            }),
        )
    })?;

    // Publish events
    let cancel_event = serde_json::json!({
        "orderId": order_id.to_string(),
        "userId": user_id.to_string(),
        "timestamp": now.to_rfc3339(),
    });

    let msg = VersionedMessage::new("admin.order.canceled", &cancel_event)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to publish cancel event".to_string(),
                    },
                }),
            )
        })?;
    let payload = serde_json::to_vec(&msg).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize cancel event".to_string(),
                },
            }),
        )
    })?;

    admin_state.nats.publish("admin.order.canceled".to_string(), payload.into()).await
        .ok();

    // Also publish to Redis
    let redis_payload = serde_json::json!({
        "type": "admin.order.canceled",
        "payload": cancel_event,
    });
    if let Ok(mut conn) = admin_state.redis.get().await {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("admin:orders")
            .arg(redis_payload.to_string())
            .query_async(&mut conn)
            .await;
    }

    info!("Admin cancelled order: order_id={}, admin_id={}", order_id, claims.sub);
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

    // Check if order exists
    let order_row = sqlx::query!(
        r#"SELECT user_id FROM orders WHERE id = $1"#,
        order_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to fetch order".to_string(),
                },
            }),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: "ORDER_NOT_FOUND".to_string(),
                message: "Order not found".to_string(),
            },
        }),
    ))?;

    let user_id = order_row.user_id;

    // Force cancel (ignore current status)
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
        error!("Failed to force cancel order: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to force cancel order".to_string(),
                },
            }),
        )
    })?;

    // Publish events (same as cancel)
    let cancel_event = serde_json::json!({
        "orderId": order_id.to_string(),
        "userId": user_id.to_string(),
        "timestamp": now.to_rfc3339(),
    });

    let msg = VersionedMessage::new("admin.order.canceled", &cancel_event)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to publish cancel event".to_string(),
                    },
                }),
            )
        })?;
    let payload = serde_json::to_vec(&msg).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize cancel event".to_string(),
                },
            }),
        )
    })?;

    admin_state.nats.publish("admin.order.canceled".to_string(), payload.into()).await
        .ok();

    // Also publish to Redis
    let redis_payload = serde_json::json!({
        "type": "admin.order.canceled",
        "payload": cancel_event,
    });
    if let Ok(mut conn) = admin_state.redis.get().await {
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("admin:orders")
            .arg(redis_payload.to_string())
            .query_async(&mut conn)
            .await;
    }

    info!("Admin force cancelled order: order_id={}, admin_id={}", order_id, claims.sub);
    Ok(StatusCode::OK)
}

// Positions and audit functions moved to separate modules

// ============================================================================
// ROUTER
// ============================================================================

pub fn create_admin_trading_router(
    pool: PgPool,
    admin_state: AdminTradingState,
) -> Router<PgPool> {
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

