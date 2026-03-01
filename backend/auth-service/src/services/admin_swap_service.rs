use crate::models::swap_rule::{SwapRule, SwapRuleWithGroupName};
use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

const VALID_MARKETS: &[&str] = &["crypto", "forex", "commodities", "indices", "stocks"];
const VALID_CALC_MODES: &[&str] = &["daily", "hourly", "funding_8h"];
const VALID_UNITS: &[&str] = &["percent", "fixed"];
const VALID_WEEKEND_RULES: &[&str] = &["none", "triple_day", "fri_triple", "custom"];
const VALID_TRIPLE_DAYS: &[&str] = &["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const VALID_STATUSES: &[&str] = &["active", "disabled"];

pub struct AdminSwapService {
    pool: PgPool,
}

impl AdminSwapService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    fn validate_market(s: &str) -> Result<()> {
        if VALID_MARKETS.contains(&s) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Invalid market: {}", s))
        }
    }
    fn validate_calc_mode(s: &str) -> Result<()> {
        if VALID_CALC_MODES.contains(&s) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Invalid calc_mode: {}", s))
        }
    }
    fn validate_unit(s: &str) -> Result<()> {
        if VALID_UNITS.contains(&s) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Invalid unit: {}", s))
        }
    }
    fn validate_weekend_rule(s: &str) -> Result<()> {
        if VALID_WEEKEND_RULES.contains(&s) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Invalid weekend_rule: {}", s))
        }
    }
    fn validate_status(s: &str) -> Result<()> {
        if VALID_STATUSES.contains(&s) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Invalid status: {}", s))
        }
    }
    fn validate_triple_day(s: Option<&str>) -> Result<()> {
        match s {
            None => Ok(()),
            Some(t) if VALID_TRIPLE_DAYS.contains(&t) => Ok(()),
            Some(t) => Err(anyhow::anyhow!("Invalid triple_day: {}", t)),
        }
    }

    pub async fn list_rules(
        &self,
        group_id: Option<Uuid>,
        market: Option<&str>,
        symbol: Option<&str>,
        status: Option<&str>,
        calc_mode: Option<&str>,
        page: Option<i64>,
        page_size: Option<i64>,
    ) -> Result<(Vec<SwapRuleWithGroupName>, i64)> {
        let page = page.unwrap_or(1).max(1);
        let page_size = page_size.unwrap_or(20).min(100).max(1);
        let offset = (page - 1) * page_size;

        let symbol_pattern: Option<String> = symbol.map(|s| format!("%{}%", s));

        let mut conditions = Vec::with_capacity(5);
        let mut bind_count = 0u8;

        if group_id.is_some() {
            bind_count += 1;
            conditions.push(format!("sr.group_id = ${}", bind_count));
        }
        if market.is_some() {
            bind_count += 1;
            conditions.push(format!("sr.market = ${}", bind_count));
        }
        if symbol_pattern.is_some() {
            bind_count += 1;
            conditions.push(format!("sr.symbol ILIKE ${}", bind_count));
        }
        if status.is_some() {
            bind_count += 1;
            conditions.push(format!("sr.status = ${}", bind_count));
        }
        if calc_mode.is_some() {
            bind_count += 1;
            conditions.push(format!("sr.calc_mode = ${}", bind_count));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let count_sql = format!(
            "SELECT COUNT(*) FROM swap_rules sr {}",
            where_clause
        );
        let list_sql = format!(
            r#"
            SELECT
                sr.id,
                sr.group_id,
                ug.name AS group_name,
                sr.symbol,
                sr.market,
                sr.calc_mode,
                sr.unit,
                sr.long_rate,
                sr.short_rate,
                sr.rollover_time_utc,
                sr.triple_day,
                sr.weekend_rule,
                sr.min_charge,
                sr.max_charge,
                sr.status,
                sr.notes,
                sr.created_at,
                sr.updated_at,
                sr.updated_by
            FROM swap_rules sr
            LEFT JOIN user_groups ug ON ug.id = sr.group_id
            {}
            ORDER BY sr.updated_at DESC
            LIMIT {} OFFSET {}
            "#,
            where_clause,
            page_size,
            offset
        );

        let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
        let mut list_query = sqlx::query_as::<_, SwapRuleWithGroupName>(&list_sql);

        if let Some(g) = group_id {
            count_query = count_query.bind(g);
            list_query = list_query.bind(g);
        }
        if let Some(m) = market {
            count_query = count_query.bind(m);
            list_query = list_query.bind(m);
        }
        if let Some(ref pattern) = symbol_pattern {
            count_query = count_query.bind(pattern.as_str());
            list_query = list_query.bind(pattern.as_str());
        }
        if let Some(s) = status {
            count_query = count_query.bind(s);
            list_query = list_query.bind(s);
        }
        if let Some(c) = calc_mode {
            count_query = count_query.bind(c);
            list_query = list_query.bind(c);
        }

        let total: i64 = count_query.fetch_one(&self.pool).await?;
        let rows = list_query.fetch_all(&self.pool).await?;
        Ok((rows, total))
    }

    pub async fn get_rule_by_id(&self, id: Uuid) -> Result<SwapRuleWithGroupName> {
        let row = sqlx::query_as::<_, SwapRuleWithGroupName>(
            r#"
            SELECT
                sr.id,
                sr.group_id,
                ug.name AS group_name,
                sr.symbol,
                sr.market,
                sr.calc_mode,
                sr.unit,
                sr.long_rate,
                sr.short_rate,
                sr.rollover_time_utc,
                sr.triple_day,
                sr.weekend_rule,
                sr.min_charge,
                sr.max_charge,
                sr.status,
                sr.notes,
                sr.created_at,
                sr.updated_at,
                sr.updated_by
            FROM swap_rules sr
            LEFT JOIN user_groups ug ON ug.id = sr.group_id
            WHERE sr.id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Swap rule not found"))?;
        Ok(row)
    }

    pub async fn create_rule(
        &self,
        group_id: Uuid,
        symbol: &str,
        market: &str,
        calc_mode: &str,
        unit: &str,
        long_rate: rust_decimal::Decimal,
        short_rate: rust_decimal::Decimal,
        rollover_time_utc: &str,
        weekend_rule: &str,
        status: &str,
        triple_day: Option<&str>,
        min_charge: Option<rust_decimal::Decimal>,
        max_charge: Option<rust_decimal::Decimal>,
        notes: Option<&str>,
        updated_by: Option<&str>,
    ) -> Result<SwapRuleWithGroupName> {
        Self::validate_market(market)?;
        Self::validate_calc_mode(calc_mode)?;
        Self::validate_unit(unit)?;
        Self::validate_weekend_rule(weekend_rule)?;
        Self::validate_status(status)?;
        Self::validate_triple_day(triple_day)?;

        // Ensure group exists
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_groups WHERE id = $1)")
                .bind(group_id)
                .fetch_one(&self.pool)
                .await?;
        if !exists {
            return Err(anyhow::anyhow!("Group not found"));
        }

        let new_id: Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO swap_rules (
                group_id, symbol, market, calc_mode, unit,
                long_rate, short_rate, rollover_time_utc, weekend_rule, status,
                triple_day, min_charge, max_charge, notes, updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL)
            RETURNING id
            "#,
        )
        .bind(group_id)
        .bind(symbol)
        .bind(market)
        .bind(calc_mode)
        .bind(unit)
        .bind(long_rate)
        .bind(short_rate)
        .bind(rollover_time_utc)
        .bind(weekend_rule)
        .bind(status)
        .bind(triple_day)
        .bind(min_charge)
        .bind(max_charge)
        .bind(notes)
        .fetch_one(&self.pool)
        .await?;

        self.get_rule_by_id(new_id).await
    }

    pub async fn update_rule(
        &self,
        id: Uuid,
        group_id: Option<Uuid>,
        symbol: Option<&str>,
        market: Option<&str>,
        calc_mode: Option<&str>,
        unit: Option<&str>,
        long_rate: Option<rust_decimal::Decimal>,
        short_rate: Option<rust_decimal::Decimal>,
        rollover_time_utc: Option<&str>,
        weekend_rule: Option<&str>,
        triple_day: Option<Option<&str>>,
        min_charge: Option<Option<rust_decimal::Decimal>>,
        max_charge: Option<Option<rust_decimal::Decimal>>,
        status: Option<&str>,
        notes: Option<Option<&str>>,
        updated_by: Option<&str>,
    ) -> Result<SwapRuleWithGroupName> {
        if let Some(m) = market {
            Self::validate_market(m)?;
        }
        if let Some(c) = calc_mode {
            Self::validate_calc_mode(c)?;
        }
        if let Some(u) = unit {
            Self::validate_unit(u)?;
        }
        if let Some(w) = weekend_rule {
            Self::validate_weekend_rule(w)?;
        }
        if let Some(s) = status {
            Self::validate_status(s)?;
        }
        if let Some(ref t) = triple_day {
            Self::validate_triple_day(*t)?;
        }

        let existing = self.get_rule_by_id(id).await?;

        let group_id = group_id.unwrap_or(existing.group_id);
        let symbol_code = symbol.unwrap_or(&existing.symbol);
        let market_str = market.unwrap_or(&existing.market);
        let calc_mode = calc_mode.unwrap_or(&existing.calc_mode);
        let unit = unit.unwrap_or(&existing.unit);
        let long_rate = long_rate.unwrap_or(existing.long_rate);
        let short_rate = short_rate.unwrap_or(existing.short_rate);
        let rollover_time_utc = rollover_time_utc.unwrap_or(&existing.rollover_time_utc);
        let weekend_rule = weekend_rule.unwrap_or(&existing.weekend_rule);
        let triple_day_val = triple_day.unwrap_or(existing.triple_day.as_deref());
        let min_charge = min_charge.unwrap_or(existing.min_charge);
        let max_charge = max_charge.unwrap_or(existing.max_charge);
        let status = status.unwrap_or(&existing.status);
        let notes = notes.unwrap_or(existing.notes.as_deref());

        sqlx::query(
            r#"
            UPDATE swap_rules SET
                group_id = $2, symbol = $3, market = $4, calc_mode = $5, unit = $6,
                long_rate = $7, short_rate = $8, rollover_time_utc = $9, weekend_rule = $10,
                triple_day = $11, min_charge = $12, max_charge = $13, status = $14,
                notes = $15, updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(group_id)
        .bind(symbol_code)
        .bind(market_str)
        .bind(calc_mode)
        .bind(unit)
        .bind(long_rate)
        .bind(short_rate)
        .bind(rollover_time_utc)
        .bind(weekend_rule)
        .bind(triple_day_val)
        .bind(min_charge)
        .bind(max_charge)
        .bind(status)
        .bind(notes)
        .execute(&self.pool)
        .await?;

        self.get_rule_by_id(id).await
    }

    pub async fn delete_rule(&self, id: Uuid) -> Result<()> {
        let done = sqlx::query("DELETE FROM swap_rules WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if done.rows_affected() == 0 {
            return Err(anyhow::anyhow!("Swap rule not found"));
        }
        Ok(())
    }
}
