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
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Instant;
use tracing::{error, info, warn};
use uuid::Uuid;
use dashmap::DashMap;
use tokio::sync::Mutex;

/// (symbol, group_id) -> (bid, ask). Used for tick-driven account summary so unrealized PnL uses live price.
pub type PriceOverrides = HashMap<(String, String), (Decimal, Decimal)>;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;
use crate::services::ledger_service;

#[derive(Clone)]
pub struct DepositsState {
    pub redis: Arc<redis::Client>,
    pub nats: Arc<async_nats::Client>,
}

/// NATS client for stop-out close_all publish. Set once from main so compute_and_cache_account_summary_with_prices can publish without threading through all callers.
static STOP_OUT_NATS: OnceLock<Arc<async_nats::Client>> = OnceLock::new();

/// Register NATS client for stop-out. Call from main after connecting to NATS.
pub fn register_stop_out_nats(client: Arc<async_nats::Client>) {
    let _ = STOP_OUT_NATS.set(client);
}

/// If margin_level < stop_out_threshold, set cooldown key and publish cmd.position.close_all. Called from compute_and_cache_account_summary_with_prices.
async fn try_publish_stop_out_close_all(
    redis: &redis::Client,
    user_id: Uuid,
    margin_level: &str,
    stop_out_threshold: Option<f64>,
) {
    let Some(threshold) = stop_out_threshold else { return };
    let margin_value = match margin_level.parse::<f64>() {
        Ok(v) if v.is_finite() => v,
        _ => return, // "inf" or invalid => no stop out
    };
    if margin_value >= threshold {
        return;
    }
    let cooldown_key = format!("pos:stop_out:triggered:{}", user_id);
    let mut conn = match redis.get_async_connection().await {
        Ok(c) => c,
        Err(e) => {
            error!("Stop out: Redis connection failed for cooldown: {}", e);
            return;
        }
    };
    // SET key 1 EX 60 NX — only proceed if we set the key (first trigger in 60s)
    let set_ok: Result<bool, _> = redis::cmd("SET")
        .arg(&cooldown_key)
        .arg("1")
        .arg("EX")
        .arg(60_u64)
        .arg("NX")
        .query_async(&mut conn)
        .await;
    if set_ok.ok() != Some(true) {
        return; // Cooldown active or error
    }
    let Some(nats) = STOP_OUT_NATS.get() else {
        return;
    };
    let payload = serde_json::json!({
        "user_id": user_id.to_string(),
        "correlation_id": Uuid::new_v4().to_string(),
        "ts": Utc::now().to_rfc3339(),
    });
    if let Err(e) = nats.publish("cmd.position.close_all".to_string(), payload.to_string().into()).await {
        error!("Stop out: failed to publish cmd.position.close_all for user {}: {}", user_id, e);
    } else {
        info!("Stop out: published cmd.position.close_all for user {} (margin_level={} < threshold={})", user_id, margin_value, threshold);
    }
}

// ============================================================================
// ACCOUNT SUMMARY COORDINATOR (per-user serialization + publish throttle)
// ============================================================================
/// Ensures only one account summary computation runs per user at a time and
/// throttles WebSocket publishes to avoid UI flicker from rapid updates.
pub struct AccountSummaryCoordinator {
    user_locks: DashMap<Uuid, Arc<Mutex<()>>>,
    last_publish: DashMap<Uuid, Instant>,
}

const PUBLISH_THROTTLE_MS: u64 = 250;

impl AccountSummaryCoordinator {
    pub fn new() -> Self {
        Self {
            user_locks: DashMap::new(),
            last_publish: DashMap::new(),
        }
    }

    /// Run a future with exclusive compute right for this user (one at a time per user).
    pub async fn run_exclusive<Fut>(&self, user_id: Uuid, fut: Fut)
    where
        Fut: std::future::Future<Output = ()> + Send,
    {
        let mutex = self
            .user_locks
            .entry(user_id)
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _guard = mutex.lock().await;
        fut.await
    }

    pub fn should_publish(&self, user_id: Uuid) -> bool {
        let now = Instant::now();
        match self.last_publish.get(&user_id) {
            Some(t) => now.duration_since(*t).as_millis() >= PUBLISH_THROTTLE_MS as u128,
            None => true,
        }
    }

    pub fn record_publish(&self, user_id: Uuid) {
        self.last_publish.insert(user_id, Instant::now());
    }
}

static COORDINATOR: std::sync::OnceLock<Arc<AccountSummaryCoordinator>> = std::sync::OnceLock::new();

