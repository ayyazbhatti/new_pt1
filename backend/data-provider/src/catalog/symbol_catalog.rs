//! Resolve feed symbols that should use MMDPS upstream (matches [`crate::feeds::routing::resolve_feed`]
//! intent: non–Binance-spot-style instruments from the catalog).

use crate::feeds::routing::is_binance_spot_style;
use anyhow::Context;
use sqlx::PgPool;
use std::collections::HashSet;

/// Rows that need MMDPS (or mock) upstream — excludes Binance-style tickers so we do not
/// duplicate Binance multiplex subscriptions.
#[allow(clippy::too_many_lines)]
pub async fn fetch_mmdps_catalog_symbols(pool: &PgPool) -> anyhow::Result<Vec<String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT
            UPPER(TRIM(code)) AS code,
            UPPER(TRIM(COALESCE(NULLIF(TRIM(provider_symbol), ''), code))) AS feed_symbol
        FROM symbols
        WHERE is_enabled = true
          AND trading_enabled = true
          AND (
            (mmdps_category IS NOT NULL AND LENGTH(TRIM(mmdps_category)) > 0)
            OR market::text IN ('forex', 'commodities', 'indices', 'stocks')
            OR COALESCE(data_provider, '') ILIKE 'MMDPS'
          )
        "#,
    )
    .fetch_all(pool)
    .await
    .context("symbol catalog query failed (check DB URL and migrations)")?;

    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (_code, feed_symbol) in rows {
        let key = feed_symbol.trim().to_uppercase();
        if key.is_empty() {
            continue;
        }
        if is_binance_spot_style(&key) {
            continue;
        }
        if seen.insert(key.clone()) {
            out.push(key);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use crate::feeds::routing::is_binance_spot_style;

    #[test]
    fn binance_style_skipped_by_definition() {
        assert!(is_binance_spot_style("BTCUSDT"));
        assert!(!is_binance_spot_style("EURUSD"));
        assert!(!is_binance_spot_style("USDZAR"));
        assert!(!is_binance_spot_style("XPTUSD"));
    }
}
