use crate::models::symbol::{Symbol, SymbolWithProfile};
use anyhow::Result;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct MmdpsSymbolsBody {
    symbols: Vec<MmdpsSymbolRow>,
}

#[derive(Debug, Deserialize)]
struct MmdpsSymbolRow {
    name: String,
    description: Option<String>,
    category: String,
}

/// Result of [AdminSymbolsService::sync_from_mmdps].
#[derive(Debug, Clone, Serialize)]
pub struct SyncMmdpsResult {
    pub fetched: usize,
    pub upserted: usize,
    pub skipped: usize,
    /// Total rows in `symbols` after this sync (same database as auth-service).
    pub db_symbol_count: i64,
    pub categories_seen: std::collections::HashMap<String, usize>,
    /// When `prune_stocks_not_in_mmdps_feed` was true: stocks/indices rows disabled (not in feed).
    pub disabled_stocks_not_in_feed: Option<i64>,
}

fn split_six_letter_pair(code: &str) -> Option<(String, String)> {
    let u = code.trim();
    if u.len() != 6 || !u.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some((u[0..3].to_uppercase(), u[3..6].to_uppercase()))
}

/// `symbols.base_currency` / `quote_currency` are VARCHAR(10) in many deployments.
fn clip_currency(s: &str) -> String {
    s.chars().take(10).collect()
}

fn map_mmdps_symbol(
    row: &MmdpsSymbolRow,
    enable_forex: bool,
    enable_metals: bool,
    enable_stocks: bool,
    enable_crypto: bool,
) -> Option<(
    String,
    String,
    &'static str,
    &'static str,
    String,
    String,
    i32,
    i32,
    &'static str,
    bool,
)> {
    let raw = row.name.trim();
    if raw.is_empty() || raw.len() > 50 {
        return None;
    }
    let code = raw.to_uppercase();
    let provider_symbol = code.to_lowercase();
    let cat = row.category.trim().to_ascii_lowercase();

    if cat == "forex" || cat == "fx" {
        if !enable_forex {
            return None;
        }
        if let Some((base, quote)) = split_six_letter_pair(&code) {
            return Some((
                code,
                provider_symbol,
                "FX",
                "forex",
                clip_currency(&base),
                clip_currency(&quote),
                5,
                2,
                "100000",
                true,
            ));
        }
        // Still store the symbol: best-effort FX row (e.g. non–6-letter codes from the feed).
        let base_fb = clip_currency(&code);
        return Some((
            code,
            provider_symbol,
            "FX",
            "forex",
            base_fb,
            clip_currency("USD"),
            5,
            2,
            "100000",
            true,
        ));
    }

    if cat.contains("metal") || cat == "metals" || cat == "precious" {
        if !enable_metals {
            return None;
        }
        if let Some((base, quote)) = split_six_letter_pair(&code) {
            return Some((
                code,
                provider_symbol,
                "Metals",
                "commodities",
                clip_currency(&base),
                clip_currency(&quote),
                2,
                2,
                "100",
                true,
            ));
        }
        let base_fb = clip_currency(&code);
        return Some((
            code,
            provider_symbol,
            "Metals",
            "commodities",
            base_fb,
            clip_currency("USD"),
            2,
            2,
            "100",
            true,
        ));
    }

    if cat == "nasdaq"
        || cat.contains("stock")
        || cat == "stocks"
        || cat == "equities"
        || cat == "nyse"
    {
        if !enable_stocks {
            return None;
        }
        let base = clip_currency(&code);
        return Some((
            code.clone(),
            provider_symbol,
            "Stocks",
            "stocks",
            base,
            clip_currency("USD"),
            2,
            2,
            "1",
            false,
        ));
    }

    if cat == "crypto" || cat.contains("crypto") {
        if !enable_crypto {
            return None;
        }
        let u = code.as_str();
        if u.len() > 4 && u.ends_with("USDT") {
            let base = clip_currency(&u[..u.len() - 4]);
            return Some((
                code.clone(),
                provider_symbol,
                "Crypto",
                "crypto",
                base,
                clip_currency("USDT"),
                2,
                6,
                "1",
                true,
            ));
        }
        return Some((
            code.clone(),
            provider_symbol,
            "Crypto",
            "crypto",
            clip_currency(&code),
            clip_currency("USD"),
            2,
            6,
            "1",
            true,
        ));
    }

    if cat == "indices" || cat.contains("index") {
        if !enable_stocks {
            return None;
        }
        let base = clip_currency(&code);
        return Some((
            code.clone(),
            provider_symbol,
            "Indices",
            "indices",
            base,
            clip_currency("USD"),
            2,
            2,
            "1",
            false,
        ));
    }

    // Unknown category: still persist so new/odd feed labels are not dropped.
    // (Known buckets above still honor their enable_* flags.)
    let base = clip_currency(&code);
    Some((
        code.clone(),
        provider_symbol,
        "Stocks",
        "stocks",
        base,
        clip_currency("USD"),
        2,
        2,
        "1",
        false,
    ))
}

