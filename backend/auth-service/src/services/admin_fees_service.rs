use crate::models::fee_rule::{FeeRule, FeeRuleWithGroupName};
use anyhow::Result;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

const VALID_MARKETS: &[&str] = &["crypto", "forex", "commodities", "indices", "stocks"];
const VALID_STATUSES: &[&str] = &["active", "disabled"];

pub struct AdminFeesService {
    pool: PgPool,
}

impl AdminFeesService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    fn validate_status(s: &str) -> Result<()> {
        if VALID_STATUSES.contains(&s) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Invalid status: {}", s))
        }
    }

    fn validate_market_opt(m: Option<&str>) -> Result<()> {
        match m {
            None | Some("") => Ok(()),
            Some(v) if VALID_MARKETS.contains(&v) => Ok(()),
            Some(v) => Err(anyhow::anyhow!("Invalid market: {}", v)),
        }
    }

    fn validate_fee_percent(d: Decimal) -> Result<()> {
        if d < Decimal::ZERO {
            return Err(anyhow::anyhow!("fee_percent must be >= 0"));
        }
        if d > Decimal::ONE {
            return Err(anyhow::anyhow!("fee_percent must be <= 1.0 (100%)"));
        }
        Ok(())
    }

    fn normalize_symbol(s: Option<&str>) -> Option<String> {
        s.map(str::trim)
            .filter(|t| !t.is_empty())
            .map(|t| t.to_string())
    }

    pub async fn list_fee_rules(
        &self,
        group_id: Option<Uuid>,
        symbol: Option<&str>,
        status: Option<&str>,
        page: Option<i64>,
        page_size: Option<i64>,
    ) -> Result<(Vec<FeeRuleWithGroupName>, i64)> {
        let page = page.unwrap_or(1).max(1);
        let page_size = page_size.unwrap_or(20).min(100).max(1);
        let offset = (page - 1) * page_size;

        let symbol_pattern: Option<String> = symbol.map(|s| format!("%{}%", s));

        let mut conditions = Vec::with_capacity(4);
        let mut bind_count = 0u8;

        if group_id.is_some() {
            bind_count += 1;
            conditions.push(format!("fr.group_id = ${}", bind_count));
        }
        if symbol_pattern.is_some() {
            bind_count += 1;
            conditions.push(format!("fr.symbol ILIKE ${}", bind_count));
        }
        if status.is_some() {
            bind_count += 1;
            conditions.push(format!("fr.status = ${}", bind_count));
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        let count_sql = format!("SELECT COUNT(*) FROM fee_rules fr {}", where_clause);
        let list_sql = format!(
            r#"
            SELECT
                fr.id,
                fr.group_id,
                ug.name AS group_name,
                fr.symbol,
                fr.market,
                fr.fee_percent,
                fr.min_fee,
                fr.max_fee,
                fr.status,
                fr.notes,
                fr.created_at,
                fr.updated_at,
                fr.updated_by,
                fr.created_by_user_id,
                creator.email AS created_by_email
            FROM fee_rules fr
            LEFT JOIN user_groups ug ON ug.id = fr.group_id
            LEFT JOIN users creator ON creator.id = fr.created_by_user_id
            {}
            ORDER BY fr.updated_at DESC
            LIMIT {} OFFSET {}
            "#,
            where_clause, page_size, offset
        );

        let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
        let mut list_query = sqlx::query_as::<_, FeeRuleWithGroupName>(&list_sql);

        if let Some(g) = group_id {
            count_query = count_query.bind(g);
            list_query = list_query.bind(g);
        }
        if let Some(ref pattern) = symbol_pattern {
            count_query = count_query.bind(pattern.as_str());
            list_query = list_query.bind(pattern.as_str());
        }
        if let Some(s) = status {
            count_query = count_query.bind(s);
            list_query = list_query.bind(s);
        }

        let total: i64 = count_query.fetch_one(&self.pool).await?;
        let rows = list_query.fetch_all(&self.pool).await?;
        Ok((rows, total))
    }

    pub async fn get_fee_rule(&self, id: Uuid) -> Result<Option<FeeRuleWithGroupName>> {
        let row = sqlx::query_as::<_, FeeRuleWithGroupName>(
            r#"
            SELECT
                fr.id,
                fr.group_id,
                ug.name AS group_name,
                fr.symbol,
                fr.market,
                fr.fee_percent,
                fr.min_fee,
                fr.max_fee,
                fr.status,
                fr.notes,
                fr.created_at,
                fr.updated_at,
                fr.updated_by,
                fr.created_by_user_id,
                creator.email AS created_by_email
            FROM fee_rules fr
            LEFT JOIN user_groups ug ON ug.id = fr.group_id
            LEFT JOIN users creator ON creator.id = fr.created_by_user_id
            WHERE fr.id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn create_fee_rule(
        &self,
        group_id: Uuid,
        symbol: Option<&str>,
        market: Option<&str>,
        fee_percent: Decimal,
        min_fee: Decimal,
        max_fee: Option<Decimal>,
        status: &str,
        notes: Option<&str>,
        updated_by: Option<&str>,
        created_by_user_id: Option<Uuid>,
    ) -> Result<FeeRule> {
        Self::validate_status(status)?;
        Self::validate_market_opt(market)?;
        Self::validate_fee_percent(fee_percent)?;
        if min_fee < Decimal::ZERO {
            return Err(anyhow::anyhow!("min_fee must be >= 0"));
        }
        if let Some(m) = max_fee {
            if m < min_fee {
                return Err(anyhow::anyhow!("max_fee must be >= min_fee when set"));
            }
        }

        let sym = Self::normalize_symbol(symbol);
        let mkt = market.map(str::trim).filter(|t| !t.is_empty()).map(|s| s.to_string());

        let row = sqlx::query_as::<_, FeeRule>(
            r#"
            INSERT INTO fee_rules (
                group_id, symbol, market, fee_percent, min_fee, max_fee, status, notes, updated_by, created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
            "#,
        )
        .bind(group_id)
        .bind(sym)
        .bind(mkt)
        .bind(fee_percent)
        .bind(min_fee)
        .bind(max_fee)
        .bind(status)
        .bind(notes)
        .bind(updated_by)
        .bind(created_by_user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            if let Some(db_err) = e.as_database_error() {
                if db_err.is_unique_violation() {
                    return anyhow::anyhow!(
                        "A fee rule already exists for this group, symbol, and market combination"
                    );
                }
            }
            anyhow::anyhow!(e)
        })?;

        Ok(row)
    }

    pub async fn update_fee_rule(
        &self,
        id: Uuid,
        group_id: Option<Uuid>,
        symbol: Option<Option<&str>>,
        market: Option<Option<&str>>,
        fee_percent: Option<Decimal>,
        min_fee: Option<Decimal>,
        max_fee: Option<Option<Decimal>>,
        status: Option<&str>,
        notes: Option<Option<&str>>,
        updated_by: Option<&str>,
    ) -> Result<FeeRule> {
        if let Some(s) = status {
            Self::validate_status(s)?;
        }
        if let Some(Some(m)) = market {
            Self::validate_market_opt(Some(m))?;
        }
        if let Some(fp) = fee_percent {
            Self::validate_fee_percent(fp)?;
        }

        let current = sqlx::query_as::<_, FeeRule>("SELECT * FROM fee_rules WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Fee rule not found"))?;

        let new_group_id = group_id.unwrap_or(current.group_id);
        let new_symbol = match symbol {
            None => current.symbol.clone(),
            Some(None) => None,
            Some(Some(s)) => Self::normalize_symbol(Some(s)),
        };
        let new_market = match market {
            None => current.market.clone(),
            Some(None) => None,
            Some(Some(s)) => {
                let t = s.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            }
        };
        let new_fee_percent = fee_percent.unwrap_or(current.fee_percent);
        let new_min_fee = min_fee.unwrap_or(current.min_fee);
        let new_max_fee = match max_fee {
            None => current.max_fee,
            Some(None) => None,
            Some(Some(m)) => Some(m),
        };
        let new_status = match status {
            None => current.status.clone(),
            Some(s) => s.to_string(),
        };
        let new_notes = match notes {
            None => current.notes.clone(),
            Some(None) => None,
            Some(Some(n)) => {
                let t = n.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            }
        };

        Self::validate_status(new_status.as_str())?;
        Self::validate_market_opt(new_market.as_deref())?;
        Self::validate_fee_percent(new_fee_percent)?;
        if new_min_fee < Decimal::ZERO {
            return Err(anyhow::anyhow!("min_fee must be >= 0"));
        }
        if let Some(m) = new_max_fee {
            if m < new_min_fee {
                return Err(anyhow::anyhow!("max_fee must be >= min_fee when set"));
            }
        }

        let row = sqlx::query_as::<_, FeeRule>(
            r#"
            UPDATE fee_rules SET
                group_id = $2,
                symbol = $3,
                market = $4,
                fee_percent = $5,
                min_fee = $6,
                max_fee = $7,
                status = $8,
                notes = $9,
                updated_by = $10,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(new_group_id)
        .bind(new_symbol)
        .bind(new_market)
        .bind(new_fee_percent)
        .bind(new_min_fee)
        .bind(new_max_fee)
        .bind(new_status)
        .bind(new_notes)
        .bind(updated_by)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            if let Some(db_err) = e.as_database_error() {
                if db_err.is_unique_violation() {
                    return anyhow::anyhow!(
                        "A fee rule already exists for this group, symbol, and market combination"
                    );
                }
            }
            anyhow::anyhow!(e)
        })?;

        Ok(row)
    }

    pub async fn delete_fee_rule(&self, id: Uuid) -> Result<()> {
        let r = sqlx::query("DELETE FROM fee_rules WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() == 0 {
            return Err(anyhow::anyhow!("Fee rule not found"));
        }
        Ok(())
    }
}
