use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    Extension,
};
use chrono::Utc;
use contracts::VersionedMessage;
use redis::AsyncCommands;
use redis_model::keys::Keys;
use redis_model::models::BalanceModel;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::str::FromStr;
use tracing::{error, info};
use uuid::Uuid;

use crate::AppState;
use crate::auth::Claims;

// ============================================================================
// CREATE DEPOSIT REQUEST
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateDepositRequest {
    pub amount: f64, // Frontend sends f64
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDepositRequestResponse {
    pub request_id: String,
    pub status: String,
    pub message: Option<String>,
}

pub async fn create_deposit_request(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateDepositRequest>,
) -> Result<Json<CreateDepositRequestResponse>, StatusCode> {
    let user_id = claims.sub;

    // Convert f64 to Decimal
    let amount = Decimal::from_str(&req.amount.to_string())
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    // Validate amount
    if amount < Decimal::from(10) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if amount > Decimal::from(1_000_000) {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Validate decimal places (max 2)
    let amount_str = amount.to_string();
    if amount_str.contains('.') {
        let parts: Vec<&str> = amount_str.split('.').collect();
        if parts.len() == 2 && parts[1].len() > 2 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let request_id = Uuid::new_v4();
    let now = Utc::now();

    // Insert into database
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
    .execute(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to create deposit request: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Publish WebSocket event
    let event = serde_json::json!({
        "requestId": request_id.to_string(),
        "userId": user_id.to_string(),
        "amount": req.amount,
        "currency": "USD",
        "note": req.note,
        "createdAt": now.to_rfc3339(),
    });

    let msg = VersionedMessage::new("deposit.request.created", &event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.nats.publish("deposit.request.created".to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Create notification for admin (find admin users)
    let admin_rows = sqlx::query(
        r#"
        SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL LIMIT 10
        "#,
    )
    .fetch_all(&state.db)
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
            .execute(&state.db)
            .await
            .ok();

            // Publish notification event for admin
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

            let notif_msg = VersionedMessage::new("notification.push", &notification_event)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let notif_payload = serde_json::to_vec(&notif_msg)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            state.nats.publish("notification.push".to_string(), notif_payload.into()).await
                .ok();
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

pub async fn get_wallet_balance(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<WalletBalanceResponse>, StatusCode> {
    let user_id = claims.sub;

    // Try to get from Redis first (hot state)
    let mut conn = state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let balance_key = Keys::balance(user_id, "USD");
    let balance_data: std::collections::HashMap<String, String> = conn.hgetall(&balance_key).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !balance_data.is_empty() {
        // Parse from Redis
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

    // Fallback to database
    let row = sqlx::query(
        r#"
        SELECT available, locked, equity, margin_used, free_margin, updated_at
        FROM balances
        WHERE user_id = $1 AND currency = $2
        "#,
    )
    .bind(user_id)
    .bind("USD")
    .fetch_optional(&state.db)
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
        // Return default balance if not found
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

// Frontend expects array, not paginated response
pub async fn list_deposits(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<ListDepositsQuery>,
) -> Result<Json<Vec<DepositRequestResponse>>, StatusCode> {
    // Check if user is admin
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
    .fetch_all(&state.db)
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

pub async fn approve_deposit(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(request_id): Path<Uuid>,
) -> Result<Json<ApproveDepositResponse>, StatusCode> {
    // Check if user is admin
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let admin_id = claims.sub;

    // Get deposit request
    let row = sqlx::query(
        r#"
        SELECT user_id, amount::text, status
        FROM deposit_requests
        WHERE id = $1
        "#,
    )
    .bind(request_id)
    .fetch_optional(&state.db)
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

    // Update deposit request status
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
    .execute(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to update deposit request: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Update balance in Redis (hot state)
    let mut conn = state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let balance_key = Keys::balance(user_id, "USD");
    let balance_data: std::collections::HashMap<String, String> = conn.hgetall(&balance_key).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Helper function to get balance from Redis
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
        // Parse from Redis HashMap
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

    // Add deposit amount to balance
    balance.available += amount;
    balance.equity += amount;
    balance.free_margin += amount;
    balance.updated_at = now.timestamp_millis();

    // Save back to Redis
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

    // Update balance in database
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
    .execute(&state.db)
    .await
    .ok(); // Don't fail if DB update fails

    // Publish deposit.request.approved event
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

    state.nats.publish("deposit.request.approved".to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Publish wallet.balance.updated event
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

    let balance_msg = VersionedMessage::new("wallet.balance.updated", &balance_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let balance_payload = serde_json::to_vec(&balance_msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.nats.publish("wallet.balance.updated".to_string(), balance_payload.into()).await
        .ok(); // Don't fail if publish fails

    // Create notification for user
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
    .execute(&state.db)
    .await
    .ok();

    // Publish notification event
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

    let notif_msg = VersionedMessage::new("notification.push", &notification_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let notif_payload = serde_json::to_vec(&notif_msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    state.nats.publish("notification.push".to_string(), notif_payload.into()).await
        .ok();

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
    pub unread_count: i64, // Will be serialized as unreadCount due to rename_all
}

pub async fn get_notifications(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<ListNotificationsResponse>, StatusCode> {
    let user_id = claims.sub;

    let rows = sqlx::query(
        r#"
        SELECT id, kind, title, message, read, created_at, meta
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| {
        error!("Failed to fetch notifications: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

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
