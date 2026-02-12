use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
    Extension,
};
use chrono::Utc;
use contracts::VersionedMessage;
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::str::FromStr;
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;

#[derive(Clone)]
pub struct WithdrawalsState {
    pub redis: Arc<redis::Client>,
    pub nats: Arc<async_nats::Client>,
}

// ============================================================================
// CREATE WITHDRAWAL REQUEST
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateWithdrawalRequest {
    pub amount: f64,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWithdrawalRequestResponse {
    pub request_id: String,
    pub status: String,
    pub message: Option<String>,
}

async fn create_withdrawal_request(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(withdrawals_state): Extension<WithdrawalsState>,
    Json(req): Json<CreateWithdrawalRequest>,
) -> Result<Json<CreateWithdrawalRequestResponse>, StatusCode> {
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

    // Check user's available balance
    let wallet_result = sqlx::query(
        r#"
        SELECT available_balance FROM wallets
        WHERE user_id = $1 AND currency = $2 AND wallet_type = 'spot'::wallet_type
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .bind("USD")
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to check wallet balance for user {}: {:?}", user_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let available_balance = if let Some(row) = wallet_result {
        row.try_get::<Decimal, _>(0).unwrap_or(Decimal::ZERO)
    } else {
        Decimal::ZERO
    };

    if amount > available_balance {
        return Err(StatusCode::BAD_REQUEST);
    }

    let transaction_id = Uuid::new_v4();
    let now = Utc::now();
    let reference = format!("WDR-{}", transaction_id.to_string().replace("-", "").chars().take(12).collect::<String>());

    // Create transaction record for withdrawal
    sqlx::query(
        r#"
        INSERT INTO transactions (id, user_id, type, amount, currency, fee, net_amount, method, status, reference, created_at, updated_at)
        VALUES ($1, $2, $3::transaction_type, $4, $5, $6, $7, $8::transaction_method, $9::transaction_status, $10, $11, $12)
        "#,
    )
    .bind(transaction_id)
    .bind(user_id)
    .bind("withdrawal")
    .bind(amount)
    .bind("USD")
    .bind(Decimal::ZERO) // No fee for manual withdrawals initially
    .bind(amount) // net_amount = amount (no fees)
    .bind("manual")
    .bind("pending")
    .bind(&reference)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to create withdrawal transaction for user {}: {:?}", user_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    info!("Created withdrawal transaction: transaction_id={}, user_id={}, amount={}", 
          transaction_id, user_id, amount);

    let event = serde_json::json!({
        "requestId": transaction_id.to_string(),
        "userId": user_id.to_string(),
        "amount": req.amount,
        "currency": "USD",
        "note": req.note,
        "createdAt": now.to_rfc3339(),
    });

    // Publish to NATS (for other services)
    let msg = VersionedMessage::new("withdrawal.request.created", &event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    withdrawals_state.nats.publish("withdrawal.request.created".to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Also publish to Redis for WebSocket gateway
    let mut redis_conn = withdrawals_state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: Result<(), _> = redis_conn.publish("withdrawals:requests", serde_json::to_string(&event).unwrap_or_default()).await;

    Ok(Json(CreateWithdrawalRequestResponse {
        request_id: transaction_id.to_string(),
        status: "PENDING".to_string(),
        message: Some("Withdrawal request created successfully".to_string()),
    }))
}

pub fn create_withdrawals_router(
    pool: PgPool,
    redis: Arc<redis::Client>,
    nats: Arc<async_nats::Client>,
) -> Router<PgPool> {
    let withdrawals_state = WithdrawalsState {
        redis,
        nats,
    };

    Router::new()
        .route("/request", post(create_withdrawal_request))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(Extension(withdrawals_state))
        .with_state(pool)
}