/// Default for tick_size when not provided (DB column is NOT NULL).
fn default_tick_size() -> Decimal {
    Decimal::new(1, 2) // 0.01
}
/// Default for lot_min when not provided (DB column is NOT NULL).
fn default_lot_min() -> Decimal {
    Decimal::new(1, 2) // 0.01
}

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
                s.mmdps_category,
                s.provider_description,
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
                NULL::text as mmdps_category,
                NULL::text as provider_description,
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
                mmdps_category: row.get("mmdps_category"),
                provider_description: row.get("provider_description"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();
        Ok(symbols)
    }

    pub async fn get_symbol_by_id(&self, id: Uuid) -> Result<Symbol> {
        let symbol = sqlx::query_as::<_, Symbol>(
            "SELECT id, code as symbol_code, provider_symbol, asset_class::text as asset_class, base_currency, quote_currency, price_precision, volume_precision, contract_size::text as contract_size, tick_size, lot_min, lot_max, default_pip_position, pip_position_min, pip_position_max, is_enabled, trading_enabled, leverage_profile_id, mmdps_category, provider_description, created_at, updated_at FROM symbols WHERE id = $1",
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

        // Parse optional decimal fields; use DB-compatible defaults for NOT NULL columns when omitted
        let tick_size_decimal = tick_size
            .and_then(|s| s.parse::<Decimal>().ok())
            .unwrap_or_else(default_tick_size);
        let lot_min_decimal = lot_min
            .and_then(|s| s.parse::<Decimal>().ok())
            .unwrap_or_else(default_lot_min);
        let lot_max_decimal = lot_max.and_then(|s| s.parse::<Decimal>().ok());
        let default_pip_position_decimal = default_pip_position.and_then(|s| s.parse::<Decimal>().ok());
        let pip_position_min_decimal = pip_position_min.and_then(|s| s.parse::<Decimal>().ok());
        let pip_position_max_decimal = pip_position_max.and_then(|s| s.parse::<Decimal>().ok());

        // Validate lot_min < lot_max if both provided
        if let Some(max) = lot_max_decimal {
            if lot_min_decimal >= max {
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
                leverage_profile_id, mmdps_category, provider_description, created_at, updated_at
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
        // Parse optional decimal fields; use DB-compatible defaults for NOT NULL columns when omitted
        let tick_size_decimal = tick_size
            .and_then(|s| s.parse::<Decimal>().ok())
            .unwrap_or_else(default_tick_size);
        let lot_min_decimal = lot_min
            .and_then(|s| s.parse::<Decimal>().ok())
            .unwrap_or_else(default_lot_min);
        let lot_max_decimal = lot_max.and_then(|s| s.parse::<Decimal>().ok());
        let default_pip_position_decimal = default_pip_position.and_then(|s| s.parse::<Decimal>().ok());
        let pip_position_min_decimal = pip_position_min.and_then(|s| s.parse::<Decimal>().ok());
        let pip_position_max_decimal = pip_position_max.and_then(|s| s.parse::<Decimal>().ok());

        // Validate lot_min < lot_max if both provided
        if let Some(max) = lot_max_decimal {
            if lot_min_decimal >= max {
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
                leverage_profile_id, mmdps_category, provider_description, created_at, updated_at
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
                leverage_profile_id, mmdps_category, provider_description, created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(is_enabled)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Symbol not found"))?;

        Ok(symbol)
    }

    /// Enable/disable many symbols in one query. Returns `(id, symbol_code, is_enabled)` per updated row.
    pub async fn bulk_toggle_enabled(
        &self,
        ids: &[Uuid],
        is_enabled: bool,
    ) -> Result<Vec<(Uuid, String, bool)>> {
        const MAX_BULK: usize = 500;
        if ids.is_empty() {
            return Ok(vec![]);
        }
        if ids.len() > MAX_BULK {
            return Err(anyhow::anyhow!("Too many symbols (max {MAX_BULK} per request)"));
        }
        let rows = sqlx::query_as::<_, (Uuid, String, bool)>(
            r#"
            UPDATE symbols
            SET is_enabled = $2, updated_at = NOW()
            WHERE id = ANY($1)
            RETURNING id, code, is_enabled
            "#,
        )
        .bind(ids)
        .bind(is_enabled)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    /// Fetches `/feed/symbols` from MMDPS and upserts into `symbols`.
    /// Uses `MMDPS_API_KEY` and optional `MMDPS_SYMBOLS_URL` (default `https://api.mmdps.uk/feed/symbols`).
    /// New rows get `is_enabled` / `trading_enabled` from the mapped default; existing rows keep flags and leverage.
    /// After upserting from MMDPS `/feed/symbols`, optionally disable **stocks** and **indices**
    /// rows whose `code` is **not** in the feed list. **Never** touches `Crypto` / `market = crypto`
    /// (Binance) or forex/metals/commodities — only `asset_class` + `market` in `Stocks`/`Indices`.
    pub async fn sync_from_mmdps(
        &self,
        enable_forex: bool,
        enable_metals: bool,
        enable_stocks: bool,
        enable_crypto: bool,
        prune_stocks_not_in_mmdps_feed: bool,
    ) -> Result<SyncMmdpsResult> {
        let base = std::env::var("MMDPS_SYMBOLS_URL")
            .unwrap_or_else(|_| "https://api.mmdps.uk/feed/symbols".to_string());
        let mut url =
            reqwest::Url::parse(&base).map_err(|e| anyhow::anyhow!("MMDPS_SYMBOLS_URL: {e}"))?;
        let has_api_key = url
            .query_pairs()
            .any(|(k, _)| k.eq_ignore_ascii_case("api_key"));
        if !has_api_key {
            let api_key = crate::services::data_provider_integrations_service::DataProviderIntegrationsService::resolve_mmdps_api_key(&self.pool)
                .await
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "Set the MMDPS API key in Admin → Settings → Integrations, or set MMDPS_API_KEY, or include api_key= in MMDPS_SYMBOLS_URL"
                    )
                })?;
            url.query_pairs_mut().append_pair("api_key", &api_key);
        }

        // Large JSON + thousands of upserts: allow a long HTTP read on the auth-service side.
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()?;
        let res = client.get(url).send().await?.error_for_status()?;
        let body: MmdpsSymbolsBody = res.json().await?;

        let tick = default_tick_size();
        let lot_min = default_lot_min();
        let fetched = body.symbols.len();
        let mut upserted = 0usize;
        let mut skipped = 0usize;
        let mut categories_seen = std::collections::HashMap::<String, usize>::new();

        for row in &body.symbols {
            let ck = row.category.trim().to_string();
            *categories_seen.entry(ck).or_insert(0) += 1;
            let Some(mapped) = map_mmdps_symbol(
                row,
                enable_forex,
                enable_metals,
                enable_stocks,
                enable_crypto,
            ) else {
                skipped += 1;
                continue;
            };
            let (
                code,
                provider_symbol,
                asset_class,
                market,
                base_c,
                quote_c,
                price_precision,
                volume_precision,
                contract_size,
                default_enabled,
            ) = mapped;
            let mmdps_cat_trim = row.category.trim();
            let mmdps_cat = if mmdps_cat_trim.is_empty() {
                None
            } else {
                Some(mmdps_cat_trim.to_string())
            };
            let desc = row
                .description
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            match sqlx::query(
                r#"
                INSERT INTO symbols (
                    code, provider_symbol, asset_class, base_currency, quote_currency,
                    price_precision, volume_precision, contract_size, tick_size, lot_min, lot_max,
                    default_pip_position, pip_position_min, pip_position_max,
                    leverage_profile_id, is_enabled, trading_enabled, market,
                    mmdps_category, provider_description
                ) VALUES (
                    $1, $2, $3::asset_class, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric,
                    NULL, NULL, NULL, NULL, $12, $13, $14::market_type, $15, $16
                )
                ON CONFLICT (code) DO UPDATE SET
                    provider_symbol = EXCLUDED.provider_symbol,
                    asset_class = EXCLUDED.asset_class,
                    base_currency = EXCLUDED.base_currency,
                    quote_currency = EXCLUDED.quote_currency,
                    price_precision = EXCLUDED.price_precision,
                    volume_precision = EXCLUDED.volume_precision,
                    contract_size = EXCLUDED.contract_size,
                    tick_size = EXCLUDED.tick_size,
                    lot_min = EXCLUDED.lot_min,
                    lot_max = EXCLUDED.lot_max,
                    market = EXCLUDED.market,
                    mmdps_category = EXCLUDED.mmdps_category,
                    provider_description = EXCLUDED.provider_description,
                    updated_at = NOW()
                "#,
            )
            .bind(&code)
            .bind(&provider_symbol)
            .bind(asset_class)
            .bind(&base_c)
            .bind(&quote_c)
            .bind(price_precision)
            .bind(volume_precision)
            .bind(contract_size)
            .bind(tick)
            .bind(lot_min)
            .bind(Option::<Decimal>::None)
            .bind(default_enabled)
            .bind(default_enabled)
            .bind(market)
            .bind(mmdps_cat)
            .bind(desc)
            .execute(&self.pool)
            .await
            {
                Ok(_) => upserted += 1,
                Err(e) => {
                    tracing::warn!(error = %e, code = %code, "mmdps symbol upsert failed; row skipped");
                    skipped += 1;
                }
            }
        }

        let db_symbol_count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM symbols")
            .fetch_one(&self.pool)
            .await?;

        let mut disabled_stocks_not_in_feed: Option<i64> = None;
        if prune_stocks_not_in_mmdps_feed {
            let mut allow: std::collections::HashSet<String> = std::collections::HashSet::new();
            for row in &body.symbols {
                let c = row.name.trim().to_uppercase();
                if !c.is_empty() && c.len() <= 50 {
                    allow.insert(c);
                }
            }
            let allow_vec: Vec<String> = allow.into_iter().collect();
            if allow_vec.is_empty() {
                tracing::warn!("MMDPS prune skipped: feed returned no symbol names");
            } else {
                let res = sqlx::query(
                    r#"
                    UPDATE symbols
                    SET is_enabled = false, trading_enabled = false, updated_at = NOW()
                    WHERE (asset_class::text IN ('Stocks', 'Indices'))
                      AND (market::text IN ('stocks', 'indices'))
                      AND COALESCE(asset_class::text, '') IS DISTINCT FROM 'Crypto'
                      AND COALESCE(market::text, '') IS DISTINCT FROM 'crypto'
                      AND NOT (UPPER(TRIM(code)) = ANY($1::text[]))
                    "#,
                )
                .bind(&allow_vec)
                .execute(&self.pool)
                .await?;
                let n = res.rows_affected() as i64;
                disabled_stocks_not_in_feed = Some(n);
                tracing::info!(
                    "MMDPS prune: disabled {} stocks/indices rows not in /feed/symbols allowlist",
                    n
                );
            }
        }

        Ok(SyncMmdpsResult {
            fetched,
            upserted,
            skipped,
            db_symbol_count,
            categories_seen,
            disabled_stocks_not_in_feed,
        })
    }
}

