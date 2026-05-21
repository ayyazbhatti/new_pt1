//! Bonus balance, margin allocation (cash first), and PnL routing on position close.
//! All wallet mutations use explicit DB transactions.

use chrono::Utc;
use rust_decimal::Decimal;
use sqlx::{PgPool, Postgres, Transaction};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct BonusState {
    pub balance: Decimal,
    pub locked: Decimal,
    pub revokable: Decimal,
}

#[derive(Debug, Clone)]
pub struct MarginAllocation {
    pub from_cash: Decimal,
    pub from_bonus: Decimal,
}

#[derive(Debug, Error)]
pub enum BonusError {
    #[error("insufficient revokable bonus: max {revokable}")]
    InsufficientRevokable { revokable: Decimal },
    #[error("insufficient margin for lock")]
    InsufficientMargin,
    #[error("invalid amount")]
    InvalidAmount,
    #[error("order margin snapshot not found")]
    OrderSnapshotMissing,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

async fn ensure_spot_usd_wallet(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
) -> Result<Uuid, sqlx::Error> {
    let id: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT id FROM wallets
        WHERE user_id = $1 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
        FOR UPDATE
        "#,
    )
    .bind(user_id)
    .fetch_optional(tx.as_mut())
    .await?;

    if let Some(wid) = id {
        return Ok(wid);
    }

    let wid = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO wallets (id, user_id, wallet_type, currency, available_balance, locked_balance, bonus_balance, bonus_locked, created_at, updated_at)
        VALUES ($1, $2, 'spot'::wallet_type, 'USD', 0, 0, 0, 0, NOW(), NOW())
        ON CONFLICT (user_id, wallet_type, currency) DO NOTHING
        "#,
    )
    .bind(wid)
    .bind(user_id)
    .execute(tx.as_mut())
    .await?;

    let wid: Uuid = sqlx::query_scalar(
        r#"
        SELECT id FROM wallets
        WHERE user_id = $1 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
        FOR UPDATE
        "#,
    )
    .bind(user_id)
    .fetch_one(tx.as_mut())
    .await?;

    Ok(wid)
}

async fn insert_bonus_transaction(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    kind: &str,
    amount: Decimal,
    net_amount: Decimal,
    reference: &str,
    method_details: serde_json::Value,
) -> Result<(), sqlx::Error> {
    let tid = Uuid::new_v4();
    let now = Utc::now();
    sqlx::query(
        r#"
        INSERT INTO transactions (
            id, user_id, type, amount, currency, fee, net_amount, method, status, reference, method_details, created_at, updated_at, completed_at
        )
        VALUES (
            $1, $2, $3::transaction_type, $4, 'USD', 0, $5, 'manual'::transaction_method, 'completed'::transaction_status, $6, $7, $8, $9, $9
        )
        "#,
    )
    .bind(tid)
    .bind(user_id)
    .bind(kind)
    .bind(amount)
    .bind(net_amount)
    .bind(reference)
    .bind(method_details)
    .bind(now)
    .bind(now)
    .execute(tx.as_mut())
    .await?;
    Ok(())
}

