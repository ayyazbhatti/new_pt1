//! Swap settlement on position close: one `transactions` row + wallet debit for accrued `accumulated_swap_usd`.
//! Rollover only accrues on the position row (Phase 3.5); cash moves here (Phase 4).

use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Idempotent per `position_id` via stable `transactions.reference` (`SWAP-SETTLE-{position_id}`).
/// Debits spot USD `available_balance` by `accumulated_swap_usd` (positive accrual = cost to user).
pub async fn settle_swap_on_closed_position(
    pool: &PgPool,
    user_id: Uuid,
    position_id: Uuid,
) -> Result<(), sqlx::Error> {
    let reference = format!("SWAP-SETTLE-{}", position_id);

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM transactions WHERE reference = $1)",
    )
    .bind(&reference)
    .fetch_one(pool)
    .await?;
    if exists {
        return Ok(());
    }

    let acc: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT accumulated_swap_usd
        FROM positions
        WHERE id = $1
          AND user_id = $2
          AND (status = 'closed'::position_status OR status = 'liquidated'::position_status)
        "#,
    )
    .bind(position_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .flatten();

    let Some(acc) = acc else {
        return Ok(());
    };
    if acc.is_zero() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    let exists_tx: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM transactions WHERE reference = $1)",
    )
    .bind(&reference)
    .fetch_one(&mut *tx)
    .await?;
    if exists_tx {
        tx.rollback().await.ok();
        return Ok(());
    }

    let now = Utc::now();
    let tx_id = Uuid::new_v4();
    let amount = -acc;
    let meta = serde_json::json!({
        "kind": "swap_settlement",
        "position_id": position_id,
        "accumulated_swap_usd": acc.to_string(),
    });

    sqlx::query(
        r#"
        INSERT INTO transactions (
            id, user_id, type, amount, currency, fee, net_amount, method, status, reference, method_details, created_at, updated_at, completed_at
        )
        VALUES (
            $1, $2, 'swap'::transaction_type, $3, 'USD', 0, $3, 'manual'::transaction_method, 'completed'::transaction_status, $4, $5, $6, $7, $8
        )
        "#,
    )
    .bind(tx_id)
    .bind(user_id)
    .bind(amount)
    .bind(&reference)
    .bind(&meta)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    let rows = sqlx::query(
        r#"
        UPDATE wallets SET
            available_balance = available_balance - $1,
            updated_at = NOW()
        WHERE user_id = $2 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
          AND available_balance >= $1
        "#,
    )
    .bind(acc)
    .bind(user_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if rows == 0 {
        tx.rollback().await.ok();
        tracing::warn!(
            user_id = %user_id,
            position_id = %position_id,
            accumulated_swap_usd = %acc,
            "swap_settlement: insufficient USD wallet balance; settlement skipped"
        );
        return Ok(());
    }

    tx.commit().await?;
    Ok(())
}
