//! Daily swap rollover: match `swap_rules` rollover time (UTC), **accrue** swap on open positions in swap-enabled groups (no wallet movement until position close).

use chrono::{Datelike, Timelike, Utc, Weekday};
use redis::AsyncCommands;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

use crate::redis_pool::RedisPool;
use crate::routes::deposits::compute_and_cache_account_summary;
use crate::services::fx_rates;

#[derive(Debug, sqlx::FromRow)]
struct SwapApplicable {
    position_id: Uuid,
    user_id: Uuid,
    symbol: String,
    side: String,
    size: Decimal,
    mark_price: Decimal,
    quote_currency: String,
    rule_id: Uuid,
    long_rate: Decimal,
    short_rate: Decimal,
    triple_day: Option<String>,
    unit: String,
    min_charge: Option<Decimal>,
    max_charge: Option<Decimal>,
}

fn weekday_str(w: Weekday) -> &'static str {
    match w {
        Weekday::Mon => "mon",
        Weekday::Tue => "tue",
        Weekday::Wed => "wed",
        Weekday::Thu => "thu",
        Weekday::Fri => "fri",
        Weekday::Sat => "sat",
        Weekday::Sun => "sun",
    }
}

fn apply_min_max(charge: Decimal, min_charge: Option<Decimal>, max_charge: Option<Decimal>) -> Decimal {
    let sign = if charge >= Decimal::ZERO {
        Decimal::ONE
    } else {
        -Decimal::ONE
    };
    let mut a = charge.abs();
    if let Some(min) = min_charge {
        if min > Decimal::ZERO && a < min {
            a = min;
        }
    }
    if let Some(max) = max_charge {
        if max >= Decimal::ZERO && a > max {
            a = max;
        }
    }
    sign * a
}

/// `bypass_rollover_clock`: when true (admin **run-now**), ignore `rollover_time_utc` and attempt all active daily rules; idempotency is still one charge per position per UTC day.
pub async fn run_rollover_tick(
    pool: &PgPool,
    redis: &RedisPool,
    bypass_rollover_clock: bool,
) -> Result<usize, anyhow::Error> {
    let now = Utc::now();
    let rollover_hm = format!("{:02}:{:02}", now.hour(), now.minute());

    let fx_snapshot = match fx_rates::get_cached_snapshot(redis).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            tracing::warn!("swap engine: FX cache empty — skipping rollover tick");
            return Ok(0);
        }
        Err(e) => {
            tracing::warn!(error = %e, "swap engine: failed to read FX cache — skipping rollover tick");
            return Ok(0);
        }
    };

    let applicable: Vec<SwapApplicable> = sqlx::query_as(
        r#"
        SELECT
            p.id AS position_id,
            p.user_id,
            s.code AS symbol,
            LOWER(p.side::text) AS side,
            p.size,
            p.mark_price,
            s.quote_currency,
            sr.id AS rule_id,
            sr.long_rate,
            sr.short_rate,
            sr.triple_day,
            sr.unit,
            sr.min_charge,
            sr.max_charge
        FROM positions p
        INNER JOIN users u ON u.id = p.user_id
        INNER JOIN user_groups g ON g.id = u.group_id
        INNER JOIN symbols s ON s.id = p.symbol_id
        INNER JOIN swap_rules sr
            ON sr.group_id = u.group_id
            AND sr.symbol = s.code
            AND LOWER(TRIM(sr.market::text)) = LOWER(TRIM(s.market::text))
        WHERE p.status = 'open'::position_status
          AND g.swap_enabled = true
          AND sr.status = 'active'
          AND sr.calc_mode = 'daily'
          AND ($2::bool OR TRIM(sr.rollover_time_utc) = $1)
          AND NOT EXISTS (
              SELECT 1 FROM swap_charge_log scl
              WHERE scl.position_id = p.id
                AND (scl.charged_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
          )
        "#,
    )
    .bind(&rollover_hm)
    .bind(bypass_rollover_clock)
    .fetch_all(pool)
    .await?;

    if applicable.is_empty() {
        return Ok(0);
    }

    let weekday = now.weekday();
    let weekday_str = weekday_str(weekday);

    let mut charged = 0usize;
    for pos in applicable {
        let is_triple = pos
            .triple_day
            .as_deref()
            .map(|d| d.eq_ignore_ascii_case(weekday_str))
            .unwrap_or(false);
        let days = if is_triple {
            Decimal::from(3)
        } else {
            Decimal::ONE
        };

        let rate = if pos.side == "long" {
            pos.long_rate
        } else {
            pos.short_rate
        };

        let position_value_quote = pos.size * pos.mark_price;
        let position_value_usd = match fx_rates::convert_with_rates(
            position_value_quote,
            pos.quote_currency.trim(),
            "USD",
            &fx_snapshot.rates,
        ) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(
                    position_id = %pos.position_id,
                    error = %e,
                    "swap: skipping position due to FX error"
                );
                continue;
            }
        };

        let mut charge_usd = match pos.unit.as_str() {
            "percent" => position_value_usd * rate * days,
            "fixed" => rate * days * pos.size,
            _ => {
                tracing::warn!(position_id = %pos.position_id, unit = %pos.unit, "swap: unknown unit; skip");
                continue;
            }
        };

        charge_usd = apply_min_max(charge_usd, pos.min_charge, pos.max_charge);

        if charge_usd.is_zero() {
            continue;
        }

        let days_count: i32 = if is_triple { 3 } else { 1 };

        match charge_one_position(
            pool,
            redis,
            &pos,
            charge_usd,
            days,
            days_count,
            rate,
            position_value_usd,
            is_triple,
        )
        .await
        {
            Ok(true) => charged += 1,
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(position_id = %pos.position_id, error = %e, "swap: charge failed");
            }
        }
    }

    Ok(charged)
}

