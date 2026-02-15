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
                s.tick_size,
                s.lot_min,
                s.lot_max,
                s.default_pip_position,
                s.pip_position_min,
                s.pip_position_max,
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

        let symbols: Vec<SymbolWithProfile> = match query
            .build_query_as::<SymbolWithProfile>()
            .fetch_all(&self.pool)
            .await
        {
            Ok(rows) => rows,
            Err(e) => {
                let err_str = e.to_string();
                // If DB is missing columns (e.g. pip position or migration not run), use minimal query
                if err_str.contains("does not exist") || err_str.contains("column") {
                    self.list_symbols_minimal(
                        search,
                        asset_class,
                        is_enabled,
                        Some(page),
                        Some(page_size),
                        sort,
                    )
                    .await?
                } else {
                    return Err(e.into());
                }
            }
        };

        let total: i64 = count_query
            .build_query_scalar()
            .fetch_one(&self.pool)
            .await?;

        Ok((symbols, total))
    }

    /// Fallback list when symbols table is missing pip_position columns or leverage_profiles join.
    async fn list_symbols_minimal(
        &self,
        search: Option<&str>,
        asset_class: Option<&str>,
        is_enabled: Option<bool>,
        page: Option<i64>,
        page_size: Option<i64>,
        sort: Option<&str>,
    ) -> Result<Vec<SymbolWithProfile>> {
        use sqlx::Row;
        let page = page.unwrap_or(1);
        let page_size = page_size.unwrap_or(20);
        let offset = (page - 1) * page_size;
        let order_by = match sort {
            Some("code_asc") => "s.code ASC",
            Some("code_desc") => "s.code DESC",
            Some("created_desc") => "s.created_at DESC",
            Some("updated_desc") => "s.updated_at DESC",
            _ => "s.updated_at DESC",
        };

        let mut q = sqlx::QueryBuilder::new(
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
                s.tick_size,
                s.lot_min,
                s.lot_max,
                NULL::numeric as default_pip_position,
                NULL::numeric as pip_position_min,
                NULL::numeric as pip_position_max,
                s.is_enabled,
                s.trading_enabled,
                s.leverage_profile_id,
                NULL::text as leverage_profile_name,
                s.created_at,
                s.updated_at
            FROM symbols s
            WHERE 1=1
            "#
        );
        if let Some(search) = search {
            if !search.is_empty() {
                q.push(" AND (s.code ILIKE ");
                q.push_bind(format!("%{}%", search));
                q.push(" OR s.base_currency ILIKE ");
                q.push_bind(format!("%{}%", search));
                q.push(" OR s.quote_currency ILIKE ");
                q.push_bind(format!("%{}%", search));
                q.push(")");
            }
        }
        if let Some(ac) = asset_class {
            if ac != "all" {
                q.push(" AND s.asset_class::text = ");
                q.push_bind(ac);
            }
        }
        if let Some(enabled) = is_enabled {
            q.push(" AND s.is_enabled = ");
            q.push_bind(enabled);
        }
        q.push(" ORDER BY ");
        q.push(order_by);
        q.push(" LIMIT ");
        q.push_bind(page_size);
        q.push(" OFFSET ");
        q.push_bind(offset);

        let rows = q.build().fetch_all(&self.pool).await?;
        let symbols: Vec<SymbolWithProfile> = rows
            .into_iter()
            .map(|row| SymbolWithProfile {
                id: row.get("id"),
                symbol_code: row.get("symbol_code"),
                provider_symbol: row.get("provider_symbol"),
                asset_class: row.get("asset_class"),
                base_currency: row.get("base_currency"),
                quote_currency: row.get("quote_currency"),
                price_precision: row.get("price_precision"),
                volume_precision: row.get("volume_precision"),
                contract_size: row.get("contract_size"),
                tick_size: row.get("tick_size"),
                lot_min: row.get("lot_min"),
                lot_max: row.get("lot_max"),
                default_pip_position: row.get("default_pip_position"),
                pip_position_min: row.get("pip_position_min"),
                pip_position_max: row.get("pip_position_max"),
                is_enabled: row.get("is_enabled"),
                trading_enabled: row.get("trading_enabled"),
                leverage_profile_id: row.get("leverage_profile_id"),
                leverage_profile_name: row.get("leverage_profile_name"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();
        Ok(symbols)
    }

    pub async fn get_symbol_by_id(&self, id: Uuid) -> Result<Symbol> {
        let symbol = sqlx::query_as::<_, Symbol>(
            "SELECT id, code as symbol_code, provider_symbol, asset_class::text as asset_class, base_currency, quote_currency, price_precision, volume_precision, contract_size::text as contract_size, tick_size, lot_min, lot_max, default_pip_position, pip_position_min, pip_position_max, is_enabled, trading_enabled, leverage_profile_id, created_at, updated_at FROM symbols WHERE id = $1",
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
        tick_size: Option<&str>,
        lot_min: Option<&str>,
        lot_max: Option<&str>,
        default_pip_position: Option<&str>,
        pip_position_min: Option<&str>,
        pip_position_max: Option<&str>,
        leverage_profile_id: Option<Uuid>,
    ) -> Result<Symbol> {
        if symbol_code.len() < 2 || symbol_code.len() > 50 {
            return Err(anyhow::anyhow!("Symbol code must be between 2 and 50 characters"));
        }

        // Parse optional decimal fields
        let tick_size_decimal = tick_size.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let lot_min_decimal = lot_min.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let lot_max_decimal = lot_max.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let default_pip_position_decimal = default_pip_position.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let pip_position_min_decimal = pip_position_min.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let pip_position_max_decimal = pip_position_max.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());

        // Validate lot_min < lot_max if both provided
        if let (Some(min), Some(max)) = (lot_min_decimal, lot_max_decimal) {
            if min >= max {
                return Err(anyhow::anyhow!("lot_min must be less than lot_max"));
            }
        }

        let symbol = sqlx::query_as::<_, Symbol>(
            r#"
            INSERT INTO symbols (
                code, provider_symbol, asset_class, base_currency, quote_currency,
                price_precision, volume_precision, contract_size, tick_size, lot_min, lot_max, 
                default_pip_position, pip_position_min, pip_position_max, leverage_profile_id
            )
            VALUES ($1, $2, $3::asset_class, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric, 
                $12::numeric, $13::numeric, $14::numeric, $15)
            RETURNING id, code as symbol_code, provider_symbol, asset_class::text as asset_class, 
                base_currency, quote_currency, price_precision, volume_precision, 
                contract_size::text as contract_size, tick_size, lot_min, lot_max, 
                default_pip_position, pip_position_min, pip_position_max, is_enabled, trading_enabled, 
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
        .bind(tick_size_decimal)
        .bind(lot_min_decimal)
        .bind(lot_max_decimal)
        .bind(default_pip_position_decimal)
        .bind(pip_position_min_decimal)
        .bind(pip_position_max_decimal)
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
        tick_size: Option<&str>,
        lot_min: Option<&str>,
        lot_max: Option<&str>,
        default_pip_position: Option<&str>,
        pip_position_min: Option<&str>,
        pip_position_max: Option<&str>,
        is_enabled: bool,
        trading_enabled: bool,
        leverage_profile_id: Option<Uuid>,
    ) -> Result<Symbol> {
        // Parse optional decimal fields
        let tick_size_decimal = tick_size.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let lot_min_decimal = lot_min.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let lot_max_decimal = lot_max.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let default_pip_position_decimal = default_pip_position.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let pip_position_min_decimal = pip_position_min.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());
        let pip_position_max_decimal = pip_position_max.and_then(|s| s.parse::<rust_decimal::Decimal>().ok());

        // Validate lot_min < lot_max if both provided
        if let (Some(min), Some(max)) = (lot_min_decimal, lot_max_decimal) {
            if min >= max {
                return Err(anyhow::anyhow!("lot_min must be less than lot_max"));
            }
        }

        // Validate pip_position_min < pip_position_max if both provided
        if let (Some(min), Some(max)) = (pip_position_min_decimal, pip_position_max_decimal) {
            if min >= max {
                return Err(anyhow::anyhow!("pip_position_min must be less than pip_position_max"));
            }
        }

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
                tick_size = $10::numeric,
                lot_min = $11::numeric,
                lot_max = $12::numeric,
                default_pip_position = $13::numeric,
                pip_position_min = $14::numeric,
                pip_position_max = $15::numeric,
                is_enabled = $16,
                trading_enabled = $17,
                leverage_profile_id = $18,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, code as symbol_code, provider_symbol, asset_class::text as asset_class, 
                base_currency, quote_currency, price_precision, volume_precision, 
                contract_size::text as contract_size, tick_size, lot_min, lot_max, 
                default_pip_position, pip_position_min, pip_position_max, is_enabled, trading_enabled, 
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
        .bind(tick_size_decimal)
        .bind(lot_min_decimal)
        .bind(lot_max_decimal)
        .bind(default_pip_position_decimal)
        .bind(pip_position_min_decimal)
        .bind(pip_position_max_decimal)
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
                contract_size::text as contract_size, tick_size, lot_min, lot_max, 
                default_pip_position, pip_position_min, pip_position_max, is_enabled, trading_enabled, 
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

