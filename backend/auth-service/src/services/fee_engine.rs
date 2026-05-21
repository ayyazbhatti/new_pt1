//! Resolve fee rules and compute placement fee (USD notional).

use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ResolvedFee {
    pub rule_id: Uuid,
    pub fee_percent: Decimal,
    pub min_fee: Decimal,
    pub max_fee: Option<Decimal>,
}

#[derive(sqlx::FromRow)]
struct FeeRuleRow {
    id: Uuid,
    fee_percent: Decimal,
    min_fee: Decimal,
    max_fee: Option<Decimal>,
}

/// Resolve the most-specific active fee rule for (group, symbol, market).
/// Returns `None` if fees are disabled for the group or no matching rule exists.
pub async fn resolve_fee_rule(
    pool: &PgPool,
    group_id: Uuid,
    symbol_code: &str,
    market: &str,
) -> Result<Option<ResolvedFee>, sqlx::Error> {
    let enabled: bool = sqlx::query_scalar(
        "SELECT COALESCE(fees_enabled, false) FROM user_groups WHERE id = $1",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(false);

    if !enabled {
        return Ok(None);
    }

    let sym = symbol_code.trim();
    let mkt = market.trim().to_lowercase();

    let row = sqlx::query_as::<_, FeeRuleRow>(
        r#"
        SELECT id, fee_percent, min_fee, max_fee FROM fee_rules
        WHERE group_id = $1
          AND status = 'active'
          AND (symbol = $2 OR symbol IS NULL)
          AND (market::text = $3 OR market IS NULL)
        ORDER BY
          (symbol IS NOT NULL) DESC,
          (market IS NOT NULL) DESC,
          updated_at DESC
        LIMIT 1
        "#,
    )
    .bind(group_id)
    .bind(sym)
    .bind(&mkt)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| ResolvedFee {
        rule_id: r.id,
        fee_percent: r.fee_percent,
        min_fee: r.min_fee,
        max_fee: r.max_fee,
    }))
}

/// Map `symbols.market` to the string used in `fee_rules.market`.
pub async fn resolve_symbol_market(pool: &PgPool, symbol_code: &str) -> Result<String, sqlx::Error> {
    let m: Option<String> = sqlx::query_scalar(
        r#"SELECT market::text FROM symbols WHERE LOWER(TRIM(code)) = LOWER(TRIM($1)) LIMIT 1"#,
    )
    .bind(symbol_code)
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(m.unwrap_or_else(|| "forex".to_string()))
}

pub fn compute_fee_amount(notional_usd: Decimal, rule: &ResolvedFee) -> Decimal {
    if notional_usd <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    let raw = notional_usd * rule.fee_percent;
    let with_min = if raw < rule.min_fee { rule.min_fee } else { raw };
    if let Some(max) = rule.max_fee {
        if with_min > max {
            max
        } else {
            with_min
        }
    } else {
        with_min
    }
}