/// Returns true if a row was committed for this position.
async fn charge_one_position(
    pool: &PgPool,
    redis: &RedisPool,
    pos: &SwapApplicable,
    charge_usd: Decimal,
    _days: Decimal,
    days_count: i32,
    rate: Decimal,
    _position_value_usd: Decimal,
    _is_triple: bool,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let already: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM swap_charge_log scl
            WHERE scl.position_id = $1
              AND (scl.charged_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
        )
        "#,
    )
    .bind(pos.position_id)
    .fetch_one(&mut *tx)
    .await?;
    if already {
        tx.rollback().await.ok();
        return Ok(false);
    }

    sqlx::query(
        r#"
        UPDATE positions SET
            accumulated_swap_usd = accumulated_swap_usd + $1,
            updated_at = NOW()
        WHERE id = $2 AND status = 'open'::position_status
        "#,
    )
    .bind(charge_usd)
    .bind(pos.position_id)
    .execute(&mut *tx)
    .await?;

    let log_id = Uuid::new_v4();
    let res = sqlx::query(
        r#"
        INSERT INTO swap_charge_log
            (id, user_id, position_id, swap_rule_id, transaction_id,
             amount_usd, days_count, position_size, mark_price, rate_applied, side)
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(log_id)
    .bind(pos.user_id)
    .bind(pos.position_id)
    .bind(pos.rule_id)
    .bind(charge_usd)
    .bind(days_count)
    .bind(pos.size)
    .bind(pos.mark_price)
    .bind(rate)
    .bind(&pos.side)
    .execute(&mut *tx)
    .await;

    if let Err(e) = res {
        if let sqlx::Error::Database(dbe) = &e {
            if dbe.is_unique_violation() {
                tx.rollback().await.ok();
                return Ok(false);
            }
        }
        return Err(e);
    }

    tx.commit().await?;

    let _ = maybe_send_first_swap_notification(pool, redis, pos.user_id, charge_usd, &pos.symbol).await;

    let uid = pos.user_id;
    let pool_c = pool.clone();
    let redis_c = redis.clone();
    tokio::spawn(async move {
        compute_and_cache_account_summary(&pool_c, &redis_c, uid).await;
    });

    Ok(true)
}

async fn maybe_send_first_swap_notification(
    pool: &PgPool,
    redis: &RedisPool,
    user_id: Uuid,
    amount_usd: Decimal,
    symbol: &str,
) -> Result<(), sqlx::Error> {
    let prior: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'swap_first_charge')",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if prior {
        return Ok(());
    }

    let title = "Overnight financing";
    let kind = "swap_first_charge";
    let message = format!(
        "Overnight financing of {} USD has accrued on your {} position (settled when the position closes).",
        amount_usd.round_dp(2),
        symbol
    );
    let now = Utc::now();
    let meta = serde_json::json!({
        "kind": kind,
        "amount_usd": amount_usd.to_string(),
        "symbol": symbol,
    });
    let notification_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO notifications (id, user_id, kind, title, message, read, created_at, meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(notification_id)
    .bind(user_id)
    .bind(kind)
    .bind(title)
    .bind(&message)
    .bind(false)
    .bind(now)
    .bind(&meta)
    .execute(pool)
    .await?;

    let notification_event = serde_json::json!({
        "id": notification_id.to_string(),
        "kind": kind,
        "title": title,
        "message": message,
        "createdAt": now.to_rfc3339(),
        "read": false,
        "userId": user_id.to_string(),
        "meta": meta,
    });

    if let Ok(mut conn) = redis.get().await {
        let payload_str = serde_json::to_string(&notification_event).unwrap_or_default();
        let _: Result<(), _> = conn.publish("notifications:push", payload_str).await;
    }

    Ok(())
}