pub async fn get_user_bonus(pool: &PgPool, user_id: Uuid) -> Result<BonusState, sqlx::Error> {
    let row: Option<(Decimal, Decimal)> = sqlx::query_as(
        r#"
        SELECT COALESCE(bonus_balance, 0), COALESCE(bonus_locked, 0)
        FROM wallets
        WHERE user_id = $1 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let (balance, locked) = row.unwrap_or((Decimal::ZERO, Decimal::ZERO));
    let revokable = (balance - locked).max(Decimal::ZERO);
    Ok(BonusState {
        balance,
        locked,
        revokable,
    })
}

pub async fn grant_bonus(
    pool: &PgPool,
    user_id: Uuid,
    admin_user_id: Uuid,
    amount: Decimal,
    note: Option<String>,
) -> Result<Decimal, BonusError> {
    if amount <= Decimal::ZERO {
        return Err(BonusError::InvalidAmount);
    }

    let mut tx = pool.begin().await?;
    ensure_spot_usd_wallet(&mut tx, user_id).await?;

    sqlx::query(
        r#"
        UPDATE wallets
        SET bonus_balance = bonus_balance + $1, updated_at = NOW()
        WHERE user_id = $2 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'
        "#,
    )
    .bind(amount)
    .bind(user_id)
    .execute(tx.as_mut())
    .await?;

    let new_bal: Decimal = sqlx::query_scalar(
        r#"SELECT bonus_balance FROM wallets WHERE user_id = $1 AND wallet_type = 'spot'::wallet_type AND currency = 'USD'"#,
    )
    .bind(user_id)
    .fetch_one(tx.as_mut())
    .await?;

    let reference = format!("BONUS-GRANT-{}", Uuid::new_v4());
    let details = serde_json::json!({
        "note": note,
        "adminUserId": admin_user_id.to_string(),
    });
    insert_bonus_transaction(
        &mut tx,
        user_id,
        "bonus_grant",
        amount,
        amount,
        &reference,
        details,
    )
    .await?;

    tx.commit().await?;
    Ok(new_bal)
}

pub async fn revoke_bonus(
    pool: &PgPool,
    user_id: Uuid,
    admin_user_id: Uuid,
    amount: Decimal,
    note: Option<String>,
) -> Result<Decimal, BonusError> {
    if amount <= Decimal::ZERO {
        return Err(BonusError::InvalidAmount);
    }

    let mut tx = pool.begin().await?;
    let wid = ensure_spot_usd_wallet(&mut tx, user_id).await?;

    let (bonus_balance, bonus_locked): (Decimal, Decimal) = sqlx::query_as(
        r#"SELECT bonus_balance, bonus_locked FROM wallets WHERE id = $1 FOR UPDATE"#,
    )
    .bind(wid)
    .fetch_one(tx.as_mut())
    .await?;

    let revokable = (bonus_balance - bonus_locked).max(Decimal::ZERO);
    if amount > revokable {
        return Err(BonusError::InsufficientRevokable { revokable });
    }

    sqlx::query(
        r#"UPDATE wallets SET bonus_balance = bonus_balance - $1, updated_at = NOW() WHERE id = $2"#,
    )
    .bind(amount)
    .bind(wid)
    .execute(tx.as_mut())
    .await?;

    let new_bal: Decimal = sqlx::query_scalar(r#"SELECT bonus_balance FROM wallets WHERE id = $1"#)
        .bind(wid)
        .fetch_one(tx.as_mut())
        .await?;

    let reference = format!("BONUS-REVOKE-{}", Uuid::new_v4());
    let details = serde_json::json!({
        "note": note,
        "adminUserId": admin_user_id.to_string(),
    });
    insert_bonus_transaction(
        &mut tx,
        user_id,
        "bonus_revoke",
        amount,
        -amount,
        &reference,
        details,
    )
    .await?;

    tx.commit().await?;
    Ok(new_bal)
}

pub async fn lock_margin(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    margin_required: Decimal,
) -> Result<MarginAllocation, BonusError> {
    if margin_required <= Decimal::ZERO {
        return Err(BonusError::InvalidAmount);
    }

    let wid = ensure_spot_usd_wallet(tx, user_id).await?;

    let (available_balance, locked_balance, bonus_balance, bonus_locked): (Decimal, Decimal, Decimal, Decimal) =
        sqlx::query_as(
            r#"
            SELECT available_balance, locked_balance, bonus_balance, bonus_locked
            FROM wallets WHERE id = $1 FOR UPDATE
            "#,
        )
        .bind(wid)
        .fetch_one(tx.as_mut())
        .await?;

    let available_cash = available_balance.max(Decimal::ZERO);
    let available_bonus = (bonus_balance - bonus_locked).max(Decimal::ZERO);

    let margin_from_cash = margin_required.min(available_cash);
    let margin_from_bonus = margin_required - margin_from_cash;

    if margin_from_bonus > available_bonus {
        return Err(BonusError::InsufficientMargin);
    }

    sqlx::query(
        r#"
        UPDATE wallets SET
            available_balance = available_balance - $1,
            locked_balance = locked_balance + $1,
            bonus_locked = bonus_locked + $2,
            updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(margin_from_cash)
    .bind(margin_from_bonus)
    .bind(wid)
    .execute(tx.as_mut())
    .await?;

    if margin_from_bonus > Decimal::ZERO {
        let reference = format!("BONUS-MLOCK-{}", Uuid::new_v4());
        insert_bonus_transaction(
            tx,
            user_id,
            "bonus_margin_lock",
            margin_from_bonus,
            Decimal::ZERO,
            &reference,
            serde_json::json!({ "walletId": wid.to_string() }),
        )
        .await?;
    }

    Ok(MarginAllocation {
        from_cash: margin_from_cash,
        from_bonus: margin_from_bonus,
    })
}

/// Reverse a pending order's margin lock (cancel / reject before fill consumes it as position margin).
pub async fn rollback_order_margin_lock(pool: &PgPool, user_id: Uuid, order_id: Uuid) -> Result<(), BonusError> {
    let row: Option<(Decimal, Decimal)> = sqlx::query_as(
        r#"SELECT margin_from_cash, margin_from_bonus FROM orders WHERE id = $1 AND user_id = $2"#,
    )
    .bind(order_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some((m_cash, m_bonus)) = row else {
        return Err(BonusError::OrderSnapshotMissing);
    };

    if m_cash.is_zero() && m_bonus.is_zero() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;
    let wid = ensure_spot_usd_wallet(&mut tx, user_id).await?;

    sqlx::query(
        r#"
        UPDATE wallets SET
            available_balance = available_balance + $1,
            locked_balance = locked_balance - $1,
            bonus_locked = bonus_locked - $2,
            updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(m_cash)
    .bind(m_bonus)
    .bind(wid)
    .execute(tx.as_mut())
    .await?;

    if m_bonus > Decimal::ZERO {
        let reference = format!("BONUS-MREL-{}", Uuid::new_v4());
        insert_bonus_transaction(
            &mut tx,
            user_id,
            "bonus_margin_release",
            m_bonus,
            Decimal::ZERO,
            &reference,
            serde_json::json!({ "orderId": order_id.to_string(), "reason": "order_cancelled" }),
        )
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn release_and_apply_pnl(
    tx: &mut Transaction<'_, Postgres>,
    position_id: Uuid,
    user_id: Uuid,
    margin_from_cash: Decimal,
    margin_from_bonus: Decimal,
    realized_pnl: Decimal,
) -> Result<(), BonusError> {
    let released: Option<bool> = sqlx::query_scalar(
        r#"SELECT COALESCE(bonus_wallet_released, false) FROM positions WHERE id = $1 AND user_id = $2 FOR UPDATE"#,
    )
    .bind(position_id)
    .bind(user_id)
    .fetch_optional(tx.as_mut())
    .await?;

    let Some(released) = released else {
        return Ok(());
    };
    if released {
        return Ok(());
    }

    let wid = ensure_spot_usd_wallet(tx, user_id).await?;

    // 1) Release locked margin
    sqlx::query(
        r#"
        UPDATE wallets SET
            locked_balance = locked_balance - $1,
            bonus_locked = bonus_locked - $2,
            available_balance = available_balance + $1,
            updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(margin_from_cash)
    .bind(margin_from_bonus)
    .bind(wid)
    .execute(tx.as_mut())
    .await?;

    if margin_from_bonus > Decimal::ZERO {
        let reference = format!("BONUS-MREL-{}", Uuid::new_v4());
        insert_bonus_transaction(
            tx,
            user_id,
            "bonus_margin_release",
            margin_from_bonus,
            Decimal::ZERO,
            &reference,
            serde_json::json!({ "positionId": position_id.to_string() }),
        )
        .await?;
    }

    let mut bonus_absorb = Decimal::ZERO;
    if realized_pnl < Decimal::ZERO {
        let loss = realized_pnl.abs();
        let (bonus_balance, bonus_locked): (Decimal, Decimal) = sqlx::query_as(
            r#"SELECT bonus_balance, bonus_locked FROM wallets WHERE id = $1 FOR UPDATE"#,
        )
        .bind(wid)
        .fetch_one(tx.as_mut())
        .await?;

        let consumable_bonus = (bonus_balance - bonus_locked).max(Decimal::ZERO);
        bonus_absorb = loss.min(consumable_bonus);

        if bonus_absorb > Decimal::ZERO {
            sqlx::query(r#"UPDATE wallets SET bonus_balance = bonus_balance - $1, updated_at = NOW() WHERE id = $2"#)
                .bind(bonus_absorb)
                .bind(wid)
                .execute(tx.as_mut())
                .await?;

            let reference = format!("BONUS-LOSS-{}", Uuid::new_v4());
            insert_bonus_transaction(
                tx,
                user_id,
                "bonus_loss_absorb",
                bonus_absorb,
                -bonus_absorb,
                &reference,
                serde_json::json!({ "positionId": position_id.to_string() }),
            )
            .await?;
        }

        let cash_loss = loss - bonus_absorb;
        if cash_loss > Decimal::ZERO {
            sqlx::query(r#"UPDATE wallets SET available_balance = available_balance - $1, updated_at = NOW() WHERE id = $2"#)
                .bind(cash_loss)
                .bind(wid)
                .execute(tx.as_mut())
                .await?;

            let reference = format!("PNL-DEBIT-{}", Uuid::new_v4());
            insert_bonus_transaction(
                tx,
                user_id,
                "pnl_debit",
                cash_loss,
                -cash_loss,
                &reference,
                serde_json::json!({
                    "positionId": position_id.to_string(),
                    "note": "cash portion of realized loss after bonus absorb"
                }),
            )
            .await?;
        }
    } else if realized_pnl > Decimal::ZERO {
        sqlx::query(r#"UPDATE wallets SET available_balance = available_balance + $1, updated_at = NOW() WHERE id = $2"#)
            .bind(realized_pnl)
            .bind(wid)
            .execute(tx.as_mut())
            .await?;

        let reference = format!("PNL-CREDIT-{}", Uuid::new_v4());
        insert_bonus_transaction(
            tx,
            user_id,
            "pnl_credit",
            realized_pnl,
            realized_pnl,
            &reference,
            serde_json::json!({ "positionId": position_id.to_string() }),
        )
        .await?;
    }

    sqlx::query(
        r#"UPDATE positions SET bonus_loss_absorbed = $1, bonus_wallet_released = TRUE, updated_at = NOW() WHERE id = $2 AND user_id = $3"#,
    )
    .bind(bonus_absorb)
    .bind(position_id)
    .bind(user_id)
    .execute(tx.as_mut())
    .await?;

    Ok(())
}
