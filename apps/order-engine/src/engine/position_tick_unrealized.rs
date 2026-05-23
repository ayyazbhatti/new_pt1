//! On each price tick, refresh `unrealized_pnl` (quote) and `unrealized_pnl_usd_e6` on open
//! `pos:by_id:*` hashes for the symbol, then re-run the Redis Lua aggregate per affected user.
//!
//! Uses `fx:rates:usd` (same JSON as auth-service) and a suffix-based **quote currency guess** for
//! instruments where the position hash has no `quote_currency` field.

use anyhow::Result;
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use rust_decimal::Decimal;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use tracing::debug;
use uuid::Uuid;

use redis_model::keys::Keys;
use redis_model::{
    aggregate_user_unrealized_usd_e6_in_redis, decimal_usd_to_micro_e6, key_swap_open_usd_e6_cache,
    FIELD_UNREALIZED_PNL_USD_E6,
};

const FX_RATES_REDIS_KEY: &str = "fx:rates:usd";

#[derive(serde::Deserialize)]
struct FxBody {
    rates: HashMap<String, serde_json::Value>,
}

fn norm_currency(code: &str) -> String {
    let u = code.trim().to_ascii_uppercase();
    if u == "USDT" {
        "USD".to_string()
    } else {
        u
    }
}

fn parse_fx_rates_json(json: &str) -> Option<HashMap<String, Decimal>> {
    let body: FxBody = serde_json::from_str(json).ok()?;
    let mut out = HashMap::new();
    for (k, v) in body.rates {
        let key = k.trim().to_ascii_uppercase();
        let s = match &v {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            _ => v.to_string(),
        };
        let d = Decimal::from_str(s.trim()).ok()?;
        if d > Decimal::ZERO {
            out.insert(key, d);
        }
    }
    out.insert("USD".into(), Decimal::ONE);
    out.insert("USDT".into(), Decimal::ONE);
    Some(out)
}

fn convert_with_rates(
    amount: Decimal,
    from: &str,
    to: &str,
    rates: &HashMap<String, Decimal>,
) -> Option<Decimal> {
    let f = norm_currency(from);
    let t = norm_currency(to);
    if f == t {
        return Some(amount);
    }
    let rate_from = rates.get(&f)?;
    let rate_to = rates.get(&t)?;
    if *rate_from == Decimal::ZERO {
        return None;
    }
    Some(amount * *rate_to / *rate_from)
}

fn infer_quote(symbol: &str) -> String {
    static QUOTES: &[&str] = &[
        "USDT", "USDC", "EUR", "GBP", "AUD", "NZD", "CAD", "CHF", "JPY", "SGD", "TRY", "SEK", "NOK",
        "DKK", "CNH", "HKD", "HUF", "PLN", "ZAR", "MXN", "CNY", "USD",
    ];
    let s = symbol.trim().to_ascii_uppercase();
    for q in QUOTES {
        if s.ends_with(*q) {
            return (*q).to_string();
        }
    }
    "USD".to_string()
}

/// After `prices:…` is updated for this tick, refresh open positions on `pos:open:{symbol}` and
/// per-user aggregates. `tick_group_id`: `None` or `Some("")` = global tick (all groups on symbol).
pub async fn refresh_symbol_positions_unrealized(
    conn: &mut ConnectionManager,
    symbol: &str,
    bid: Decimal,
    ask: Decimal,
    tick_group_id: Option<&str>,
) -> Result<()> {
    let rates_raw: Option<String> = conn.get(FX_RATES_REDIS_KEY).await.ok().flatten();
    let Some(json) = rates_raw else {
        debug!("order-engine tick unrealized: missing {}", FX_RATES_REDIS_KEY);
        return Ok(());
    };
    let Some(rates) = parse_fx_rates_json(&json) else {
        debug!("order-engine tick unrealized: invalid fx json");
        return Ok(());
    };

    let sym = symbol.trim();
    let open_key = Keys::positions_open_by_symbol(sym);
    let pos_ids: Vec<String> = conn.zrange(&open_key, 0, -1).await.unwrap_or_default();
    if pos_ids.is_empty() {
        return Ok(());
    }

    let tick_g = tick_group_id.map(str::trim).filter(|s| !s.is_empty());
    let quote_ccy = infer_quote(sym);

    #[derive(Debug)]
    struct Upd {
        pos_key: String,
        unreal_quote: Decimal,
        micro: i64,
        user_id: Option<Uuid>,
    }
    let mut batch: Vec<Upd> = Vec::new();

    for pid_str in pos_ids {
        let Ok(pos_id) = Uuid::parse_str(&pid_str) else {
            continue;
        };
        let pos_key = Keys::position_by_id(pos_id);
        let m: HashMap<String, String> = conn.hgetall(&pos_key).await.unwrap_or_default();
        let status_open = m
            .get("status")
            .map(|s| s.eq_ignore_ascii_case("OPEN"))
            .unwrap_or(false);
        if !status_open {
            continue;
        }
        let gid = m.get("group_id").map(|s| s.as_str()).unwrap_or("");
        if let Some(tg) = tick_g {
            if gid != tg {
                continue;
            }
        }

        let size = m
            .get("size")
            .and_then(|s| Decimal::from_str_exact(s).ok())
            .unwrap_or(Decimal::ZERO);
        let avg = m
            .get("avg_price")
            .or_else(|| m.get("entry_price"))
            .and_then(|s| Decimal::from_str_exact(s).ok())
            .unwrap_or(Decimal::ZERO);
        let side = m.get("side").map(|s| s.as_str()).unwrap_or("LONG");
        let unreal_quote = match side {
            "LONG" => (bid - avg) * size,
            "SHORT" => (avg - ask) * size,
            _ => m
                .get("unrealized_pnl")
                .and_then(|s| Decimal::from_str_exact(s).ok())
                .unwrap_or(Decimal::ZERO),
        };
        let unreal_usd = convert_with_rates(unreal_quote, quote_ccy.as_str(), "USD", &rates)
            .unwrap_or(Decimal::ZERO);
        let micro = decimal_usd_to_micro_e6(unreal_usd);
        let user_id = m
            .get("user_id")
            .and_then(|s| Uuid::parse_str(s).ok());
        batch.push(Upd {
            pos_key,
            unreal_quote,
            micro,
            user_id,
        });
    }

    if batch.is_empty() {
        return Ok(());
    }

    let mut affected_users: HashSet<Uuid> = HashSet::new();
    let mut pipe = redis::pipe();
    for u in &batch {
        pipe.hset(&u.pos_key, FIELD_UNREALIZED_PNL_USD_E6, u.micro.to_string())
            .hset(
                &u.pos_key,
                "unrealized_pnl",
                u.unreal_quote.normalize().to_string(),
            );
        if let Some(uid) = u.user_id {
            affected_users.insert(uid);
        }
    }
    let _: () = pipe.query_async(conn).await?;

    for uid in affected_users {
        let sk = key_swap_open_usd_e6_cache(uid);
        let swap_e6: i64 = conn
            .get::<_, Option<String>>(&sk)
            .await
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let _ = aggregate_user_unrealized_usd_e6_in_redis(conn, uid, swap_e6).await;
    }

    Ok(())
}
