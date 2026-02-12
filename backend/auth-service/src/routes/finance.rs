use axum::{
    extract::{Query, State, Path, Extension},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, FromRow, Row};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use std::str::FromStr;
use tracing::{error, info, warn};
use redis::AsyncCommands;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;
use crate::services::ledger_service;

#[derive(Debug, Serialize)]
pub struct FinanceOverviewResponse {
    pub total_balances: Decimal,
    pub pending_deposits: i64,
    pub pending_withdrawals: i64,
    pub net_fees_today: Decimal,
    pub deposits_today: DepositWithdrawalStats,
    pub withdrawals_today: DepositWithdrawalStats,
}

#[derive(Debug, Serialize)]
pub struct DepositWithdrawalStats {
    pub count: i64,
    pub amount: Decimal,
}

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct TransactionResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_email: String,
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
    pub r#type: String,
    pub amount: Decimal,
    pub currency: String,
    pub fee: Decimal,
    pub net_amount: Decimal,
    pub method: String,
    pub status: String,
    pub reference: String,
    pub method_details: Option<serde_json::Value>,
    pub admin_notes: Option<String>,
    pub rejection_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct WalletResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_email: String,
    pub user_first_name: Option<String>,
    pub user_last_name: Option<String>,
    pub wallet_type: String,
    pub currency: String,
    pub available_balance: Decimal,
    pub locked_balance: Decimal,
    pub equity: Decimal,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListTransactionsQuery {
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub date_from: Option<String>,
    #[serde(default)]
    pub date_to: Option<String>,
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub page_size: i64,
}

#[derive(Debug, Deserialize)]
pub struct ListWalletsQuery {
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub wallet_type: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub balance_min: Option<f64>,
    #[serde(default)]
    pub balance_max: Option<f64>,
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub page_size: i64,
}

fn default_page() -> i64 {
    1
}

fn default_page_size() -> i64 {
    50
}

