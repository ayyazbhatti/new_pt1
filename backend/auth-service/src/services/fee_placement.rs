//! Charge placement fee in a DB transaction; refund on engine rejection.

use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::services::fee_engine::ResolvedFee;

async fn insert_fee_tx_row(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    fee_tx_id: Uuid,
    amount: Decimal,
    net_amount: Decimal,
    reference: &str,
    method_details: serde_json::Value,
) -> Result<(), sqlx::Error> {
    let now = Utc::now();
    sqlx::query(
        r#"
        INSERT INTO transactions (
            id, user_id, type, amount, currency, fee, net_amount, method, status, reference, method_details, created_at, updated_at, completed_at
        )
        VALUES (
            $1, $2, 'fee'::transaction_type, $3, 'USD', 0, $4, 'manual'::transaction_method, 'completed'::transaction_status, $5, $6, $7, $8, $9
        )
        "#,
    )
    .bind(fee_tx_id)
    .bind(user_id)
    .bind(amount)
    .bind(net_amount)
    .bind(reference)
    .bind(method_details)
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(tx.as_mut())
    .await?;
    Ok(())
}

/// Deduct placement fee from spot USD wallet, insert `transactions` + `fee_charge_log`. No-op if `fee_amount` is zero.
pub async fn charge_placement_fee_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    order_id: Uuid,
    fee_amount_usd: Decimal,
    notional_usd: Decimal,
    rule: &ResolvedFee,
    symbol: &str,
) -> Result<(), sqlx::Error> {
    if fee_amount_usd <= Decimal::ZERO {
        return Ok(());
    }

    let rows = sqlx::query(
        r#"
        UPDATE wallets SET
            available_balance = available_balance - $1,
            updated_at = NOW()
        WHERE user_id = $2 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
          AND available_balance >= $1
        "#,
    )
    .bind(fee_amount_usd)
    .bind(user_id)
    .execute(tx.as_mut())
    .await?
    .rows_affected();

    if rows == 0 {
        return Err(sqlx::Error::RowNotFound);
    }

    let fee_tx_id = Uuid::new_v4();
    let reference = format!("FEE-ORDER-{}", order_id);
    insert_fee_tx_row(
        tx,
        user_id,
        fee_tx_id,
        -fee_amount_usd,
        -fee_amount_usd,
        &reference,
        serde_json::json!({
            "order_id": order_id,
            "symbol": symbol,
            "fee_percent": rule.fee_percent,
            "notional_usd": notional_usd,
            "fee_rule_id": rule.rule_id,
        }),
    )
    .await?;

    let log_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO fee_charge_log
            (id, user_id, order_id, position_id, fee_rule_id, transaction_id, notional_usd, fee_percent_applied, fee_amount_usd)
        VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(log_id)
    .bind(user_id)
    .bind(order_id)
    .bind(rule.rule_id)
    .bind(fee_tx_id)
    .bind(notional_usd)
    .bind(rule.fee_percent)
    .bind(fee_amount_usd)
    .execute(tx.as_mut())
    .await?;

    Ok(())
}

/// Refund placement fee when an order is rejected (idempotent via `fee_charge_log.refunded`).
pub async fn refund_placement_fee_for_order(pool: &PgPool, user_id: Uuid, order_id: Uuid) -> Result<bool, sqlx::Error> {
    let row: Option<(Uuid, Decimal, bool)> = sqlx::query_as(
        r#"SELECT id, fee_amount_usd, refunded FROM fee_charge_log WHERE order_id = $1 LIMIT 1"#,
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await?;

    let Some((fee_log_id, fee_amount, refunded)) = row else {
        return Ok(false);
    };
    if refunded || fee_amount <= Decimal::ZERO {
        return Ok(false);
    }

    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        UPDATE wallets SET
            available_balance = available_balance + $1,
            updated_at = NOW()
        WHERE user_id = $2 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
        "#,
    )
    .bind(fee_amount)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    let refund_tx_id = Uuid::new_v4();
    let reference = format!("FEE-REFUND-{}", refund_tx_id);
    insert_fee_tx_row(
        &mut tx,
        user_id,
        refund_tx_id,
        fee_amount,
        fee_amount,
        &reference,
        serde_json::json!({ "order_id": order_id, "refund": true }),
    )
    .await?;

    sqlx::query(
        r#"
        UPDATE fee_charge_log SET refunded = true, refunded_at = NOW(), refund_transaction_id = $1
        WHERE id = $2 AND refunded = false
        "#,
    )
    .bind(refund_tx_id)
    .bind(fee_log_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(true)
}

/// After a fill is persisted, attribute the placement fee row to the open position for that symbol,
/// or the most recently closed position if the fill closed flat (no open leg).
pub async fn link_placement_fee_to_position_on_fill(
    pool: &PgPool,
    user_id: Uuid,
    order_id: Uuid,
) -> Result<(), sqlx::Error> {
    let row: Option<(Uuid, Decimal)> = sqlx::query_as(
        r#"
        SELECT id, fee_amount_usd
        FROM fee_charge_log
        WHERE order_id = $1 AND refunded = false AND position_id IS NULL
        "#,
    )
    .bind(order_id)
    .fetch_optional(pool)
    .await?;

    let Some((log_id, fee_amt)) = row else {
        return Ok(());
    };
    if fee_amt <= Decimal::ZERO {
        return Ok(());
    }

    let symbol_id: Option<Uuid> =
        sqlx::query_scalar("SELECT symbol_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(pool)
            .await?
            .flatten();

    let Some(symbol_id) = symbol_id else {
        return Ok(());
    };

    let open_pid: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id FROM positions
        WHERE user_id = $1 AND symbol_id = $2 AND status = 'open'::position_status
        ORDER BY updated_at DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .bind(symbol_id)
    .fetch_optional(pool)
    .await?
    .flatten();

    let position_id = if let Some(pid) = open_pid {
        Some(pid)
    } else {
        sqlx::query_scalar(
            r#"
            SELECT id FROM positions
            WHERE user_id = $1 AND symbol_id = $2
              AND (status = 'closed'::position_status OR status = 'liquidated'::position_status)
            ORDER BY closed_at DESC NULLS LAST, updated_at DESC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .bind(symbol_id)
        .fetch_optional(pool)
        .await?
        .flatten()
    };

    let Some(position_id) = position_id else {
        return Ok(());
    };

    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE positions
        SET accumulated_fees_usd = accumulated_fees_usd + $1, updated_at = NOW()
        WHERE id = $2
        "#,
    )
    .bind(fee_amt)
    .bind(position_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE fee_charge_log SET position_id = $1 WHERE id = $2 AND position_id IS NULL",
    )
    .bind(position_id)
    .bind(log_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Safety net: rejected orders with charged, unrefunded fees (older than `min_age`).
pub async fn scan_and_refund_stale_rejected_fees(
    pool: &PgPool,
    min_age: std::time::Duration,
) -> Result<usize, sqlx::Error> {
    let cutoff = chrono::Utc::now() - min_age;
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"
        SELECT fcl.user_id, fcl.order_id
        FROM fee_charge_log fcl
        INNER JOIN orders o ON o.id = fcl.order_id
        WHERE fcl.refunded = false
          AND fcl.fee_amount_usd > 0
          AND o.status = 'rejected'::order_status
          AND o.updated_at < $1
        LIMIT 200
        "#,
    )
    .bind(cutoff)
    .fetch_all(pool)
    .await?;

    let mut n = 0usize;
    for (uid, oid) in rows {
        if refund_placement_fee_for_order(pool, uid, oid).await.unwrap_or(false) {
            n += 1;
        }
    }
    Ok(n)
}
