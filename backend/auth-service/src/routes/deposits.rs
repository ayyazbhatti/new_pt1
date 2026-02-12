use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, put},
    Router,
    Extension,
};
use chrono::Utc;
use contracts::VersionedMessage;
use redis::AsyncCommands;
use redis_model::keys::Keys;
use redis_model::models::BalanceModel;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;

#[derive(Clone)]
pub struct DepositsState {
    pub redis: Arc<redis::Client>,
    pub nats: Arc<async_nats::Client>,
}

// ============================================================================
// CREATE DEPOSIT REQUEST
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateDepositRequest {
    pub amount: f64,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDepositRequestResponse {
    pub request_id: String,
    pub status: String,
    pub message: Option<String>,
}

async fn create_deposit_request(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(deposits_state): Extension<DepositsState>,
    Json(req): Json<CreateDepositRequest>,
) -> Result<Json<CreateDepositRequestResponse>, StatusCode> {
    let user_id = claims.sub;

    let amount = Decimal::from_str(&req.amount.to_string())
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    if amount < Decimal::from(10) || amount > Decimal::from(1_000_000) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let amount_str = amount.to_string();
    if amount_str.contains('.') {
        let parts: Vec<&str> = amount_str.split('.').collect();
        if parts.len() == 2 && parts[1].len() > 2 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let request_id = Uuid::new_v4();
    let now = Utc::now();

    sqlx::query(
        r#"
        INSERT INTO deposit_requests (id, user_id, amount, currency, note, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(request_id)
    .bind(user_id)
    .bind(amount)
    .bind("USD")
    .bind(&req.note)
    .bind("PENDING")
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to create deposit request: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let event = serde_json::json!({
        "requestId": request_id.to_string(),
        "userId": user_id.to_string(),
        "amount": req.amount,
        "currency": "USD",
        "note": req.note,
        "createdAt": now.to_rfc3339(),
    });

    // Publish to NATS (for other services)
    let msg = VersionedMessage::new("deposit.request.created", &event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    deposits_state.nats.publish("deposit.request.created".to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Also publish to Redis for WebSocket gateway
    let mut redis_conn = deposits_state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: Result<(), _> = redis_conn.publish("deposits:requests", serde_json::to_string(&event).unwrap_or_default()).await;

    let admin_rows = sqlx::query(
        r#"SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL LIMIT 10"#,
    )
    .fetch_all(&pool)
    .await
    .ok();

    if let Some(admins) = admin_rows {
        for admin_row in admins {
            let admin_id: Uuid = admin_row.get(0);
            let notification_id = Uuid::new_v4();
            
            sqlx::query(
                r#"
                INSERT INTO notifications (id, user_id, kind, title, message, read, created_at, meta)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                "#,
            )
            .bind(notification_id)
            .bind(admin_id)
            .bind("DEPOSIT_REQUEST")
            .bind("New Deposit Request")
            .bind(format!("User {} requested ${:.2}", user_id, amount))
            .bind(false)
            .bind(now)
            .bind(serde_json::json!({
                "requestId": request_id.to_string(),
                "userId": user_id.to_string(),
                "amount": req.amount,
            }))
            .execute(&pool)
            .await
            .ok();

            let notification_event = serde_json::json!({
                "id": notification_id.to_string(),
                "kind": "DEPOSIT_REQUEST",
                "title": "New Deposit Request",
                "message": format!("User {} requested ${:.2}", user_id, amount),
                "createdAt": now.to_rfc3339(),
                "read": false,
                "meta": {
                    "requestId": request_id.to_string(),
                    "userId": user_id.to_string(),
                    "amount": req.amount,
                }
            });

            // Publish to NATS (for other services)
            let notif_msg = VersionedMessage::new("notification.push", &notification_event)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let notif_payload = serde_json::to_vec(&notif_msg)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            deposits_state.nats.publish("notification.push".to_string(), notif_payload.into()).await
                .ok();

            // Also publish to Redis for WebSocket gateway
            let mut redis_conn = deposits_state.redis.get_async_connection().await.ok();
            if let Some(mut conn) = redis_conn {
                let _: Result<(), _> = conn.publish("notifications:push", serde_json::to_string(&notification_event).unwrap_or_default()).await;
            }
        }
    }

    info!("Deposit request created: request_id={}, user_id={}, amount={}", request_id, user_id, amount);

    Ok(Json(CreateDepositRequestResponse {
        request_id: request_id.to_string(),
        status: "PENDING".to_string(),
        message: None,
    }))
}

// ============================================================================
// GET WALLET BALANCE
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletBalanceResponse {
    pub user_id: String,
    pub currency: String,
    pub available: f64,
    pub locked: f64,
    pub equity: f64,
    pub margin_used: f64,
    pub free_margin: f64,
    pub updated_at: String,
}

async fn get_wallet_balance(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<WalletBalanceResponse>, StatusCode> {
    let user_id = claims.sub;

    let mut conn = deposits_state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let balance_key = Keys::balance(user_id, "USD");
    let balance_data: std::collections::HashMap<String, String> = conn.hgetall(&balance_key).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !balance_data.is_empty() {
        let available = balance_data.get("available")
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::ZERO);
        let locked = balance_data.get("locked")
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::ZERO);
        let equity = balance_data.get("equity")
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::ZERO);
        let margin_used = balance_data.get("margin_used")
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::ZERO);
        let free_margin = balance_data.get("free_margin")
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::ZERO);
        let updated_at = balance_data.get("updated_at")
            .and_then(|s| s.parse::<i64>().ok())
            .and_then(|ts| chrono::DateTime::from_timestamp_millis(ts))
            .unwrap_or_else(Utc::now);

        return Ok(Json(WalletBalanceResponse {
            user_id: user_id.to_string(),
            currency: "USD".to_string(),
            available: available.to_string().parse::<f64>().unwrap_or(0.0),
            locked: locked.to_string().parse::<f64>().unwrap_or(0.0),
            equity: equity.to_string().parse::<f64>().unwrap_or(0.0),
            margin_used: margin_used.to_string().parse::<f64>().unwrap_or(0.0),
            free_margin: free_margin.to_string().parse::<f64>().unwrap_or(0.0),
            updated_at: updated_at.to_rfc3339(),
        }));
    }

    let row = sqlx::query(
        r#"
        SELECT available, locked, equity, margin_used, free_margin, updated_at
        FROM balances
        WHERE user_id = $1 AND currency = $2
        "#,
    )
    .bind(user_id)
    .bind("USD")
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch balance: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if let Some(row) = row {
        let available: Decimal = row.get(0);
        let locked: Decimal = row.get(1);
        let equity: Decimal = row.get(2);
        let margin_used: Decimal = row.get(3);
        let free_margin: Decimal = row.get(4);
        let updated_at: chrono::DateTime<chrono::Utc> = row.get(5);

        Ok(Json(WalletBalanceResponse {
            user_id: user_id.to_string(),
            currency: "USD".to_string(),
            available: available.to_string().parse::<f64>().unwrap_or(0.0),
            locked: locked.to_string().parse::<f64>().unwrap_or(0.0),
            equity: equity.to_string().parse::<f64>().unwrap_or(0.0),
            margin_used: margin_used.to_string().parse::<f64>().unwrap_or(0.0),
            free_margin: free_margin.to_string().parse::<f64>().unwrap_or(0.0),
            updated_at: updated_at.to_rfc3339(),
        }))
    } else {
        Ok(Json(WalletBalanceResponse {
            user_id: user_id.to_string(),
            currency: "USD".to_string(),
            available: 0.0,
            locked: 0.0,
            equity: 0.0,
            margin_used: 0.0,
            free_margin: 0.0,
            updated_at: Utc::now().to_rfc3339(),
        }))
    }
}

// ============================================================================
// LIST PENDING DEPOSITS (ADMIN)
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct ListDepositsQuery {
    pub status: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositRequestResponse {
    pub request_id: String,
    pub user_id: String,
    pub amount: f64,
    pub currency: String,
    pub note: Option<String>,
    pub status: String,
    pub created_at: String,
    pub approved_at: Option<String>,
    pub admin_id: Option<String>,
}

async fn list_deposits(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ListDepositsQuery>,
) -> Result<Json<Vec<DepositRequestResponse>>, StatusCode> {
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let status = params.status.unwrap_or_else(|| "pending".to_string());

    let rows = sqlx::query(
        r#"
        SELECT id, user_id, amount::text, currency, note, status, created_at, approved_at, admin_id
        FROM deposit_requests
        WHERE status = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(&status.to_uppercase())
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch deposits: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let items: Vec<DepositRequestResponse> = rows
        .into_iter()
        .map(|row| {
            let amount_str: String = row.get(2);
            let amount = Decimal::from_str(&amount_str)
                .unwrap_or(Decimal::ZERO)
                .to_string()
                .parse::<f64>()
                .unwrap_or(0.0);

            DepositRequestResponse {
                request_id: row.get::<Uuid, _>(0).to_string(),
                user_id: row.get::<Uuid, _>(1).to_string(),
                amount,
                currency: row.get::<String, _>(3),
                note: row.get::<Option<String>, _>(4),
                status: row.get::<String, _>(5),
                created_at: row.get::<chrono::DateTime<chrono::Utc>, _>(6).to_rfc3339(),
                approved_at: row.get::<Option<chrono::DateTime<chrono::Utc>>, _>(7)
                    .map(|dt| dt.to_rfc3339()),
                admin_id: row.get::<Option<Uuid>, _>(8)
                    .map(|id| id.to_string()),
            }
        })
        .collect();

    Ok(Json(items))
}

// ============================================================================
// APPROVE DEPOSIT (ADMIN)
// ============================================================================

#[derive(Debug, Serialize)]
pub struct ApproveDepositResponse {
    pub status: String,
    pub message: String,
}

async fn approve_deposit(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
    Path(request_id): Path<Uuid>,
) -> Result<Json<ApproveDepositResponse>, StatusCode> {
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let admin_id = claims.sub;

    let row = sqlx::query(
        r#"
        SELECT user_id, amount::text, status
        FROM deposit_requests
        WHERE id = $1
        "#,
    )
    .bind(request_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch deposit request: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let (user_id, amount_str, current_status) = match row {
        Some(row) => (
            row.get::<Uuid, _>(0),
            row.get::<String, _>(1),
            row.get::<String, _>(2),
        ),
        None => return Err(StatusCode::NOT_FOUND),
    };

    if current_status != "PENDING" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let amount = Decimal::from_str(&amount_str)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let now = Utc::now();

    sqlx::query(
        r#"
        UPDATE deposit_requests
        SET status = $1, admin_id = $2, approved_at = $3, updated_at = $4
        WHERE id = $5
        "#,
    )
    .bind("APPROVED")
    .bind(admin_id)
    .bind(now)
    .bind(now)
    .bind(request_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to update deposit request: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut conn = deposits_state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let balance_key = Keys::balance(user_id, "USD");
    let balance_data: std::collections::HashMap<String, String> = conn.hgetall(&balance_key).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut balance = if balance_data.is_empty() {
        BalanceModel {
            available: Decimal::ZERO,
            locked: Decimal::ZERO,
            equity: Decimal::ZERO,
            margin_used: Decimal::ZERO,
            free_margin: Decimal::ZERO,
            updated_at: now.timestamp_millis(),
        }
    } else {
        BalanceModel {
            available: balance_data.get("available")
                .and_then(|s| Decimal::from_str(s).ok())
                .unwrap_or(Decimal::ZERO),
            locked: balance_data.get("locked")
                .and_then(|s| Decimal::from_str(s).ok())
                .unwrap_or(Decimal::ZERO),
            equity: balance_data.get("equity")
                .and_then(|s| Decimal::from_str(s).ok())
                .unwrap_or(Decimal::ZERO),
            margin_used: balance_data.get("margin_used")
                .and_then(|s| Decimal::from_str(s).ok())
                .unwrap_or(Decimal::ZERO),
            free_margin: balance_data.get("free_margin")
                .and_then(|s| Decimal::from_str(s).ok())
                .unwrap_or(Decimal::ZERO),
            updated_at: balance_data.get("updated_at")
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(now.timestamp_millis()),
        }
    };

    balance.available += amount;
    balance.equity += amount;
    balance.free_margin += amount;
    balance.updated_at = now.timestamp_millis();

    let _: () = conn.hset(&balance_key, "available", balance.available.to_string()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: () = conn.hset(&balance_key, "locked", balance.locked.to_string()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: () = conn.hset(&balance_key, "equity", balance.equity.to_string()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: () = conn.hset(&balance_key, "margin_used", balance.margin_used.to_string()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: () = conn.hset(&balance_key, "free_margin", balance.free_margin.to_string()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: () = conn.hset(&balance_key, "updated_at", balance.updated_at.to_string()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query(
        r#"
        INSERT INTO balances (user_id, currency, available, locked, equity, margin_used, free_margin, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, currency) DO UPDATE SET
            available = EXCLUDED.available,
            equity = EXCLUDED.equity,
            free_margin = EXCLUDED.free_margin,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(user_id)
    .bind("USD")
    .bind(balance.available)
    .bind(balance.locked)
    .bind(balance.equity)
    .bind(balance.margin_used)
    .bind(balance.free_margin)
    .bind(now)
    .execute(&pool)
    .await
    .ok();

    let approved_event = serde_json::json!({
        "requestId": request_id.to_string(),
        "userId": user_id.to_string(),
        "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
        "currency": "USD",
        "approvedAt": now.to_rfc3339(),
        "newBalance": balance.equity.to_string().parse::<f64>().unwrap_or(0.0),
        "adminId": admin_id.to_string(),
    });

    let msg = VersionedMessage::new("deposit.request.approved", &approved_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    deposits_state.nats.publish("deposit.request.approved".to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Also publish to Redis for WebSocket gateway
    let mut redis_conn = deposits_state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: Result<(), _> = redis_conn.publish("deposits:approved", serde_json::to_string(&approved_event).unwrap_or_default()).await;

    let balance_event = serde_json::json!({
        "userId": user_id.to_string(),
        "currency": "USD",
        "available": balance.available.to_string().parse::<f64>().unwrap_or(0.0),
        "locked": balance.locked.to_string().parse::<f64>().unwrap_or(0.0),
        "equity": balance.equity.to_string().parse::<f64>().unwrap_or(0.0),
        "marginUsed": balance.margin_used.to_string().parse::<f64>().unwrap_or(0.0),
        "freeMargin": balance.free_margin.to_string().parse::<f64>().unwrap_or(0.0),
        "updatedAt": now.to_rfc3339(),
    });

    // Publish to NATS
    let balance_msg = VersionedMessage::new("wallet.balance.updated", &balance_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let balance_payload = serde_json::to_vec(&balance_msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    deposits_state.nats.publish("wallet.balance.updated".to_string(), balance_payload.into()).await
        .ok();

    // Also publish to Redis for WebSocket gateway
    let mut redis_conn = deposits_state.redis.get_async_connection().await.ok();
    if let Some(mut conn) = redis_conn {
        let _: Result<(), _> = conn.publish("wallet:balance:updated", serde_json::to_string(&balance_event).unwrap_or_default()).await;
    }

    let notification_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO notifications (id, user_id, kind, title, message, read, created_at, meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .bind("DEPOSIT_APPROVED")
    .bind("Deposit Approved")
    .bind(format!("Your deposit of ${:.2} has been approved. New balance: ${:.2}", amount, balance.equity))
    .bind(false)
    .bind(now)
    .bind(serde_json::json!({
        "requestId": request_id.to_string(),
        "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
    }))
    .execute(&pool)
    .await
    .ok();

    let notification_event = serde_json::json!({
        "id": notification_id.to_string(),
        "kind": "DEPOSIT_APPROVED",
        "title": "Deposit Approved",
        "message": format!("Your deposit of ${:.2} has been approved. New balance: ${:.2}", amount, balance.equity),
        "createdAt": now.to_rfc3339(),
        "read": false,
        "meta": {
            "requestId": request_id.to_string(),
            "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
        }
    });

    // Publish to NATS
    let notif_msg = VersionedMessage::new("notification.push", &notification_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let notif_payload = serde_json::to_vec(&notif_msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    deposits_state.nats.publish("notification.push".to_string(), notif_payload.into()).await
        .ok();

    // Also publish to Redis for WebSocket gateway
    let mut redis_conn = deposits_state.redis.get_async_connection().await.ok();
    if let Some(mut conn) = redis_conn {
        let _: Result<(), _> = conn.publish("notifications:push", serde_json::to_string(&notification_event).unwrap_or_default()).await;
    }

    info!("Deposit approved: request_id={}, user_id={}, amount={}, new_balance={}", 
          request_id, user_id, amount, balance.equity);

    Ok(Json(ApproveDepositResponse {
        status: "approved".to_string(),
        message: format!("Deposit request approved. New balance: ${:.2}", balance.equity),
    }))
}

// ============================================================================
// GET NOTIFICATIONS
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationResponse {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub message: String,
    pub created_at: String,
    pub read: bool,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotificationsResponse {
    pub items: Vec<NotificationResponse>,
    pub unread_count: i64,
}

async fn get_notifications(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<ListNotificationsResponse>, StatusCode> {
    let user_id = claims.sub;

    let rows = match sqlx::query(
        r#"
        SELECT id, kind, title, message, read, created_at, meta
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            // If table doesn't exist, return empty list instead of error
            if e.to_string().contains("does not exist") {
                warn!("Notifications table does not exist yet, returning empty list");
                vec![]
            } else {
                error!("Failed to fetch notifications: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    };

    let items: Vec<NotificationResponse> = rows
        .iter()
        .map(|row| {
            NotificationResponse {
                id: row.get::<Uuid, _>(0).to_string(),
                kind: row.get::<String, _>(1),
                title: row.get::<String, _>(2),
                message: row.get::<String, _>(3),
                read: row.get::<bool, _>(4),
                created_at: row.get::<chrono::DateTime<chrono::Utc>, _>(5).to_rfc3339(),
                meta: row.get::<Option<serde_json::Value>, _>(6),
            }
        })
        .collect();

    let unread_count = items.iter().filter(|n| !n.read).count() as i64;

    Ok(Json(ListNotificationsResponse {
        items,
        unread_count,
    }))
}

// ============================================================================
// GET USER POSITIONS
// ============================================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionsResponse {
    pub positions: Vec<serde_json::Value>,
}

async fn get_user_positions(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(deposits_state): Extension<DepositsState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<PositionsResponse>, StatusCode> {
    // Users can only see their own positions, admins can see any
    // Allow if user is requesting their own positions OR if user is admin
    let is_own_positions = claims.sub == user_id;
    let is_admin = claims.role == "admin";
    
    if !is_own_positions && !is_admin {
        error!("Forbidden: user_id={}, claims.sub={}, claims.role={}", user_id, claims.sub, claims.role);
        return Err(StatusCode::FORBIDDEN);
    }

    let mut conn = deposits_state.redis.get_async_connection().await
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
                let mut pos_json = serde_json::Map::new();
                pos_json.insert("id".to_string(), serde_json::Value::String(pos_id_str));
                
                for (k, v) in pos_data {
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

// ============================================================================
// ROUTER CREATION
// ============================================================================

pub fn create_deposits_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/request", post(create_deposit_request))
        .route("/", get(list_deposits))
        .route("/:id/approve", post(approve_deposit))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(move |mut req: axum::extract::Request, next: axum::middleware::Next| {
            let state = deposits_state.clone();
            async move {
                req.extensions_mut().insert(state);
                next.run(req).await
            }
        }))
        .with_state(pool)
}

pub fn create_wallet_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/balance", get(get_wallet_balance))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(move |mut req: axum::extract::Request, next: axum::middleware::Next| {
            let state = deposits_state.clone();
            async move {
                req.extensions_mut().insert(state);
                next.run(req).await
            }
        }))
        .with_state(pool)
}

pub fn create_notifications_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/", get(get_notifications))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(move |mut req: axum::extract::Request, next: axum::middleware::Next| {
            let state = deposits_state.clone();
            async move {
                req.extensions_mut().insert(state);
                next.run(req).await
            }
        }))
        .with_state(pool)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePositionSltpRequest {
    pub stop_loss: Option<String>,
    pub take_profit: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePositionSltpResponse {
    pub success: bool,
    pub message: String,
}

async fn update_position_sltp(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(deposits_state): Extension<DepositsState>,
    Path((user_id, position_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdatePositionSltpRequest>,
) -> Result<Json<UpdatePositionSltpResponse>, StatusCode> {
    // Users can only update their own positions, admins can update any
    let is_own_position = claims.sub == user_id;
    let is_admin = claims.role == "admin";
    
    if !is_own_position && !is_admin {
        error!("Forbidden: user_id={}, claims.sub={}, claims.role={}", user_id, claims.sub, claims.role);
        return Err(StatusCode::FORBIDDEN);
    }

    let mut conn = deposits_state.redis.get_async_connection().await
        .map_err(|e| {
            error!("Failed to get Redis connection: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Verify position exists and belongs to user
    let pos_key = Keys::position_by_id(position_id);
    let pos_user_id: Option<String> = conn.hget(&pos_key, "user_id").await
        .map_err(|e| {
            error!("Failed to get position user_id: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if let Some(pos_user_id_str) = pos_user_id {
        if let Ok(pos_user_id_uuid) = Uuid::parse_str(&pos_user_id_str) {
            if pos_user_id_uuid != user_id && !is_admin {
                error!("Position {} does not belong to user {}", position_id, user_id);
                return Err(StatusCode::FORBIDDEN);
            }
        } else {
            error!("Invalid user_id in position {}", position_id);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    } else {
        error!("Position {} not found", position_id);
        return Err(StatusCode::NOT_FOUND);
    }

    // Update SL/TP in Redis
    if let Some(sl) = &req.stop_loss {
        if sl.is_empty() || sl == "null" {
            let _: () = conn.hset(&pos_key, "sl", "null").await
                .map_err(|e| {
                    error!("Failed to update SL: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        } else {
            let _: () = conn.hset(&pos_key, "sl", sl).await
                .map_err(|e| {
                    error!("Failed to update SL: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        }
    }

    if let Some(tp) = &req.take_profit {
        if tp.is_empty() || tp == "null" {
            let _: () = conn.hset(&pos_key, "tp", "null").await
                .map_err(|e| {
                    error!("Failed to update TP: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        } else {
            let _: () = conn.hset(&pos_key, "tp", tp).await
                .map_err(|e| {
                    error!("Failed to update TP: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        }
    }

    // Update updated_at timestamp
    let now = chrono::Utc::now().timestamp_millis();
    let _: () = conn.hset(&pos_key, "updated_at", now.to_string()).await
        .map_err(|e| {
            error!("Failed to update timestamp: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    info!("Updated position {} SL/TP: sl={:?}, tp={:?}", position_id, req.stop_loss, req.take_profit);
    Ok(Json(UpdatePositionSltpResponse {
        success: true,
        message: "Position SL/TP updated successfully".to_string(),
    }))
}

pub fn create_positions_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/:user_id/positions/:position_id/sltp", put(update_position_sltp)) // More specific route first
        .route("/:user_id/positions", get(get_user_positions))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(move |mut req: axum::extract::Request, next: axum::middleware::Next| {
            let state = deposits_state.clone();
            async move {
                req.extensions_mut().insert(state);
                next.run(req).await
            }
        }))
        .with_state(pool)
}