#[derive(Debug, Deserialize)]
pub struct RejectTransactionRequest {
    pub reason: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApproveTransactionResponse {
    pub status: String,
    pub message: String,
}

async fn approve_transaction(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(transaction_id): Path<Uuid>,
) -> Result<Json<ApproveTransactionResponse>, StatusCode> {
    // Check admin role
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let admin_id = claims.sub;
    let now = Utc::now();

    // Get transaction details
    let tx_row = sqlx::query(
        r#"
        SELECT user_id, type::text, net_amount, currency, status::text, reference
        FROM transactions
        WHERE id = $1
        "#
    )
    .bind(transaction_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let (user_id, tx_type, net_amount, currency, current_status, reference) = match tx_row {
        Some(row) => (
            row.get::<Uuid, _>(0),
            row.get::<String, _>(1),
            row.get::<Decimal, _>(2),
            row.get::<String, _>(3),
            row.get::<String, _>(4),
            row.get::<String, _>(5),
        ),
        None => {
            error!("Transaction not found: {}", transaction_id);
            return Err(StatusCode::NOT_FOUND);
        }
    };

    if current_status != "pending" {
        error!("Cannot approve transaction {}: status is '{}', expected 'pending'", transaction_id, current_status);
        return Err(StatusCode::BAD_REQUEST);
    }

    // For withdrawals, check if user has sufficient balance
    if tx_type == "withdrawal" {
        let wallet_row = sqlx::query(
            r#"
            SELECT available_balance FROM wallets
            WHERE user_id = $1 AND currency = $2 AND wallet_type = 'spot'::wallet_type
            LIMIT 1
            "#
        )
        .bind(user_id)
        .bind(&currency)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            error!("Failed to check wallet balance: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let available_balance = if let Some(row) = wallet_row {
            row.try_get::<Decimal, _>(0).unwrap_or(Decimal::ZERO)
        } else {
            Decimal::ZERO
        };

        if available_balance < net_amount {
            error!("Insufficient balance for withdrawal: available={}, requested={}", available_balance, net_amount);
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    // Get or create wallet
    let wallet_id = ledger_service::get_or_create_wallet(&pool, user_id, &currency, "spot")
        .await
        .map_err(|e| {
            error!("Failed to get or create wallet: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Calculate delta (positive for deposits, negative for withdrawals)
    let delta = if tx_type == "withdrawal" {
        -net_amount
    } else {
        net_amount
    };

    // Create ledger entry
    let description = format!("Transaction {} approved: {}", tx_type, reference);
    ledger_service::create_ledger_entry(
        &pool,
        wallet_id,
        &tx_type,
        delta,
        &reference,
        Some(&description),
    )
    .await
    .map_err(|e| {
        error!("Failed to create ledger entry: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Check if admin_id exists in admin_users table
    let admin_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(SELECT 1 FROM admin_users WHERE id = $1)
        "#
    )
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    // Update transaction status
    // Only set created_by if admin exists in admin_users table, otherwise leave it NULL
    if admin_exists {
        sqlx::query(
            r#"
            UPDATE transactions
            SET status = 'approved'::transaction_status,
                created_by = $1,
                completed_at = $2,
                updated_at = $3
            WHERE id = $4
            "#
        )
        .bind(admin_id)
        .bind(now)
        .bind(now)
        .bind(transaction_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            error!("Failed to update transaction status: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    } else {
        // Admin doesn't exist in admin_users, update without created_by
        sqlx::query(
            r#"
            UPDATE transactions
            SET status = 'approved'::transaction_status,
                completed_at = $1,
                updated_at = $2
            WHERE id = $3
            "#
        )
        .bind(now)
        .bind(now)
        .bind(transaction_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            error!("Failed to update transaction status: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    // Publish wallet.balance.updated event for real-time balance update
    let balance_event = {
        // Calculate balance using formula: deposits - withdrawals + realized PnL
        let total_deposits: Decimal = sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(net_amount), 0) FROM transactions
            WHERE user_id = $1 AND type = 'deposit'::transaction_type AND status = 'approved'::transaction_status AND currency = $2
            "#
        )
        .bind(user_id)
        .bind(&currency)
        .fetch_one(&pool)
        .await
        .unwrap_or(Decimal::ZERO);

        let total_withdrawals: Decimal = sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(net_amount), 0) FROM transactions
            WHERE user_id = $1 AND type = 'withdrawal'::transaction_type AND status = 'approved'::transaction_status AND currency = $2
            "#
        )
        .bind(user_id)
        .bind(&currency)
        .fetch_one(&pool)
        .await
        .unwrap_or(Decimal::ZERO);

        let total_realized_pnl: Decimal = sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(pnl), 0) FROM positions
            WHERE user_id = $1 AND status = 'closed'::position_status
            "#
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(Decimal::ZERO);

        let main_balance = total_deposits - total_withdrawals + total_realized_pnl;

        let open_positions: Vec<(Decimal, Decimal)> = sqlx::query_as(
            r#"
            SELECT size, margin_used FROM positions
            WHERE user_id = $1 AND status = 'open'::position_status
            "#
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        let total_margin_used: Decimal = open_positions.iter().map(|(_, margin)| margin).sum();
        let available = main_balance - total_margin_used;
        let locked = total_margin_used;
        let equity = main_balance;
        let free_margin = available;

        serde_json::json!({
            "userId": user_id.to_string(),
            "currency": currency,
            "balance": main_balance.to_string().parse::<f64>().unwrap_or(0.0),
            "available": available.to_string().parse::<f64>().unwrap_or(0.0),
            "locked": locked.to_string().parse::<f64>().unwrap_or(0.0),
            "equity": equity.to_string().parse::<f64>().unwrap_or(0.0),
            "marginUsed": total_margin_used.to_string().parse::<f64>().unwrap_or(0.0),
            "margin_used": total_margin_used.to_string().parse::<f64>().unwrap_or(0.0),
            "freeMargin": free_margin.to_string().parse::<f64>().unwrap_or(0.0),
            "free_margin": free_margin.to_string().parse::<f64>().unwrap_or(0.0),
            "updatedAt": now.to_rfc3339(),
        })
    };

    // Publish to Redis for WebSocket gateway
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_async_connection().await {
            let event_json = serde_json::to_string(&balance_event).unwrap_or_default();
            if let Ok(count) = conn.publish::<_, _, i32>("wallet:balance:updated", event_json).await {
                info!("✅ Published wallet.balance.updated to Redis ({} subscribers) for user_id={}", count, user_id);
            }
        }
    }

    info!("Transaction approved: transaction_id={}, user_id={}, type={}, amount={}", 
          transaction_id, user_id, tx_type, net_amount);

    Ok(Json(ApproveTransactionResponse {
        status: "approved".to_string(),
        message: format!("Transaction {} approved successfully", transaction_id),
    }))
}

async fn reject_transaction(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(transaction_id): Path<Uuid>,
    Json(req): Json<RejectTransactionRequest>,
) -> Result<Json<ApproveTransactionResponse>, StatusCode> {
    // Check admin role
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let admin_id = claims.sub;
    let now = Utc::now();

    // Get transaction details
    let tx_row = sqlx::query(
        r#"
        SELECT status::text FROM transactions WHERE id = $1
        "#
    )
    .bind(transaction_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let current_status = match tx_row {
        Some(row) => row.get::<String, _>(0),
        None => {
            error!("Transaction not found: {}", transaction_id);
            return Err(StatusCode::NOT_FOUND);
        }
    };

    if current_status != "pending" {
        error!("Cannot reject transaction {}: status is '{}', expected 'pending'", transaction_id, current_status);
        return Err(StatusCode::BAD_REQUEST);
    }

    // Check if admin_id exists in admin_users table
    let admin_exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(SELECT 1 FROM admin_users WHERE id = $1)
        "#
    )
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    // Update transaction status
    // Only set created_by if admin exists in admin_users table, otherwise leave it NULL
    if admin_exists {
        sqlx::query(
            r#"
            UPDATE transactions
            SET status = 'rejected'::transaction_status,
                created_by = $1,
                rejection_reason = $2,
                updated_at = $3
            WHERE id = $4
            "#
        )
        .bind(admin_id)
        .bind(req.reason.as_deref())
        .bind(now)
        .bind(transaction_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            error!("Failed to update transaction status: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    } else {
        // Admin doesn't exist in admin_users, update without created_by
        sqlx::query(
            r#"
            UPDATE transactions
            SET status = 'rejected'::transaction_status,
                rejection_reason = $1,
                updated_at = $2
            WHERE id = $3
            "#
        )
        .bind(req.reason.as_deref())
        .bind(now)
        .bind(transaction_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            error!("Failed to update transaction status: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    info!("Transaction rejected: transaction_id={}, admin_id={}", transaction_id, admin_id);

    Ok(Json(ApproveTransactionResponse {
        status: "rejected".to_string(),
        message: format!("Transaction {} rejected", transaction_id),
    }))
}

pub fn create_finance_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/overview", get(get_finance_overview))
        .route("/transactions", get(list_transactions))
        .route("/transactions/:id/approve", post(approve_transaction))
        .route("/transactions/:id/reject", post(reject_transaction))
        .route("/wallets", get(list_wallets))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_finance_overview(State(pool): State<PgPool>) -> Result<Json<FinanceOverviewResponse>, StatusCode> {
    // Total balances (sum of all available balances)
    let total_balances: Option<Decimal> = sqlx::query_scalar(
        "SELECT COALESCE(SUM(available_balance), 0) FROM wallets"
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get total balances: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Pending deposits
    let pending_deposits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transactions WHERE type = 'deposit'::transaction_type AND status = 'pending'::transaction_status"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get pending deposits: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Pending withdrawals
    let pending_withdrawals: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM transactions WHERE type = 'withdrawal'::transaction_type AND status = 'pending'::transaction_status"
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get pending withdrawals: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Net fees today (fees - rebates)
    let net_fees_today: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT COALESCE(
            SUM(CASE 
                WHEN type = 'fee'::transaction_type THEN -net_amount
                WHEN type = 'rebate'::transaction_type THEN net_amount
                ELSE 0
            END), 0
        )
        FROM transactions
        WHERE (type = 'fee'::transaction_type OR type = 'rebate'::transaction_type)
        AND status IN ('approved'::transaction_status, 'completed'::transaction_status)
        AND DATE(created_at) = CURRENT_DATE
        "#
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get net fees today: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Deposits today
    let deposits_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::bigint
        FROM transactions
        WHERE type = 'deposit'::transaction_type
        AND status IN ('approved'::transaction_status, 'completed'::transaction_status)
        AND DATE(created_at) = CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get deposits count today: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let deposits_amount: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(net_amount), 0)
        FROM transactions
        WHERE type = 'deposit'::transaction_type
        AND status IN ('approved'::transaction_status, 'completed'::transaction_status)
        AND DATE(created_at) = CURRENT_DATE
        "#
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get deposits amount today: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Withdrawals today
    let withdrawals_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::bigint
        FROM transactions
        WHERE type = 'withdrawal'::transaction_type
        AND status IN ('approved'::transaction_status, 'completed'::transaction_status)
        AND DATE(created_at) = CURRENT_DATE
        "#
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get withdrawals count today: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let withdrawals_amount: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(net_amount), 0)
        FROM transactions
        WHERE type = 'withdrawal'::transaction_type
        AND status IN ('approved'::transaction_status, 'completed'::transaction_status)
        AND DATE(created_at) = CURRENT_DATE
        "#
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get withdrawals amount today: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(FinanceOverviewResponse {
        total_balances: total_balances.unwrap_or(Decimal::ZERO),
        pending_deposits,
        pending_withdrawals,
        net_fees_today: net_fees_today.unwrap_or(Decimal::ZERO),
        deposits_today: DepositWithdrawalStats {
            count: deposits_count,
            amount: deposits_amount.unwrap_or(Decimal::ZERO),
        },
        withdrawals_today: DepositWithdrawalStats {
            count: withdrawals_count,
            amount: withdrawals_amount.unwrap_or(Decimal::ZERO),
        },
    }))
}

async fn list_transactions(
    State(pool): State<PgPool>,
    Query(params): Query<ListTransactionsQuery>,
) -> Result<Json<Vec<TransactionResponse>>, StatusCode> {
    // Fetch all transactions (with a reasonable limit) and filter in memory
    // This can be optimized later with proper SQL query building
    let transactions = sqlx::query_as::<_, TransactionResponse>(
        r#"
        SELECT 
            t.id,
            t.user_id,
            u.email as user_email,
            u.first_name as user_first_name,
            u.last_name as user_last_name,
            t.type::text as type,
            t.amount,
            t.currency,
            t.fee,
            t.net_amount,
            t.method::text as method,
            t.status::text as status,
            t.reference,
            t.method_details,
            t.admin_notes,
            t.rejection_reason,
            t.created_at,
            t.updated_at,
            t.completed_at
        FROM transactions t
        JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC
        LIMIT 1000
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list transactions: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Apply filters in memory
    let mut filtered: Vec<TransactionResponse> = transactions.into_iter().filter(|tx| {
        if let Some(search) = &params.search {
            if !search.is_empty() {
                let search_lower = search.to_lowercase();
                if !tx.user_email.to_lowercase().contains(&search_lower)
                    && !tx.id.to_string().contains(&search_lower)
                    && !tx.reference.to_lowercase().contains(&search_lower)
                {
                    return false;
                }
            }
        }
        if let Some(tx_type) = &params.r#type {
            if tx_type != "all" && tx.r#type != *tx_type {
                return false;
            }
        }
        if let Some(status) = &params.status {
            if status != "all" && tx.status != *status {
                return false;
            }
        }
        if let Some(currency) = &params.currency {
            if currency != "all" && tx.currency != *currency {
                return false;
            }
        }
        if let Some(date_from) = &params.date_from {
            if !date_from.is_empty() {
                let tx_date = tx.created_at.date_naive().to_string();
                if tx_date < *date_from {
                    return false;
                }
            }
        }
        if let Some(date_to) = &params.date_to {
            if !date_to.is_empty() {
                let tx_date = tx.created_at.date_naive().to_string();
                if tx_date > *date_to {
                    return false;
                }
            }
        }
        true
    }).collect();

    // Apply pagination
    let offset = ((params.page - 1) * params.page_size) as usize;
    let end = (offset + params.page_size as usize).min(filtered.len());
    if offset < filtered.len() {
        filtered = filtered[offset..end].to_vec();
    } else {
        filtered = vec![];
    }

    Ok(Json(filtered))
}

async fn list_wallets(
    State(pool): State<PgPool>,
    Query(params): Query<ListWalletsQuery>,
) -> Result<Json<Vec<WalletResponse>>, StatusCode> {
    let wallets = sqlx::query_as::<_, WalletResponse>(
        r#"
        SELECT 
            w.id,
            w.user_id,
            u.email as user_email,
            u.first_name as user_first_name,
            u.last_name as user_last_name,
            w.wallet_type::text as wallet_type,
            w.currency,
            w.available_balance as available_balance,
            w.locked_balance as locked_balance,
            (w.available_balance + w.locked_balance) as equity,
            w.updated_at
        FROM wallets w
        JOIN users u ON w.user_id = u.id
        ORDER BY w.updated_at DESC
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list wallets: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Apply filters in memory
    let filtered: Vec<WalletResponse> = wallets.into_iter().filter(|wallet| {
        if let Some(search) = &params.search {
            if !search.is_empty() {
                let search_lower = search.to_lowercase();
                if !wallet.user_email.to_lowercase().contains(&search_lower)
                    && !wallet.user_id.to_string().contains(&search_lower)
                {
                    return false;
                }
            }
        }
        if let Some(wallet_type) = &params.wallet_type {
            if wallet_type != "all" && wallet.wallet_type != *wallet_type {
                return false;
            }
        }
        if let Some(currency) = &params.currency {
            if currency != "all" && wallet.currency != *currency {
                return false;
            }
        }
        if let Some(balance_min) = params.balance_min {
            let min_decimal = Decimal::try_from(balance_min).unwrap_or(Decimal::ZERO);
            if wallet.available_balance < min_decimal {
                return false;
            }
        }
        if let Some(balance_max) = params.balance_max {
            let max_decimal = Decimal::try_from(balance_max).unwrap_or(Decimal::ZERO);
            if wallet.available_balance > max_decimal {
                return false;
            }
        }
        true
    }).collect();

    Ok(Json(filtered))
}

