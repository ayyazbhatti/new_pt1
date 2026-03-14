//! Affiliate commission accrual: when a referred user's deposit is approved,
//! accrue commission for the referrer (affiliate) using level-1 commission % from affiliate_commission_layers.
//! Uses `users.referred_by_user_id` for the referral link; ensures an `affiliates` row exists for the referrer
//! so that `affiliate_commissions` can be inserted (it references affiliates.id).
//! Commission is paid immediately into the referrer's wallet (rebate ledger entry) and marked completed.

use crate::services::ledger_service;
use rust_decimal::Decimal;
use sqlx::PgPool;
use tracing::{error, info};
use uuid::Uuid;

/// Accrue affiliate commission when a referred user's deposit is approved.
/// Called from approve_deposit, create_direct_deposit, and finance approve_transaction.
/// - If the depositing user has no referrer (referred_by_user_id is null), this is a no-op.
/// - Resolves referrer → gets or creates affiliates row → gets level 1 commission % → inserts affiliate_commissions,
///   credits referrer's wallet (rebate), and marks commission completed.
/// Returns Ok(Some(referrer_user_id)) when commission was paid (caller can publish balance update for referrer), Ok(None) otherwise.
pub async fn accrue_commission_on_deposit(
    pool: &PgPool,
    referred_user_id: Uuid,
    deposit_amount: Decimal,
    currency: &str,
    transaction_id: Uuid,
) -> Result<Option<Uuid>, String> {
    // 1) Who referred this user?
    let referrer_user_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT referred_by_user_id FROM users WHERE id = $1 AND (deleted_at IS NULL OR deleted_at IS NOT DISTINCT FROM NULL)",
    )
    .bind(referred_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("affiliate_commission: failed to get referrer for user {}: {}", referred_user_id, e);
        e.to_string()
    })?;

    let referrer_user_id = match referrer_user_id {
        Some(id) => id,
        None => return Ok(None), // no referrer, nothing to accrue
    };

    // 2) Referrer's referral_code (to match affiliates.code)
    let referral_code: Option<String> = sqlx::query_scalar(
        "SELECT referral_code FROM users WHERE id = $1 AND referral_code IS NOT NULL AND referral_code <> ''",
    )
    .bind(referrer_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("affiliate_commission: failed to get referral_code for referrer {}: {}", referrer_user_id, e);
        e.to_string()
    })?;

    let referral_code = match referral_code {
        Some(c) => c,
        None => return Ok(None),
    };

    // 3) Get or create affiliates row for this referrer (affiliate_commissions.affiliate_id references affiliates.id)
    let affiliate_id = get_or_create_affiliate(pool, referrer_user_id, &referral_code).await?;

    // 4) Level 1 commission percent from affiliate_commission_layers
    let commission_percent: Option<Decimal> = sqlx::query_scalar(
        "SELECT commission_percent FROM affiliate_commission_layers WHERE level = 1 ORDER BY level ASC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        error!("affiliate_commission: failed to get level 1 commission: {}", e);
        e.to_string()
    })?;

    let commission_percent = match commission_percent {
        Some(p) if p > Decimal::ZERO => p,
        _ => return Ok(None), // no scheme or 0% — no commission
    };

    // 5) Commission amount = deposit_amount * (commission_percent / 100)
    let commission_amount = (deposit_amount * commission_percent / Decimal::from(100))
        .round_dp(2);

    if commission_amount <= Decimal::ZERO {
        return Ok(None);
    }

    // 6) Insert affiliate_commissions (amount = commission earned by affiliate)
    let commission_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO affiliate_commissions (id, affiliate_id, user_id, trade_id, position_id, amount, currency, commission_type, commission_value, status, created_at)
        VALUES ($1, $2, $3, NULL, NULL, $4, $5, 'percentage'::commission_type, $6, 'pending'::transaction_status, NOW())
        "#,
    )
    .bind(commission_id)
    .bind(affiliate_id)
    .bind(referred_user_id)
    .bind(commission_amount)
    .bind(currency)
    .bind(commission_percent)
    .execute(pool)
    .await
    .map_err(|e| {
        error!("affiliate_commission: failed to insert commission: {}", e);
        e.to_string()
    })?;

    // 7) Pay commission into referrer's wallet (rebate) and mark commission completed
    let wallet_id = ledger_service::get_or_create_wallet(pool, referrer_user_id, currency, "spot")
        .await
        .map_err(|e| {
            error!("affiliate_commission: failed to get wallet for referrer {}: {}", referrer_user_id, e);
            e.to_string()
        })?;

    let ref_id = format!("AFF-{}", commission_id.to_string().replace('-', "").chars().take(12).collect::<String>());
    let description = format!(
        "Affiliate commission from referral deposit (referred user {}, deposit tx {})",
        referred_user_id,
        transaction_id,
    );
    ledger_service::create_ledger_entry(
        pool,
        wallet_id,
        "rebate",
        commission_amount,
        &ref_id,
        Some(&description),
    )
    .await
    .map_err(|e| {
        error!("affiliate_commission: failed to credit referrer wallet {}: {}", referrer_user_id, e);
        e.to_string()
    })?;

    let now = chrono::Utc::now();
    sqlx::query(
        r#"
        UPDATE affiliate_commissions SET status = 'completed'::transaction_status, paid_at = $1 WHERE id = $2
        "#,
    )
    .bind(now)
    .bind(commission_id)
    .execute(pool)
    .await
    .map_err(|e| {
        error!("affiliate_commission: failed to mark commission paid: {}", e);
        e.to_string()
    })?;

    info!(
        "affiliate_commission: accrued and paid {} {} to affiliate {} (referrer {}) on deposit {} by user {}",
        commission_amount,
        currency,
        affiliate_id,
        referrer_user_id,
        transaction_id,
        referred_user_id,
    );

    Ok(Some(referrer_user_id))
}

/// Ensure an affiliates row exists for this user (referrer). Returns affiliates.id.
async fn get_or_create_affiliate(pool: &PgPool, user_id: Uuid, code: &str) -> Result<Uuid, String> {
    // Try by code first (unique)
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM affiliates WHERE code = $1")
        .bind(code)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!("affiliate_commission: get affiliate by code: {}", e);
            e.to_string()
        })?;

    if let Some(id) = existing {
        // Optionally ensure user_id is set if it was null
        let _ = sqlx::query("UPDATE affiliates SET user_id = $1, updated_at = NOW() WHERE id = $2 AND user_id IS NULL")
            .bind(user_id)
            .bind(id)
            .execute(pool)
            .await;
        return Ok(id);
    }

    // Create new affiliate row linked to this user
    let id = Uuid::new_v4();
    let affiliate_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO affiliates (id, user_id, code, commission_type, commission_value, status, created_at, updated_at)
        VALUES ($1, $2, $3, 'percentage'::commission_type, 0, 'active'::user_status, NOW(), NOW())
        ON CONFLICT (code) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()
        RETURNING id
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(code)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        error!("affiliate_commission: create affiliate: {}", e);
        e.to_string()
    })?;

    Ok(affiliate_id)
}
