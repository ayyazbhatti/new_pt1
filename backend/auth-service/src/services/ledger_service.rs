use anyhow::{Context, Result};
use chrono::Utc;
use rust_decimal::Decimal;
use serde_json::json;
use sqlx::{PgPool, Row};
use tracing::info;
use uuid::Uuid;

/// Get or create a wallet for a user
pub async fn get_or_create_wallet(
    pool: &PgPool,
    user_id: Uuid,
    currency: &str,
    wallet_type: &str,
) -> Result<Uuid> {
    // First try to get existing wallet
    let wallet_result = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id FROM wallets
        WHERE user_id = $1 AND currency = $2 AND wallet_type = $3::wallet_type
        "#,
    )
    .bind(user_id)
    .bind(currency)
    .bind(wallet_type)
    .fetch_optional(pool)
    .await
    .with_context(|| format!("Failed to query wallet for user_id={}, currency={}, wallet_type={}", user_id, currency, wallet_type))?;

    if let Some(wallet_id) = wallet_result {
        return Ok(wallet_id);
    }

    // Create new wallet if it doesn't exist
    let wallet_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO wallets (id, user_id, wallet_type, currency, available_balance, locked_balance, created_at, updated_at)
        VALUES ($1, $2, $3::wallet_type, $4, 0, 0, NOW(), NOW())
        "#,
    )
    .bind(wallet_id)
    .bind(user_id)
    .bind(wallet_type)
    .bind(currency)
    .execute(pool)
    .await
    .context("Failed to create wallet")?;

    info!("Created new wallet: wallet_id={}, user_id={}, currency={}, type={}", 
          wallet_id, user_id, currency, wallet_type);
    
    Ok(wallet_id)
}

/// Create a ledger entry and update wallet balance.
///
/// When `skip_mirror_transaction` is **true**, no row is inserted into `transactions` (the caller
/// already has the canonical `transactions` row, e.g. finance approval or direct deposit).
/// When **false** (default for most callers), inserts a matching `transactions` row for user-facing audit.
pub async fn create_ledger_entry(
    pool: &PgPool,
    wallet_id: Uuid,
    transaction_type: &str,
    delta: Decimal,
    ref_id: &str,
    description: Option<&str>,
    skip_mirror_transaction: bool,
) -> Result<()> {
    // Get current wallet balance
    let balance_row = sqlx::query(
        r#"
        SELECT available_balance FROM wallets WHERE id = $1
        "#,
    )
    .bind(wallet_id)
    .fetch_optional(pool)
    .await
    .context("Failed to get wallet balance")?;

    let current_balance = if let Some(row) = balance_row {
        row.try_get::<Decimal, _>(0)
            .context("Failed to parse balance")?
    } else {
        return Err(anyhow::anyhow!("Wallet not found: {}", wallet_id));
    };

    let balance_after = current_balance + delta;

    // Create ledger entry
    let ledger_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO ledger_entries (id, wallet_id, type, delta, balance_after, ref, description, created_at)
        VALUES ($1, $2, $3::transaction_type, $4, $5, $6, $7, NOW())
        "#,
    )
    .bind(ledger_id)
    .bind(wallet_id)
    .bind(transaction_type)
    .bind(delta)
    .bind(balance_after)
    .bind(ref_id)
    .bind(description)
    .execute(pool)
    .await
    .context("Failed to create ledger entry")?;

    if !skip_mirror_transaction {
        let wallet_meta = sqlx::query(
            r#"SELECT user_id, currency FROM wallets WHERE id = $1"#,
        )
        .bind(wallet_id)
        .fetch_optional(pool)
        .await
        .context("Failed to read wallet for transactions mirror")?;

        let (user_id, currency): (Uuid, String) = if let Some(row) = wallet_meta {
            (row.try_get(0)?, row.try_get(1)?)
        } else {
            return Err(anyhow::anyhow!("Wallet not found for mirror: {}", wallet_id));
        };

        let tx_row_id = Uuid::new_v4();
        let now = Utc::now();
        let mirror_reference = format!("LEDGER-{}", ledger_id);
        let amount_abs = delta.abs();
        sqlx::query(
            r#"
            INSERT INTO transactions (
                id, user_id, type, amount, currency, fee, net_amount, method, status, reference, method_details, created_at, updated_at, completed_at
            )
            VALUES (
                $1, $2, $3::transaction_type, $4, $5, 0, $6, 'manual'::transaction_method, 'completed'::transaction_status, $7, $8, $9, $10, $9
            )
            "#,
        )
        .bind(tx_row_id)
        .bind(user_id)
        .bind(transaction_type)
        .bind(amount_abs)
        .bind(currency)
        .bind(delta)
        .bind(mirror_reference)
        .bind(json!({
            "ledgerEntryId": ledger_id.to_string(),
            "ledgerRef": ref_id,
            "description": description,
        }))
        .bind(now)
        .bind(now)
        .execute(pool)
        .await
        .context("Failed to insert transactions mirror for ledger entry")?;
    }

    // Update wallet balance
    sqlx::query(
        r#"
        UPDATE wallets 
        SET available_balance = $1, updated_at = NOW()
        WHERE id = $2
        "#,
    )
    .bind(balance_after)
    .bind(wallet_id)
    .execute(pool)
    .await
    .context("Failed to update wallet balance")?;

    info!("Created ledger entry: ledger_id={}, wallet_id={}, delta={}, balance_after={}, ref={}", 
          ledger_id, wallet_id, delta, balance_after, ref_id);

    Ok(())
}

/// Get wallet balance
pub async fn get_wallet_balance(
    pool: &PgPool,
    wallet_id: Uuid,
) -> Result<Decimal> {
    let balance = sqlx::query_scalar::<_, Decimal>(
        r#"
        SELECT available_balance FROM wallets WHERE id = $1
        "#,
    )
    .bind(wallet_id)
    .fetch_optional(pool)
    .await
    .context("Failed to get wallet balance")?
    .ok_or_else(|| anyhow::anyhow!("Wallet not found: {}", wallet_id))?;

    Ok(balance)
}