/// Call once at startup (e.g. from main) so account summary uses per-user serialization and throttle.
pub fn init_account_summary_coordinator() {
    COORDINATOR.get_or_init(|| Arc::new(AccountSummaryCoordinator::new()));
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

    let transaction_id = Uuid::new_v4();
    let now = Utc::now();
    let reference = format!("DEP-{}", transaction_id.to_string().replace("-", "").chars().take(12).collect::<String>());
    
    // Create transaction record directly (no deposit_requests table needed)
    sqlx::query(
        r#"
        INSERT INTO transactions (id, user_id, type, amount, currency, fee, net_amount, method, status, reference, method_details, created_at, updated_at)
        VALUES ($1, $2, $3::transaction_type, $4, $5, $6, $7, $8::transaction_method, $9::transaction_status, $10, $11, $12, $13)
        "#,
    )
    .bind(transaction_id)
    .bind(user_id)
    .bind("deposit")
    .bind(amount)
    .bind("USD")
    .bind(Decimal::ZERO) // No fee for manual deposits
    .bind(amount) // net_amount = amount (no fees)
    .bind("manual")
    .bind("pending")
    .bind(&reference)
    .bind(serde_json::json!({ "note": req.note })) // Store note in method_details
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to create transaction for deposit: {:?}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    info!("Created deposit transaction: transaction_id={}, user_id={}, amount={}", 
          transaction_id, user_id, amount);

    let event = serde_json::json!({
        "transactionId": transaction_id.to_string(),
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
                "transactionId": transaction_id.to_string(),
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
                    "transactionId": transaction_id.to_string(),
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

    info!("Deposit transaction created: transaction_id={}, user_id={}, amount={}", transaction_id, user_id, amount);

    Ok(Json(CreateDepositRequestResponse {
        request_id: transaction_id.to_string(), // Return transaction_id as request_id for compatibility
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

// Helper function to calculate wallet balance (reusable)
pub async fn calculate_wallet_balance(pool: &PgPool, user_id: Uuid) -> anyhow::Result<WalletBalanceResponse> {
    // Calculate balance using formula: Balance = deposits - withdrawals + total realised net profit and loss
    
    // 1. Calculate total deposits (completed deposits only)
    let total_deposits: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT COALESCE(SUM(net_amount), 0)
        FROM transactions
        WHERE user_id = $1 
          AND type = 'deposit'::transaction_type
          AND status = 'completed'::transaction_status
          AND currency = 'USD'
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let deposits = total_deposits.unwrap_or(Decimal::ZERO);

    // 2. Calculate total withdrawals (completed withdrawals only)
    let total_withdrawals: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT COALESCE(SUM(net_amount), 0)
        FROM transactions
        WHERE user_id = $1 
          AND type = 'withdrawal'::transaction_type
          AND status = 'completed'::transaction_status
          AND currency = 'USD'
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let withdrawals = total_withdrawals.unwrap_or(Decimal::ZERO);

    // 3. Calculate total realized PnL (from closed positions)
    let total_realized_pnl: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT COALESCE(SUM(pnl), 0)
        FROM positions
        WHERE user_id = $1 
          AND status = 'closed'::position_status
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let realized_pnl = total_realized_pnl.unwrap_or(Decimal::ZERO);

    // 4. Calculate balance: deposits - withdrawals + realized_pnl
    let balance = deposits - withdrawals + realized_pnl;

    // 5. Calculate unrealized PnL (from open positions)
    let total_unrealized_pnl: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT COALESCE(SUM(pnl), 0)
        FROM positions
        WHERE user_id = $1 
          AND status = 'open'::position_status
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let unrealized_pnl = total_unrealized_pnl.unwrap_or(Decimal::ZERO);

    // 6. Calculate margin used (from open positions)
    let total_margin_used: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT COALESCE(SUM(margin_used), 0)
        FROM positions
        WHERE user_id = $1 
          AND status = 'open'::position_status
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let margin_used = total_margin_used.unwrap_or(Decimal::ZERO);

    // 7. Calculate equity = balance + unrealized_pnl
    let equity = balance + unrealized_pnl;

    // 8. Calculate available balance = balance - margin_used (locked in positions)
    let available = if balance >= margin_used {
        balance - margin_used
    } else {
        Decimal::ZERO
    };

    // 9. Calculate free margin = available balance
    let free_margin = available;

    // 10. Locked = margin_used
    let locked = margin_used;

    Ok(WalletBalanceResponse {
        user_id: user_id.to_string(),
        currency: "USD".to_string(),
        available: available.to_string().parse::<f64>().unwrap_or(0.0),
        locked: locked.to_string().parse::<f64>().unwrap_or(0.0),
        equity: equity.to_string().parse::<f64>().unwrap_or(0.0),
        margin_used: margin_used.to_string().parse::<f64>().unwrap_or(0.0),
        free_margin: free_margin.to_string().parse::<f64>().unwrap_or(0.0),
        updated_at: Utc::now().to_rfc3339(),
    })
}

// ============================================================================
// ACCOUNT SUMMARY (for BottomDock real-time display)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub user_id: String,
    pub balance: f64,
    pub equity: f64,
    pub margin_used: f64,
    pub free_margin: f64,
    /// Margin level as percentage string, or "inf" when margin_used = 0
    pub margin_level: String,
    /// Margin call threshold % for this user's group. None = use platform default (e.g. 50).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin_call_level_threshold: Option<f64>,
    /// Stop out threshold % for this user's group. When margin level falls below this, all positions are closed. None = no automatic stop out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_out_level_threshold: Option<f64>,
    pub realized_pnl: f64,
    pub unrealized_pnl: f64,
    pub updated_at: String,
}

/// Returns the user's group_id from DB. Used when we have user_id but no JWT (e.g. background summary).
async fn get_user_group_id(pool: &PgPool, user_id: Uuid) -> Option<Uuid> {
    let row: Option<Option<Uuid>> = sqlx::query_scalar(
        "SELECT group_id FROM users WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()?;
    row.flatten()
}

/// Margin call level threshold for a group (%). Redis-first, then DB; on DB hit we cache in Redis.
pub(crate) async fn get_margin_call_level_for_group(
    redis: &redis::Client,
    pool: &PgPool,
    group_id: Uuid,
) -> Option<f64> {
    let key = redis_model::keys::Keys::group(group_id);
    if let Ok(mut conn) = redis.get_async_connection().await {
        if let Ok(Some(s)) = conn.hget::<_, _, Option<String>>(&key, "margin_call_level").await {
            if let Ok(v) = s.parse::<f64>() {
                return Some(v);
            }
        }
    }
    let row: Option<(Option<rust_decimal::Decimal>,)> = sqlx::query_as(
        "SELECT margin_call_level FROM user_groups WHERE id = $1",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await
    .ok()?;
    let value = row.and_then(|(v,)| v).and_then(|d| d.to_string().parse::<f64>().ok())?;
    if let Ok(mut conn) = redis.get_async_connection().await {
        let _: Result<(), _> = conn.hset(&key, "margin_call_level", value.to_string()).await;
    }
    Some(value)
}

/// Stop out level threshold for a group (%). Redis-first, then DB; on DB hit we cache in Redis.
pub(crate) async fn get_stop_out_level_for_group(
    redis: &redis::Client,
    pool: &PgPool,
    group_id: Uuid,
) -> Option<f64> {
    let key = redis_model::keys::Keys::group(group_id);
    if let Ok(mut conn) = redis.get_async_connection().await {
        if let Ok(Some(s)) = conn.hget::<_, _, Option<String>>(&key, "stop_out_level").await {
            if let Ok(v) = s.parse::<f64>() {
                return Some(v);
            }
        }
    }
    let row: Option<(Option<rust_decimal::Decimal>,)> = sqlx::query_as(
        "SELECT stop_out_level FROM user_groups WHERE id = $1",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await
    .ok()?;
    let value = row.and_then(|(v,)| v).and_then(|d| d.to_string().parse::<f64>().ok())?;
    if let Ok(mut conn) = redis.get_async_connection().await {
        let _: Result<(), _> = conn.hset(&key, "stop_out_level", value.to_string()).await;
    }
    Some(value)
}

/// Read current (bid, ask) from Redis key prices:SYMBOL:GROUP_ID (written by order-engine on each tick).
/// Returns None if key missing or parse error.
pub(crate) async fn get_price_from_redis(
    redis: &redis::Client,
    symbol: &str,
    group_id: &str,
) -> Option<(Decimal, Decimal)> {
    let key = format!("prices:{}:{}", symbol, group_id);
    let mut conn = redis.get_async_connection().await.ok()?;
    let json_str: String = conn.get(&key).await.ok()?;
    let val: serde_json::Value = serde_json::from_str(&json_str).ok()?;
    let bid_s = val.get("bid").and_then(|v| v.as_str())?;
    let ask_s = val.get("ask").and_then(|v| v.as_str())?;
    let bid = Decimal::from_str(bid_s).ok()?;
    let ask = Decimal::from_str(ask_s).ok()?;
    if bid <= Decimal::ZERO || ask <= Decimal::ZERO {
        return None;
    }
    Some((bid, ask))
}

/// Fetches position-derived aggregates from Redis (same source as Positions tab).
/// Returns (margin_used, unrealized_pnl, realized_pnl). Uses "margin" and "status" from pos:by_id:* hashes.
/// When `price_overrides` is set, unrealized PnL for open positions is computed from (bid, ask) for (symbol, group_id) instead of stored value.
/// When `price_overrides` is None, tries to read current price from Redis (prices:SYMBOL:GROUP_ID, written by order-engine) so UnR PnL is not stuck at 0.
async fn fetch_position_aggregates_from_redis(
    redis: &redis::Client,
    user_id: Uuid,
    price_overrides: Option<&PriceOverrides>,
) -> Option<(Decimal, Decimal, Decimal)> {
    let mut conn = match redis.get_async_connection().await {
        Ok(c) => c,
        Err(e) => {
            warn!("Account summary: Redis connection failed for user {}: {}", user_id, e);
            return None;
        }
    };
    let positions_key = Keys::positions_set(user_id);
    let position_ids: Vec<String> = match conn.smembers(&positions_key).await {
        Ok(ids) => ids,
        Err(e) => {
            warn!("Account summary: Redis SMEMBERS pos set failed for user {}: {}", user_id, e);
            return None;
        }
    };
    let mut margin_used = Decimal::ZERO;
    let mut unrealized_pnl = Decimal::ZERO;
    let mut realized_pnl = Decimal::ZERO;
    for pos_id_str in position_ids {
        let pos_id = match Uuid::parse_str(&pos_id_str) {
            Ok(u) => u,
            Err(_) => continue,
        };
        let pos_key = Keys::position_by_id(pos_id);
        let status: Option<String> = conn.hget(&pos_key, "status").await.ok().flatten();
        let status = status.as_deref().unwrap_or("");
        let margin_str: Option<String> = conn.hget(&pos_key, "margin").await.ok().flatten();
        let margin: Decimal = margin_str
            .as_deref()
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::ZERO);
        let real_str: Option<String> = conn.hget(&pos_key, "realized_pnl").await.ok().flatten();
        let real: Decimal = real_str
            .as_deref()
            .and_then(|s| Decimal::from_str(s).ok())
            .unwrap_or(Decimal::ZERO);
        realized_pnl += real;

        let is_open = status.eq_ignore_ascii_case("open");
        if is_open {
            margin_used += margin;

            let unreal: Decimal = if let Some(overrides) = price_overrides {
                let symbol: String = conn.hget(&pos_key, "symbol").await.ok().flatten().unwrap_or_default();
                let group_id: String = conn.hget(&pos_key, "group_id").await.ok().flatten().unwrap_or_default();
                let key = (symbol.clone(), group_id.clone());
                let (bid, ask) = if let Some(&(b, a)) = overrides.get(&key) {
                    (b, a)
                } else {
                    // Overrides only contain the tick's symbol; for other symbols fall back to Redis price so UnR Net PnL is always sum of ALL open positions
                    match get_price_from_redis(redis, &symbol, &group_id).await {
                        Some((b, a)) => (b, a),
                        None => {
                            let stored_str: Option<String> = conn.hget(&pos_key, "unrealized_pnl").await.ok().flatten();
                            let stored: Decimal = stored_str.as_deref().and_then(|s| Decimal::from_str(s).ok()).unwrap_or(Decimal::ZERO);
                            unrealized_pnl += stored;
                            continue;
                        }
                    }
                };
                let size_str: Option<String> = conn.hget(&pos_key, "size").await.ok().flatten();
                let size: Decimal = size_str
                    .as_deref()
                    .and_then(|s| Decimal::from_str(s).ok())
                    .unwrap_or(Decimal::ZERO);
                let avg_str: Option<String> = conn.hget(&pos_key, "avg_price").await.ok().flatten();
                let avg_price: Decimal = avg_str
                    .as_deref()
                    .and_then(|s| Decimal::from_str(s).ok())
                    .unwrap_or(Decimal::ZERO);
                let side: Option<String> = conn.hget(&pos_key, "side").await.ok().flatten();
                match side.as_deref() {
                    Some("LONG") => (bid - avg_price) * size,
                    Some("SHORT") => (avg_price - ask) * size,
                    _ => {
                        let unreal_str: Option<String> = conn.hget(&pos_key, "unrealized_pnl").await.ok().flatten();
                        unreal_str.as_deref().and_then(|s| Decimal::from_str(s).ok()).unwrap_or(Decimal::ZERO)
                    }
                }
            } else {
                // No overrides: compute from Redis price key (order-engine writes prices:SYMBOL:GROUP on each tick) so UnR PnL is not stuck at 0
                let symbol: String = conn.hget(&pos_key, "symbol").await.ok().flatten().unwrap_or_default();
                let group_id: String = conn.hget(&pos_key, "group_id").await.ok().flatten().unwrap_or_default();
                let unreal = if let Some((bid, ask)) = get_price_from_redis(redis, &symbol, &group_id).await {
                    let size_str: Option<String> = conn.hget(&pos_key, "size").await.ok().flatten();
                    let size: Decimal = size_str
                        .as_deref()
                        .and_then(|s| Decimal::from_str(s).ok())
                        .unwrap_or(Decimal::ZERO);
                    let avg_str: Option<String> = conn.hget(&pos_key, "avg_price").await.ok().flatten();
                    let avg_price: Decimal = avg_str
                        .as_deref()
                        .and_then(|s| Decimal::from_str(s).ok())
                        .unwrap_or(Decimal::ZERO);
                    let side: Option<String> = conn.hget(&pos_key, "side").await.ok().flatten();
                    match side.as_deref() {
                        Some("LONG") => (bid - avg_price) * size,
                        Some("SHORT") => (avg_price - ask) * size,
                        _ => {
                            let unreal_str: Option<String> = conn.hget(&pos_key, "unrealized_pnl").await.ok().flatten();
                            unreal_str.as_deref().and_then(|s| Decimal::from_str(s).ok()).unwrap_or(Decimal::ZERO)
                        }
                    }
                } else {
                    let unreal_str: Option<String> = conn.hget(&pos_key, "unrealized_pnl").await.ok().flatten();
                    unreal_str.as_deref().and_then(|s| Decimal::from_str(s).ok()).unwrap_or(Decimal::ZERO)
                };
                unreal
            };
            unrealized_pnl += unreal;
        }
    }
    Some((margin_used, unrealized_pnl, realized_pnl))
}

/// Fast DB-only free margin for place_order when Redis cache is cold.
/// Uses 2 queries so we don't block the request on full compute_and_cache_account_summary.
pub(crate) async fn get_free_margin_from_db_fast(pool: &PgPool, user_id: Uuid) -> Option<Decimal> {
    let balance: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT
            (SELECT COALESCE(SUM(net_amount), 0) FROM transactions WHERE user_id = $1 AND type = 'deposit'::transaction_type AND status = 'completed'::transaction_status AND currency = 'USD')
            - (SELECT COALESCE(SUM(net_amount), 0) FROM transactions WHERE user_id = $1 AND type = 'withdrawal'::transaction_type AND status = 'completed'::transaction_status AND currency = 'USD')
            + (SELECT COALESCE(SUM(pnl), 0) FROM positions WHERE user_id = $1 AND status = 'closed'::position_status)
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let balance = balance.unwrap_or(Decimal::ZERO);

    #[derive(sqlx::FromRow)]
    struct OpenRow { margin_used: Option<Decimal>, pnl: Option<Decimal> }
    let open: Option<OpenRow> = sqlx::query_as(
        r#"SELECT COALESCE(SUM(margin_used), 0)::numeric AS margin_used, COALESCE(SUM(pnl), 0)::numeric AS pnl FROM positions WHERE user_id = $1 AND status = 'open'::position_status"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let (margin_used, unrealized_pnl) = open
        .map(|r| (r.margin_used.unwrap_or(Decimal::ZERO), r.pnl.unwrap_or(Decimal::ZERO)))
        .unwrap_or((Decimal::ZERO, Decimal::ZERO));
    let equity = balance + unrealized_pnl;
    let free_margin = if equity >= margin_used {
        equity - margin_used
    } else {
        Decimal::ZERO
    };
    Some(free_margin)
}

/// Computes account summary, caches to Redis under position cache (pos:summary:{user_id}), and publishes to account:summary:updated.
/// Call after orders, positions, or deposit/withdrawal changes.
/// Position-derived metrics (margin, PnL) are read from Redis when available so they match the Positions tab.
pub async fn compute_and_cache_account_summary(
    pool: &PgPool,
    redis: &redis::Client,
    user_id: Uuid,
) {
    compute_and_cache_account_summary_with_prices(pool, redis, user_id, None).await
}

/// Like compute_and_cache_account_summary but uses live (bid, ask) for unrealized PnL when overrides are provided (tick-driven).
/// Uses AccountSummaryCoordinator when initialized: one computation per user at a time, and throttled publish to reduce UI flicker.
pub async fn compute_and_cache_account_summary_with_prices(
    pool: &PgPool,
    redis: &redis::Client,
    user_id: Uuid,
    price_overrides: Option<PriceOverrides>,
) {
    let overrides_ref = price_overrides.as_ref();

    let do_compute = async {
        match compute_account_summary_inner(pool, Some(redis), user_id, overrides_ref).await {
            Ok(summary) => {
                let group_id = get_user_group_id(pool, user_id).await;
                let (margin_call_threshold, stop_out_threshold) = if let Some(gid) = group_id {
                    (
                        get_margin_call_level_for_group(redis, pool, gid).await,
                        get_stop_out_level_for_group(redis, pool, gid).await,
                    )
                } else {
                    (None, None)
                };
                let summary_with_threshold = AccountSummary {
                    margin_call_level_threshold: margin_call_threshold,
                    stop_out_level_threshold: stop_out_threshold,
                    ..summary
                };
                let key = redis_model::keys::Keys::account_summary(user_id);
                let json = match serde_json::to_string(&summary_with_threshold) {
                    Ok(j) => j,
                    Err(e) => {
                        error!("Failed to serialize account summary: {}", e);
                        return;
                    }
                };
                if let Ok(mut conn) = redis.get_async_connection().await {
                    let thresh_str = summary_with_threshold
                        .margin_call_level_threshold
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                    let stop_out_str = summary_with_threshold
                        .stop_out_level_threshold
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                    let _: Result<(), _> = conn.hset_multiple(&key, &[
                        ("balance", summary_with_threshold.balance.to_string()),
                        ("equity", summary_with_threshold.equity.to_string()),
                        ("margin_used", summary_with_threshold.margin_used.to_string()),
                        ("free_margin", summary_with_threshold.free_margin.to_string()),
                        ("margin_level", summary_with_threshold.margin_level.clone()),
                        ("margin_call_level_threshold", thresh_str),
                        ("stop_out_level_threshold", stop_out_str),
                        ("realized_pnl", summary_with_threshold.realized_pnl.to_string()),
                        ("unrealized_pnl", summary_with_threshold.unrealized_pnl.to_string()),
                        ("updated_at", summary_with_threshold.updated_at.clone()),
                    ]).await;
                    let should_pub = COORDINATOR
                        .get()
                        .map(|c| c.should_publish(user_id))
                        .unwrap_or(true);
                    if should_pub {
                        if let Ok(count) = conn.publish::<_, _, i32>("account:summary:updated", &json).await {
                            info!("✅ Published account summary to Redis ({} subscribers) for user_id={}", count, user_id);
                            if let Some(c) = COORDINATOR.get() {
                                c.record_publish(user_id);
                            }
                        } else {
                            error!("❌ Failed to publish account summary to Redis for user_id={}", user_id);
                        }
                    }
                }
                // Stop out: if margin level below threshold, publish close_all (with cooldown)
                try_publish_stop_out_close_all(
                    redis,
                    user_id,
                    &summary_with_threshold.margin_level,
                    summary_with_threshold.stop_out_level_threshold,
                ).await;
            }
            Err(e) => {
                error!("Failed to compute account summary for user {}: {}", user_id, e);
            }
        }
    };

    if let Some(coord) = COORDINATOR.get() {
        coord.run_exclusive(user_id, do_compute).await
    } else {
        do_compute.await
    }
}

pub(crate) async fn compute_account_summary_inner(
    pool: &PgPool,
    redis: Option<&redis::Client>,
    user_id: Uuid,
    price_overrides: Option<&PriceOverrides>,
) -> anyhow::Result<AccountSummary> {
    // Deposits and withdrawals always from DB
    let total_deposits: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT COALESCE(SUM(net_amount), 0)
        FROM transactions
        WHERE user_id = $1 AND type = 'deposit'::transaction_type
          AND status = 'completed'::transaction_status AND currency = 'USD'
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let deposits = total_deposits.unwrap_or(Decimal::ZERO);

    let total_withdrawals: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT COALESCE(SUM(net_amount), 0)
        FROM transactions
        WHERE user_id = $1 AND type = 'withdrawal'::transaction_type
          AND status = 'completed'::transaction_status AND currency = 'USD'
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let withdrawals = total_withdrawals.unwrap_or(Decimal::ZERO);

    // Position-derived metrics: prefer Redis (same source as Positions tab) so margin/PnL match UI
    let (realized_pnl, unrealized_pnl, margin_used) = if let Some(rd) = redis {
        if let Some((margin, unreal, real)) =
            fetch_position_aggregates_from_redis(rd, user_id, price_overrides).await
        {
            (real, unreal, margin)
        } else {
            // Redis miss or error: fall back to DB
            info!(
                "Account summary: using DB fallback for position aggregates (user {}). Ensure auth-service uses same Redis as order-engine.",
                user_id
            );
            let total_realized_pnl: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
                r#"SELECT COALESCE(SUM(pnl), 0) FROM positions WHERE user_id = $1 AND status = 'closed'::position_status"#,
            )
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
            let total_unrealized_pnl: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
                r#"SELECT COALESCE(SUM(pnl), 0) FROM positions WHERE user_id = $1 AND status = 'open'::position_status"#,
            )
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
            let total_margin_used: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
                r#"SELECT COALESCE(SUM(margin_used), 0) FROM positions WHERE user_id = $1 AND status = 'open'::position_status"#,
            )
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
            (
                total_realized_pnl.unwrap_or(Decimal::ZERO),
                total_unrealized_pnl.unwrap_or(Decimal::ZERO),
                total_margin_used.unwrap_or(Decimal::ZERO),
            )
        }
    } else {
        let total_realized_pnl: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
            r#"SELECT COALESCE(SUM(pnl), 0) FROM positions WHERE user_id = $1 AND status = 'closed'::position_status"#,
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
        let total_unrealized_pnl: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
            r#"SELECT COALESCE(SUM(pnl), 0) FROM positions WHERE user_id = $1 AND status = 'open'::position_status"#,
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
        let total_margin_used: Option<Decimal> = sqlx::query_scalar::<_, Decimal>(
            r#"SELECT COALESCE(SUM(margin_used), 0) FROM positions WHERE user_id = $1 AND status = 'open'::position_status"#,
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
        (
            total_realized_pnl.unwrap_or(Decimal::ZERO),
            total_unrealized_pnl.unwrap_or(Decimal::ZERO),
            total_margin_used.unwrap_or(Decimal::ZERO),
        )
    };

    let balance = deposits - withdrawals + realized_pnl;

    let equity = balance + unrealized_pnl;
    let free_margin = if equity >= margin_used {
        equity - margin_used
    } else {
        Decimal::ZERO
    };

    let margin_level = if margin_used > Decimal::ZERO {
        format!("{:.2}", (equity / margin_used) * Decimal::from(100))
    } else {
        "inf".to_string()
    };

    let to_f64 = |d: Decimal| d.to_string().parse::<f64>().unwrap_or(0.0);

    Ok(AccountSummary {
        user_id: user_id.to_string(),
        balance: to_f64(balance),
        equity: to_f64(equity),
        margin_used: to_f64(margin_used),
        free_margin: to_f64(free_margin),
        margin_level,
        margin_call_level_threshold: None,
        stop_out_level_threshold: None,
        realized_pnl: to_f64(realized_pnl),
        unrealized_pnl: to_f64(unrealized_pnl),
        updated_at: Utc::now().to_rfc3339(),
    })
}

/// Recalculates wallet balance and publishes to Redis for real-time WebSocket updates.
/// Call this after any operation that changes balance (deposit/withdrawal approval, etc.).
pub async fn publish_wallet_balance_updated(
    pool: &PgPool,
    redis: &redis::Client,
    user_id: Uuid,
) {
    match calculate_wallet_balance(pool, user_id).await {
        Ok(balance) => {
            let main_balance = balance.available + balance.locked;
            let balance_event = serde_json::json!({
                "userId": balance.user_id,
                "user_id": balance.user_id,
                "balance": main_balance,
                "available": balance.available,
                "locked": balance.locked,
                "equity": balance.equity,
                "marginUsed": balance.margin_used,
                "margin_used": balance.margin_used,
                "freeMargin": balance.free_margin,
                "free_margin": balance.free_margin,
                "currency": balance.currency,
                "updated_at": balance.updated_at,
                "updatedAt": balance.updated_at,
            });
            if let Ok(event_json) = serde_json::to_string(&balance_event) {
                if let Ok(mut conn) = redis.get_async_connection().await {
                    if let Ok(count) = conn.publish::<_, _, i32>("wallet:balance:updated", event_json).await {
                        info!("✅ Published wallet.balance.updated to Redis ({} subscribers) for user_id={}", count, user_id);
                    } else {
                        error!("❌ Failed to publish wallet.balance.updated to Redis for user_id={}", user_id);
                    }
                }
            }
        }
        Err(e) => {
            error!("Failed to calculate balance for publish (user {}): {}", user_id, e);
        }
    }
}

async fn get_account_summary(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<AccountSummary>, StatusCode> {
    let user_id = claims.sub;
    let redis = deposits_state.redis.as_ref();
    // Try Redis cache first
    let key = redis_model::keys::Keys::account_summary(user_id);
    if let Ok(mut conn) = redis.get_async_connection().await {
        let balance: Option<String> = conn.hget(&key, "balance").await.ok();
        let equity: Option<String> = conn.hget(&key, "equity").await.ok();
        let margin_used: Option<String> = conn.hget(&key, "margin_used").await.ok();
        let free_margin: Option<String> = conn.hget(&key, "free_margin").await.ok();
        let margin_level: Option<String> = conn.hget(&key, "margin_level").await.ok();
        let margin_call_level_threshold: Option<String> = conn.hget(&key, "margin_call_level_threshold").await.ok();
        let stop_out_level_threshold: Option<String> = conn.hget(&key, "stop_out_level_threshold").await.ok();
        let realized_pnl: Option<String> = conn.hget(&key, "realized_pnl").await.ok();
        let unrealized_pnl: Option<String> = conn.hget(&key, "unrealized_pnl").await.ok();
        let updated_at: Option<String> = conn.hget(&key, "updated_at").await.ok();
        if let (Some(bal), Some(equity), Some(margin_used), Some(free_margin), Some(margin_level), Some(realized_pnl), Some(unrealized_pnl), Some(updated_at)) =
            (balance, equity, margin_used, free_margin, margin_level, realized_pnl, unrealized_pnl, updated_at)
        {
            let balance_f: f64 = bal.parse().unwrap_or(0.0);
            let threshold = margin_call_level_threshold
                .and_then(|s| s.parse::<f64>().ok());
            let threshold = if threshold.is_some() {
                threshold
            } else if let Some(gid) = claims.group_id {
                get_margin_call_level_for_group(redis, &pool, gid).await
            } else {
                None
            };
            let stop_out = stop_out_level_threshold.and_then(|s| s.parse::<f64>().ok());
            let stop_out = if stop_out.is_some() {
                stop_out
            } else if let Some(gid) = claims.group_id {
                get_stop_out_level_for_group(redis, &pool, gid).await
            } else {
                None
            };
            return Ok(Json(AccountSummary {
                user_id: user_id.to_string(),
                balance: balance_f,
                equity: equity.parse().unwrap_or(0.0),
                margin_used: margin_used.parse().unwrap_or(0.0),
                free_margin: free_margin.parse().unwrap_or(0.0),
                margin_level,
                margin_call_level_threshold: threshold,
                stop_out_level_threshold: stop_out,
                realized_pnl: realized_pnl.parse().unwrap_or(0.0),
                unrealized_pnl: unrealized_pnl.parse().unwrap_or(0.0),
                updated_at,
            }));
        }
    }
    // Cache miss: compute, cache, return (use Redis for position metrics so they match Positions tab)
    match compute_account_summary_inner(&pool, Some(redis), user_id, None).await {
        Ok(summary) => {
            let (threshold, stop_out) = if let Some(gid) = claims.group_id {
                (
                    get_margin_call_level_for_group(redis, &pool, gid).await,
                    get_stop_out_level_for_group(redis, &pool, gid).await,
                )
            } else {
                (None, None)
            };
            compute_and_cache_account_summary(&pool, redis, user_id).await;
            let summary_with_threshold = AccountSummary {
                margin_call_level_threshold: threshold,
                stop_out_level_threshold: stop_out,
                ..summary
            };
            Ok(Json(summary_with_threshold))
        }
        Err(e) => {
            error!("Failed to compute account summary for user {}: {}", user_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_wallet_balance(
    State(pool): State<PgPool>,
    Extension(_deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<WalletBalanceResponse>, StatusCode> {
    let user_id = claims.sub;
    
    match calculate_wallet_balance(&pool, user_id).await {
        Ok(balance) => {
            info!("Balance calculated for user {}: available={}, equity={}, margin_used={}",
                  user_id, balance.available, balance.equity, balance.margin_used);
            Ok(Json(balance))
        }
        Err(e) => {
            error!("Failed to calculate balance for user {}: {}", user_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
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
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
    pub user_email: Option<String>,
    pub amount: f64,
    pub currency: String,
    pub note: Option<String>,
    pub status: String,
    pub created_at: String,
    pub approved_at: Option<String>,
    pub rejected_at: Option<String>,
    pub admin_id: Option<String>,
    pub transaction_id: Option<String>,
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

    let status_filter = if status.to_lowercase() == "all" {
        None
    } else {
        Some(status.to_uppercase())
    };

    let rows = if let Some(status_val) = status_filter {
        // Map deposit_requests status to transaction status
        let tx_status = match status_val.as_str() {
            "PENDING" => "pending",
            "APPROVED" => "approved",
            "REJECTED" => "rejected",
            _ => "pending",
        };
        sqlx::query(
            r#"
            SELECT 
                t.id, t.user_id, t.amount::text, t.currency, 
                t.method_details->>'note' as note, 
                CASE 
                    WHEN t.status = 'pending' THEN 'PENDING'
                    WHEN t.status = 'approved' THEN 'APPROVED'
                    WHEN t.status = 'rejected' THEN 'REJECTED'
                    ELSE 'PENDING'
                END as status,
                t.created_at, t.completed_at as approved_at, t.cancelled_at as rejected_at, t.created_by as admin_id,
                t.id as transaction_id,
                u.first_name, u.last_name, u.email
            FROM transactions t
            LEFT JOIN users u ON u.id = t.user_id
            WHERE t.type = 'deposit'::transaction_type AND t.status = $1::transaction_status
            ORDER BY t.created_at DESC
            LIMIT 1000
            "#,
        )
        .bind(tx_status)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT 
                t.id, t.user_id, t.amount::text, t.currency, 
                t.method_details->>'note' as note, 
                CASE 
                    WHEN t.status = 'pending' THEN 'PENDING'
                    WHEN t.status = 'approved' THEN 'APPROVED'
                    WHEN t.status = 'rejected' THEN 'REJECTED'
                    ELSE 'PENDING'
                END as status,
                t.created_at, t.completed_at as approved_at, t.cancelled_at as rejected_at, t.created_by as admin_id,
                t.id as transaction_id,
                u.first_name, u.last_name, u.email
            FROM transactions t
            LEFT JOIN users u ON u.id = t.user_id
            WHERE t.type = 'deposit'::transaction_type
            ORDER BY t.created_at DESC
            LIMIT 1000
            "#,
        )
        .fetch_all(&pool)
        .await
    }
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
                user_first_name: row.get::<Option<String>, _>(11),
                user_last_name: row.get::<Option<String>, _>(12),
                user_email: row.get::<Option<String>, _>(13),
                amount,
                currency: row.get::<String, _>(3),
                note: row.get::<Option<String>, _>(4),
                status: row.get::<String, _>(5),
                created_at: row.get::<chrono::DateTime<chrono::Utc>, _>(6).to_rfc3339(),
                approved_at: row.get::<Option<chrono::DateTime<chrono::Utc>>, _>(7)
                    .map(|dt| dt.to_rfc3339()),
                rejected_at: row.get::<Option<chrono::DateTime<chrono::Utc>>, _>(8)
                    .map(|dt| dt.to_rfc3339()),
                admin_id: row.get::<Option<Uuid>, _>(9)
                    .map(|id| id.to_string()),
                transaction_id: row.get::<Option<Uuid>, _>(10)
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
    Path(transaction_id): Path<Uuid>,
) -> Result<Json<ApproveDepositResponse>, StatusCode> {
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let admin_id = claims.sub;

    let row = sqlx::query(
        r#"
        SELECT user_id, amount::text, status, reference
        FROM transactions
        WHERE id = $1 AND type = 'deposit'::transaction_type
        "#,
    )
    .bind(transaction_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let (user_id, amount_str, current_status, transaction_ref) = match row {
        Some(row) => (
            row.get::<Uuid, _>(0),
            row.get::<String, _>(1),
            row.get::<String, _>(2),
            row.get::<String, _>(3),
        ),
        None => {
            error!("Deposit transaction not found: {}", transaction_id);
            return Err(StatusCode::NOT_FOUND);
        }
    };

    if current_status != "pending" {
        error!("Cannot approve transaction {}: status is '{}', expected 'pending'", transaction_id, current_status);
        return Err(StatusCode::BAD_REQUEST);
    }

    let amount = Decimal::from_str(&amount_str)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let now = Utc::now();

    // Update transaction status to 'approved'
    sqlx::query(
        r#"
        UPDATE transactions
        SET status = $1::transaction_status, created_by = $2, completed_at = $3, updated_at = $4
        WHERE id = $5 AND status = 'pending'::transaction_status
        "#,
    )
    .bind("approved")
    .bind(admin_id)
    .bind(now)
    .bind(now)
    .bind(transaction_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to update transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Get or create wallet
    let wallet_id = ledger_service::get_or_create_wallet(&pool, user_id, "USD", "spot")
        .await
        .map_err(|e| {
            error!("Failed to get or create wallet: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Create ledger entry
    let description = format!("Deposit approved for transaction {}", transaction_id);
    ledger_service::create_ledger_entry(
        &pool,
        wallet_id,
        "deposit",
        amount,
        &transaction_ref,
        Some(&description),
    )
    .await
    .map_err(|e| {
        error!("Failed to create ledger entry: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    info!("Created ledger entry: transaction_id={}, wallet_id={}, amount={}", 
          transaction_id, wallet_id, amount);

    // Calculate balance using formula: Balance = deposits - withdrawals + total realised net profit and loss
    // 1. Calculate total deposits (approved or completed deposits only)
    let total_deposits: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(net_amount), 0) FROM transactions
        WHERE user_id = $1 AND type = 'deposit'::transaction_type AND status = 'completed'::transaction_status AND currency = $2
        "#
    )
    .bind(user_id)
    .bind("USD")
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        error!("Failed to calculate total deposits for user {}: {}", user_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // 2. Calculate total withdrawals (approved or completed withdrawals only)
    let total_withdrawals: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(net_amount), 0) FROM transactions
        WHERE user_id = $1 AND type = 'withdrawal'::transaction_type AND status = 'completed'::transaction_status AND currency = $2
        "#
    )
    .bind(user_id)
    .bind("USD")
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        error!("Failed to calculate total withdrawals for user {}: {}", user_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // 3. Calculate total realized PnL (from closed positions)
    let total_realized_pnl: Decimal = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(pnl), 0) FROM positions
        WHERE user_id = $1 AND status = 'closed'::position_status
        "#
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        error!("Failed to calculate total realized PnL for user {}: {}", user_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Calculate main balance
    let main_balance = total_deposits - total_withdrawals + total_realized_pnl;

    // Fetch current wallet data
    let wallet_row = sqlx::query(
        r#"
        SELECT available_balance, locked_balance FROM wallets
        WHERE user_id = $1 AND currency = $2 AND wallet_type = 'spot'::wallet_type
        "#
    )
    .bind(user_id)
    .bind("USD")
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch wallet for user {}: {}", user_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let (available_balance, locked_balance) = if let Some(row) = wallet_row {
        (
            row.get::<Decimal, _>(0),
            row.get::<Decimal, _>(1),
        )
    } else {
        (Decimal::ZERO, Decimal::ZERO)
    };

    // Fetch current open positions for margin calculation
    let open_positions: Vec<(Decimal, Decimal)> = sqlx::query_as(
        r#"
        SELECT size, margin_used FROM positions
        WHERE user_id = $1 AND status = 'open'::position_status
        "#
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch open positions for user {}: {}", user_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let total_margin_used: Decimal = open_positions.iter().map(|(_, margin)| margin).sum();
    let total_unrealized_pnl: Decimal = Decimal::ZERO; // Simplified for now, actual PnL calculation is more complex

    // Calculate other wallet metrics
    let available = main_balance - total_margin_used;
    let locked = total_margin_used;
    let equity = main_balance + total_unrealized_pnl;
    let free_margin = available;

    let approved_event = serde_json::json!({
        "transactionId": transaction_id.to_string(),
        "userId": user_id.to_string(),
        "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
        "currency": "USD",
        "approvedAt": now.to_rfc3339(),
        "newBalance": main_balance.to_string().parse::<f64>().unwrap_or(0.0),
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
        "balance": main_balance.to_string().parse::<f64>().unwrap_or(0.0), // Main balance from formula
        "available": available.to_string().parse::<f64>().unwrap_or(0.0),
        "locked": locked.to_string().parse::<f64>().unwrap_or(0.0),
        "equity": equity.to_string().parse::<f64>().unwrap_or(0.0),
        "marginUsed": total_margin_used.to_string().parse::<f64>().unwrap_or(0.0),
        "margin_used": total_margin_used.to_string().parse::<f64>().unwrap_or(0.0), // snake_case for compatibility
        "freeMargin": free_margin.to_string().parse::<f64>().unwrap_or(0.0),
        "free_margin": free_margin.to_string().parse::<f64>().unwrap_or(0.0), // snake_case for compatibility
        "updatedAt": now.to_rfc3339(),
    });

    // Publish to NATS
    let balance_msg = VersionedMessage::new("wallet.balance.updated", &balance_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let balance_payload = serde_json::to_vec(&balance_msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    deposits_state.nats.publish("wallet.balance.updated".to_string(), balance_payload.into()).await
        .ok();

    // Publish to Redis for real-time WebSocket balance update (single source of truth)
    publish_wallet_balance_updated(&pool, deposits_state.redis.as_ref(), user_id).await;
    compute_and_cache_account_summary(&pool, deposits_state.redis.as_ref(), user_id).await;

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
    .bind(format!("Your deposit of ${:.2} has been approved. New balance: ${:.2}", amount, main_balance))
    .bind(false)
    .bind(now)
    .bind(serde_json::json!({
        "transactionId": transaction_id.to_string(),
        "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
    }))
    .execute(&pool)
    .await
    .ok();

    let notification_event = serde_json::json!({
        "id": notification_id.to_string(),
        "kind": "DEPOSIT_APPROVED",
        "title": "Deposit Approved",
        "message": format!("Your deposit of ${:.2} has been approved. New balance: ${:.2}", amount, main_balance),
        "createdAt": now.to_rfc3339(),
        "read": false,
        "meta": {
            "transactionId": transaction_id.to_string(),
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

    info!("Deposit approved: transaction_id={}, user_id={}, amount={}, new_balance={}", 
          transaction_id, user_id, amount, main_balance);

    Ok(Json(ApproveDepositResponse {
        status: "approved".to_string(),
        message: format!("Deposit request approved. New balance: ${:.2}", main_balance),
    }))
}

// ============================================================================
// REJECT DEPOSIT (ADMIN)
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct RejectDepositRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RejectDepositResponse {
    pub status: String,
    pub message: String,
}

async fn reject_deposit(
    State(pool): State<PgPool>,
    Extension(deposits_state): Extension<DepositsState>,
    Extension(claims): Extension<Claims>,
    Path(transaction_id): Path<Uuid>,
    Json(req): Json<RejectDepositRequest>,
) -> Result<Json<RejectDepositResponse>, StatusCode> {
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let admin_id = claims.sub;

    let row = sqlx::query(
        r#"
        SELECT user_id, amount::text, status
        FROM transactions
        WHERE id = $1 AND type = 'deposit'::transaction_type
        "#,
    )
    .bind(transaction_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch transaction: {}", e);
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

    if current_status != "pending" {
        return Err(StatusCode::BAD_REQUEST);
    }

    let amount = Decimal::from_str(&amount_str)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let now = Utc::now();

    // Update transaction status to 'rejected'
    sqlx::query(
        r#"
        UPDATE transactions
        SET status = $1::transaction_status, created_by = $2, rejection_reason = $3, cancelled_at = $4, updated_at = $5
        WHERE id = $6 AND status = 'pending'::transaction_status
        "#,
    )
    .bind("rejected")
    .bind(admin_id)
    .bind(&req.reason)
    .bind(now)
    .bind(now)
    .bind(transaction_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        error!("Failed to update transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    info!("Updated transaction status to rejected: transaction_id={}, reason={:?}", 
          transaction_id, req.reason);

    let rejected_event = serde_json::json!({
        "transactionId": transaction_id.to_string(),
        "userId": user_id.to_string(),
        "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
        "currency": "USD",
        "rejectedAt": now.to_rfc3339(),
        "reason": req.reason,
        "adminId": admin_id.to_string(),
    });

    let msg = VersionedMessage::new("deposit.request.rejected", &rejected_event)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let payload = serde_json::to_vec(&msg)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    deposits_state.nats.publish("deposit.request.rejected".to_string(), payload.into()).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Also publish to Redis for WebSocket gateway
    let mut redis_conn = deposits_state.redis.get_async_connection().await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _: Result<(), _> = redis_conn.publish("deposits:rejected", serde_json::to_string(&rejected_event).unwrap_or_default()).await;

    let notification_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO notifications (id, user_id, kind, title, message, read, created_at, meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .bind("DEPOSIT_REJECTED")
    .bind("Deposit Rejected")
    .bind(format!("Your deposit request of ${:.2} has been rejected.{}", amount, req.reason.as_ref().map(|r| format!(" Reason: {}", r)).unwrap_or_default()))
    .bind(false)
    .bind(now)
    .bind(serde_json::json!({
        "transactionId": transaction_id.to_string(),
        "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
        "reason": req.reason,
    }))
    .execute(&pool)
    .await
    .ok();

    let notification_event = serde_json::json!({
        "id": notification_id.to_string(),
        "kind": "DEPOSIT_REJECTED",
        "title": "Deposit Rejected",
        "message": format!("Your deposit request of ${:.2} has been rejected.{}", amount, req.reason.as_ref().map(|r| format!(" Reason: {}", r)).unwrap_or_default()),
        "createdAt": now.to_rfc3339(),
        "read": false,
        "meta": {
            "transactionId": transaction_id.to_string(),
            "amount": amount.to_string().parse::<f64>().unwrap_or(0.0),
            "reason": req.reason,
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

    info!("Deposit rejected: transaction_id={}, user_id={}, amount={}, reason={:?}", 
          transaction_id, user_id, amount, req.reason);

    Ok(Json(RejectDepositResponse {
        status: "rejected".to_string(),
        message: "Deposit request rejected".to_string(),
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
            warn!("Notifications fetch failed (table may not exist): {}, returning empty list", e);
            vec![]
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
    
    // Optimize: Fetch all positions in parallel using futures
    // This reduces latency from O(n) sequential calls to O(1) parallel batch
    if position_ids.is_empty() {
        return Ok(Json(PositionsResponse { positions }));
    }
    
    // Parse all position IDs and create futures for parallel fetching
    let mut fetch_futures = Vec::new();
    let redis_client = deposits_state.redis.clone();
    
    for pos_id_str in position_ids {
        if let Ok(pos_id) = Uuid::parse_str(&pos_id_str) {
            let pos_key = Keys::position_by_id(pos_id);
            let pos_id_str_clone = pos_id_str.clone();
            let redis_clone = redis_client.clone();
            
            // Create future for each position fetch using a new connection
            let fetch_future = async move {
                let mut conn = redis_clone.get_async_connection().await.ok()?;
                let pos_data: std::collections::HashMap<String, String> = conn.hgetall(&pos_key).await.ok()?;
                Some((pos_id_str_clone, pos_data))
            };
            
            fetch_futures.push(fetch_future);
        }
    }
    
    // Execute all fetches in parallel
    let results = futures::future::join_all(fetch_futures).await;
    
    // Process results
    for result in results {
        if let Some((pos_id_str, pos_data)) = result {
            if !pos_data.is_empty() {
                let mut pos_json = serde_json::Map::new();
                pos_json.insert("id".to_string(), serde_json::Value::String(pos_id_str.clone()));
                
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
        .route("/:id/reject", post(reject_deposit))
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

/// Current user's deposit history (for Payment / Deposit History panel)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyDepositItem {
    pub id: String,
    pub amount: f64,
    pub currency: String,
    pub status: String,
    pub reference: String,
    pub created_at: String,
}

async fn list_my_deposits(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<MyDepositItem>>, (StatusCode, Json<serde_json::Value>)> {
    let user_id = claims.sub;
    let rows = sqlx::query(
        r#"
        SELECT id, net_amount::text, currency, status::text, reference, created_at
        FROM transactions
        WHERE user_id = $1 AND type = 'deposit'::transaction_type
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch deposit history for user {}: {}", user_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": { "code": "DEPOSIT_HISTORY_FAILED", "message": e.to_string() }
            })),
        )
    })?;

    let items: Vec<MyDepositItem> = rows
        .into_iter()
        .map(|row| {
            let amount_str: String = row.get(1);
            let amount = amount_str.parse::<f64>().unwrap_or(0.0);
            let created_at: chrono::DateTime<Utc> = row.get(5);
            MyDepositItem {
                id: row.get::<Uuid, _>(0).to_string(),
                amount,
                currency: row.get(2),
                status: row.get(3),
                reference: row.get(4),
                created_at: created_at.to_rfc3339(),
            }
        })
        .collect();
    Ok(Json(items))
}

pub fn create_account_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/summary", get(get_account_summary))
        .route("/deposits", get(list_my_deposits))
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

    // Get symbol for index updates
    let symbol: Option<String> = conn.hget(&pos_key, "symbol").await
        .map_err(|e| {
            error!("Failed to get position symbol: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    let symbol = symbol.ok_or_else(|| {
        error!("Position {} has no symbol", position_id);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Update SL/TP in Redis and update indexes
    if let Some(sl) = &req.stop_loss {
        let sl_key = format!("pos:sl:{}", symbol);
        if sl.is_empty() || sl == "null" {
            let _: () = conn.hset(&pos_key, "sl", "null").await
                .map_err(|e| {
                    error!("Failed to update SL: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            // Remove from SL index
            let _: () = conn.zrem(&sl_key, position_id.to_string()).await
                .map_err(|e| {
                    error!("Failed to remove from SL index: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        } else {
            let sl_price: f64 = sl.parse().map_err(|_| {
                error!("Invalid SL price: {}", sl);
                StatusCode::BAD_REQUEST
            })?;
            let _: () = conn.hset(&pos_key, "sl", sl).await
                .map_err(|e| {
                    error!("Failed to update SL: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            // Update SL index (add or update)
            // ZADD: key, member, score
            let _: () = conn.zadd(&sl_key, position_id.to_string(), sl_price).await
                .map_err(|e| {
                    error!("Failed to update SL index: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        }
    }

    if let Some(tp) = &req.take_profit {
        let tp_key = format!("pos:tp:{}", symbol);
        if tp.is_empty() || tp == "null" {
            let _: () = conn.hset(&pos_key, "tp", "null").await
                .map_err(|e| {
                    error!("Failed to update TP: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            // Remove from TP index
            let _: () = conn.zrem(&tp_key, position_id.to_string()).await
                .map_err(|e| {
                    error!("Failed to remove from TP index: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
        } else {
            let tp_price: f64 = tp.parse().map_err(|_| {
                error!("Invalid TP price: {}", tp);
                StatusCode::BAD_REQUEST
            })?;
            let _: () = conn.hset(&pos_key, "tp", tp).await
                .map_err(|e| {
                    error!("Failed to update TP: {}", e);
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;
            // Update TP index (add or update)
            let _: () = conn.zadd(&tp_key, position_id.to_string(), tp_price).await
                .map_err(|e| {
                    error!("Failed to update TP index: {}", e);
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

#[derive(Debug, Deserialize)]
pub struct ClosePositionRequest {
    pub size: Option<String>, // Optional size to close (None = full close)
}

#[derive(Debug, Serialize)]
pub struct ClosePositionResponse {
    pub success: bool,
    pub message: String,
    pub position_id: String,
}

async fn close_position(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(deposits_state): Extension<DepositsState>,
    Path((user_id, position_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<ClosePositionRequest>,
) -> Result<Json<ClosePositionResponse>, StatusCode> {
    // Users can only close their own positions, admins can close any
    let is_own_position = claims.sub == user_id;
    let is_admin = claims.role == "admin";
    
    if !is_own_position && !is_admin {
        error!("Forbidden: user_id={}, claims.sub={}, claims.role={}", user_id, claims.sub, claims.role);
        return Err(StatusCode::FORBIDDEN);
    }

    // Verify position exists and belongs to user
    let mut conn = deposits_state.redis.get_async_connection().await
        .map_err(|e| {
            error!("Failed to get Redis connection: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let pos_key = Keys::position_by_id(position_id);
    let pos_data: std::collections::HashMap<String, String> = conn.hgetall(&pos_key).await
        .map_err(|e| {
            error!("Failed to get position data: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if pos_data.is_empty() {
        error!("Position not found: {}", position_id);
        return Err(StatusCode::NOT_FOUND);
    }

    let pos_user_id: Option<String> = pos_data.get("user_id").cloned();
    if pos_user_id.as_deref() != Some(&user_id.to_string()) {
        error!("Position {} does not belong to user {}", position_id, user_id);
        return Err(StatusCode::FORBIDDEN);
    }

    let pos_status: Option<String> = pos_data.get("status").cloned();
    let is_open = pos_status.as_deref().map_or(false, |s| s.eq_ignore_ascii_case("OPEN"));
    if !is_open {
        error!("Position {} is not open (status: {:?})", position_id, pos_status);
        return Err(StatusCode::BAD_REQUEST);
    }

    // Parse close size if provided
    // Note: The order-engine will get the current market price when processing the close command
    let close_size = req.size
        .and_then(|s| Decimal::from_str(&s).ok());

    // Publish close position command to NATS
    let correlation_id = Uuid::new_v4().to_string();
    let cmd = serde_json::json!({
        "position_id": position_id.to_string(),
        "user_id": user_id.to_string(),
        "size": close_size.map(|s| s.to_string()),
        "correlation_id": correlation_id,
        "ts": Utc::now().to_rfc3339(),
    });

    if let Err(e) = deposits_state.nats.publish("cmd.position.close".to_string(), cmd.to_string().into()).await {
        error!("Failed to publish close position command: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    info!("Published close position command: position_id={}, user_id={}, size={:?}", 
          position_id, user_id, close_size);

    Ok(Json(ClosePositionResponse {
        success: true,
        message: "Position close command sent successfully".to_string(),
        position_id: position_id.to_string(),
    }))
}

pub fn create_positions_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/:user_id/positions/:position_id/sltp", put(update_position_sltp)) // More specific route first
        .route("/:user_id/positions/:position_id/close", post(close_position)) // Close position route
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

