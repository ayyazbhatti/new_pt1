use crate::models::symbol::{Symbol, SymbolWithProfile};
use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

pub struct AdminSymbolsService {
    pool: PgPool,
}

impl AdminSymbolsService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_symbols(
        &self,
        search: Option<&str>,
        asset_class: Option<&str>,
        is_enabled: Option<bool>,
        page: Option<i64>,
        page_size: Option<i64>,
        sort: Option<&str>,
    ) -> Result<(Vec<SymbolWithProfile>, i64)> {
        let page = page.unwrap_or(1);
        let page_size = page_size.unwrap_or(20);
        let offset = (page - 1) * page_size;

        let mut query = sqlx::QueryBuilder::new(
            r#"
            SELECT 
                s.id,
                s.code as symbol_code,
                s.provider_symbol,
                s.asset_class::text as asset_class,
                s.base_currency,
                s.quote_currency,
                s.price_precision,
                s.volume_precision,
                s.contract_size::text as contract_size,
                s.is_enabled,
                s.trading_enabled,
                s.leverage_profile_id,
                lp.name as leverage_profile_name,
                s.created_at,
                s.updated_at
            FROM symbols s
            LEFT JOIN leverage_profiles lp ON s.leverage_profile_id = lp.id
            WHERE 1=1
            "#
        );
        let mut count_query = sqlx::QueryBuilder::new(
            "SELECT COUNT(*) FROM symbols WHERE 1=1"
        );

        if let Some(search) = search {
            if !search.is_empty() {
                query.push(" AND (s.code ILIKE ");
                query.push_bind(format!("%{}%", search));
                query.push(" OR s.base_currency ILIKE ");
                query.push_bind(format!("%{}%", search));
                query.push(" OR s.quote_currency ILIKE ");
                query.push_bind(format!("%{}%", search));
                query.push(")");
                count_query.push(" AND (code ILIKE ");
                count_query.push_bind(format!("%{}%", search));
                count_query.push(" OR base_currency ILIKE ");
                count_query.push_bind(format!("%{}%", search));
                count_query.push(" OR quote_currency ILIKE ");
                count_query.push_bind(format!("%{}%", search));
                count_query.push(")");
            }
        }

        if let Some(ac) = asset_class {
            if ac != "all" {
                query.push(" AND s.asset_class::text = ");
                query.push_bind(ac);
                count_query.push(" AND asset_class::text = ");
                count_query.push_bind(ac);
            }
        }

        if let Some(enabled) = is_enabled {
            query.push(" AND s.is_enabled = ");
            query.push_bind(enabled);
            count_query.push(" AND is_enabled = ");
            count_query.push_bind(enabled);
        }

        let order_by = match sort {
            Some("code_asc") => "s.code ASC",
            Some("code_desc") => "s.code DESC",
            Some("created_desc") => "s.created_at DESC",
            Some("updated_desc") => "s.updated_at DESC",
            _ => "s.updated_at DESC",
        };

        query.push(" ORDER BY ");
        query.push(order_by);
        query.push(" LIMIT ");
        query.push_bind(page_size);
        query.push(" OFFSET ");
        query.push_bind(offset);

        let symbols: Vec<SymbolWithProfile> = query
            .build_query_as::<SymbolWithProfile>()
            .fetch_all(&self.pool)
            .await?;

        let total: i64 = count_query
            .build_query_scalar()
            .fetch_one(&self.pool)
            .await?;

        Ok((symbols, total))
    }

    pub async fn get_symbol_by_id(&self, id: Uuid) -> Result<Symbol> {
        let symbol = sqlx::query_as::<_, Symbol>(
            "SELECT id, code as symbol_code, provider_symbol, asset_class::text as asset_class, base_currency, quote_currency, price_precision, volume_precision, contract_size::text as contract_size, is_enabled, trading_enabled, leverage_profile_id, created_at, updated_at FROM symbols WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Symbol not found"))?;

        Ok(symbol)
    }

    pub async fn create_symbol(
        &self,
        symbol_code: &str,
        provider_symbol: &str,
        asset_class: &str,
        base_currency: &str,
        quote_currency: &str,
        price_precision: i32,
        volume_precision: i32,
        contract_size: &str,
        leverage_profile_id: Option<Uuid>,
    ) -> Result<Symbol> {
        if symbol_code.len() < 2 || symbol_code.len() > 50 {
            return Err(anyhow::anyhow!("Symbol code must be between 2 and 50 characters"));
        }

        let symbol = sqlx::query_as::<_, Symbol>(
            r#"
            INSERT INTO symbols (
                code, provider_symbol, asset_class, base_currency, quote_currency,
                price_precision, volume_precision, contract_size, leverage_profile_id
            )
            VALUES ($1, $2, $3::asset_class, $4, $5, $6, $7, $8::numeric, $9)
            RETURNING id, code as symbol_code, provider_symbol, asset_class::text as asset_class, 
                base_currency, quote_currency, price_precision, volume_precision, 
                contract_size::text as contract_size, is_enabled, trading_enabled, 
                leverage_profile_id, created_at, updated_at
            "#,
        )
        .bind(symbol_code)
        .bind(provider_symbol)
        .bind(asset_class)
        .bind(base_currency)
        .bind(quote_currency)
        .bind(price_precision)
        .bind(volume_precision)
        .bind(contract_size)
        .bind(leverage_profile_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(symbol)
    }

    pub async fn update_symbol(
        &self,
        id: Uuid,
        symbol_code: &str,
        provider_symbol: &str,
        asset_class: &str,
        base_currency: &str,
        quote_currency: &str,
        price_precision: i32,
        volume_precision: i32,
        contract_size: &str,
        is_enabled: bool,
        trading_enabled: bool,
        leverage_profile_id: Option<Uuid>,
    ) -> Result<Symbol> {
        let symbol = sqlx::query_as::<_, Symbol>(
            r#"
            UPDATE symbols
            SET 
                code = $2,
                provider_symbol = $3,
                asset_class = $4::asset_class,
                base_currency = $5,
                quote_currency = $6,
                price_precision = $7,
                volume_precision = $8,
                contract_size = $9::numeric,
                is_enabled = $10,
                trading_enabled = $11,
                leverage_profile_id = $12,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, code as symbol_code, provider_symbol, asset_class::text as asset_class, 
                base_currency, quote_currency, price_precision, volume_precision, 
                contract_size::text as contract_size, is_enabled, trading_enabled, 
                leverage_profile_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(symbol_code)
        .bind(provider_symbol)
        .bind(asset_class)
        .bind(base_currency)
        .bind(quote_currency)
        .bind(price_precision)
        .bind(volume_precision)
        .bind(contract_size)
        .bind(is_enabled)
        .bind(trading_enabled)
        .bind(leverage_profile_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Symbol not found"))?;

        Ok(symbol)
    }

    pub async fn delete_symbol(&self, id: Uuid) -> Result<()> {
        let rows_affected = sqlx::query("DELETE FROM symbols WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();

        if rows_affected == 0 {
            return Err(anyhow::anyhow!("Symbol not found"));
        }

        Ok(())
    }

    pub async fn toggle_enabled(&self, id: Uuid, is_enabled: bool) -> Result<Symbol> {
        let symbol = sqlx::query_as::<_, Symbol>(
            r#"
            UPDATE symbols
            SET is_enabled = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING id, code as symbol_code, provider_symbol, asset_class::text as asset_class, 
                base_currency, quote_currency, price_precision, volume_precision, 
                contract_size::text as contract_size, is_enabled, trading_enabled, 
                leverage_profile_id, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(is_enabled)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Symbol not found"))?;

        Ok(symbol)
    }
}

