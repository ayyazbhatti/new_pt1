//! USD-based FX rates cache (Redis). Fetched from Frankfurter (primary) or open.er-api (fallback).
//! Phase 1: infrastructure only — not wired into account summary yet.

use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::time::Duration;
use tracing::warn;

use crate::redis_pool::RedisPool;

/// Redis string key holding JSON `FxRatesPayload` (full snapshot).
pub const FX_RATES_REDIS_KEY: &str = "fx:rates:usd";

const FRANKFURTER_URL: &str = "https://api.frankfurter.app/latest?from=USD";
const OPEN_ER_URL: &str = "https://open.er-api.com/v6/latest/USD";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxRatesSnapshot {
    /// 1 USD = N units of this currency (e.g. HUF ≈ 360).
    pub rates: HashMap<String, Decimal>,
    pub fetched_at: DateTime<Utc>,
    pub source: String,
    pub is_stale: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct FxRatesPayload {
    rates: HashMap<String, String>,
    fetched_at: String,
    source: String,
    is_stale: bool,
}

impl TryFrom<FxRatesPayload> for FxRatesSnapshot {
    type Error = FxError;

    fn try_from(p: FxRatesPayload) -> Result<Self, Self::Error> {
        let mut rates = HashMap::with_capacity(p.rates.len());
        for (k, v) in p.rates {
            let key = k.trim().to_ascii_uppercase();
            let d = Decimal::from_str_exact(v.trim()).map_err(|e| {
                FxError::Redis(format!("parse cached rate {}={}: {}", key, v, e))
            })?;
            rates.insert(key, d);
        }
        let fetched_at = DateTime::parse_from_rfc3339(&p.fetched_at)
            .map_err(|e| FxError::Redis(format!("parse fetched_at: {}", e)))?
            .with_timezone(&Utc);
        Ok(FxRatesSnapshot {
            rates,
            fetched_at,
            source: p.source,
            is_stale: p.is_stale,
        })
    }
}

fn snapshot_to_payload(s: &FxRatesSnapshot) -> FxRatesPayload {
    let rates = s
        .rates
        .iter()
        .map(|(k, v)| (k.clone(), v.normalize().to_string()))
        .collect();
    FxRatesPayload {
        rates,
        fetched_at: s.fetched_at.to_rfc3339(),
        source: s.source.clone(),
        is_stale: s.is_stale,
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FxError {
    #[error("redis error: {0}")]
    Redis(String),
    #[error("all upstream APIs failed and no cache available")]
    NoData,
    #[error("currency '{0}' not in current rate snapshot")]
    UnsupportedCurrency(String),
    #[error("invalid rate (zero) for currency '{0}'")]
    ZeroRate(String),
}

fn norm_currency(code: &str) -> String {
    let u = code.trim().to_ascii_uppercase();
    if u == "USDT" {
        "USD".to_string()
    } else {
        u
    }
}

fn parse_rates_object(obj: &serde_json::Map<String, serde_json::Value>) -> Result<HashMap<String, Decimal>, FxError> {
    let mut out = HashMap::new();
    for (k, v) in obj {
        let key = k.trim().to_ascii_uppercase();
        let s = match v {
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => s.clone(),
            _ => v.to_string(),
        };
        let d = Decimal::from_str_exact(s.trim()).map_err(|e| {
            FxError::Redis(format!("parse rate {}={}: {}", key, s, e))
        })?;
        if d > Decimal::ZERO {
            out.insert(key, d);
        }
    }
    Ok(out)
}

async fn fetch_frankfurter(http: &reqwest::Client) -> Result<HashMap<String, Decimal>, FxError> {
    let resp = http
        .get(FRANKFURTER_URL)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| FxError::Redis(format!("frankfurter request: {}", e)))?;
    if !resp.status().is_success() {
        return Err(FxError::Redis(format!(
            "frankfurter HTTP {}",
            resp.status()
        )));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| FxError::Redis(format!("frankfurter json: {}", e)))?;
    let obj = v
        .get("rates")
        .and_then(|x| x.as_object())
        .ok_or_else(|| FxError::Redis("frankfurter: missing rates".into()))?;
    parse_rates_object(obj)
}

async fn fetch_open_er(http: &reqwest::Client) -> Result<HashMap<String, Decimal>, FxError> {
    let resp = http
        .get(OPEN_ER_URL)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| FxError::Redis(format!("open.er-api request: {}", e)))?;
    if !resp.status().is_success() {
        return Err(FxError::Redis(format!(
            "open.er-api HTTP {}",
            resp.status()
        )));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| FxError::Redis(format!("open.er-api json: {}", e)))?;
    if v.get("result").and_then(|r| r.as_str()) != Some("success") {
        return Err(FxError::Redis("open.er-api: result != success".into()));
    }
    let obj = v
        .get("rates")
        .and_then(|x| x.as_object())
        .ok_or_else(|| FxError::Redis("open.er-api: missing rates".into()))?;
    parse_rates_object(obj)
}

fn inject_usd_usdt(rates: &mut HashMap<String, Decimal>) {
    rates.insert("USD".into(), Decimal::ONE);
    rates.insert("USDT".into(), Decimal::ONE);
}

/// Fetch latest snapshot from cache. Returns `None` if cache is empty.
pub async fn get_cached_snapshot(redis: &RedisPool) -> Result<Option<FxRatesSnapshot>, FxError> {
    let mut conn = redis
        .get()
        .await
        .map_err(|_| FxError::Redis("redis unavailable (circuit open)".into()))?;
    let data: Option<String> = conn
        .get(FX_RATES_REDIS_KEY)
        .await
        .map_err(|e| FxError::Redis(e.to_string()))?;
    let Some(json) = data else {
        return Ok(None);
    };
    let payload: FxRatesPayload =
        serde_json::from_str(&json).map_err(|e| FxError::Redis(format!("cache json: {}", e)))?;
    Ok(Some(FxRatesSnapshot::try_from(payload)?))
}

async fn write_snapshot(redis: &RedisPool, snapshot: &FxRatesSnapshot) -> Result<(), FxError> {
    let mut conn = redis
        .get()
        .await
        .map_err(|_| FxError::Redis("redis unavailable (circuit open)".into()))?;
    let payload = snapshot_to_payload(snapshot);
    let json = serde_json::to_string(&payload).map_err(|e| FxError::Redis(e.to_string()))?;
    conn.set::<_, _, ()>(FX_RATES_REDIS_KEY, json)
        .await
        .map_err(|e| FxError::Redis(e.to_string()))?;
    Ok(())
}

/// Fetch fresh rates from APIs (with fallback), write to cache, return snapshot.
pub async fn fetch_and_cache(redis: &RedisPool, http: &reqwest::Client) -> Result<FxRatesSnapshot, FxError> {
    let (mut rates, source) = match fetch_frankfurter(http).await {
        Ok(r) => {
            tracing::info!("FX: frankfurter returned {} currencies", r.len());
            (r, "frankfurter".to_string())
        }
        Err(e1) => {
            warn!("FX frankfurter failed: {}", e1);
            match fetch_open_er(http).await {
                Ok(r) => {
                    tracing::info!("FX: open.er-api returned {} currencies", r.len());
                    (r, "open_er_api".to_string())
                }
                Err(e2) => {
                    warn!("FX open.er-api failed: {}", e2);
                    if let Some(mut snap) = get_cached_snapshot(redis).await? {
                        snap.is_stale = true;
                        snap.source = "stale_cache".into();
                        return Ok(snap);
                    }
                    return Err(FxError::NoData);
                }
            }
        }
    };

    inject_usd_usdt(&mut rates);
    let snapshot = FxRatesSnapshot {
        rates,
        fetched_at: Utc::now(),
        source,
        is_stale: false,
    };
    write_snapshot(redis, &snapshot).await?;
    Ok(snapshot)
}

/// Convert using a rate map (`1 USD = rate[currency]` units). Used by [`convert`] and unit tests.
pub fn convert_with_rates(
    amount: Decimal,
    from: &str,
    to: &str,
    rates: &HashMap<String, Decimal>,
) -> Result<Decimal, FxError> {
    let f = norm_currency(from);
    let t = norm_currency(to);
    if f == t {
        return Ok(amount);
    }
    let rate_from = rates
        .get(&f)
        .ok_or_else(|| FxError::UnsupportedCurrency(f.clone()))?;
    let rate_to = rates
        .get(&t)
        .ok_or_else(|| FxError::UnsupportedCurrency(t.clone()))?;
    if *rate_from == Decimal::ZERO {
        return Err(FxError::ZeroRate(f));
    }
    Ok(amount * *rate_to / *rate_from)
}

/// Convert `amount` from `from` currency to `to` using the Redis snapshot.
pub async fn convert(
    redis: &RedisPool,
    amount: Decimal,
    from: &str,
    to: &str,
) -> Result<Decimal, FxError> {
    let snap = get_cached_snapshot(redis).await?.ok_or(FxError::NoData)?;
    convert_with_rates(amount, from, to, &snap.rates)
}

/// Convert `amount` in `from` currency to USD (USDT treated as USD).
pub async fn to_usd(redis: &RedisPool, amount: Decimal, from: &str) -> Result<Decimal, FxError> {
    convert(redis, amount, from, "USD").await
}

/// JSON body for `/api/admin/fx-rates` and `/api/fx-rates/current` (camelCase keys).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxRatesApiPayload {
    /// Sorted for stable UI; values are decimal strings.
    pub rates: BTreeMap<String, String>,
    pub fetched_at: Option<String>,
    pub source: String,
    pub is_stale: bool,
}

pub fn snapshot_to_api_payload(s: &FxRatesSnapshot) -> FxRatesApiPayload {
    let mut rates: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in &s.rates {
        rates.insert(k.clone(), v.normalize().to_string());
    }
    FxRatesApiPayload {
        rates,
        fetched_at: Some(s.fetched_at.to_rfc3339()),
        source: s.source.clone(),
        is_stale: s.is_stale,
    }
}

pub fn empty_fx_api_payload() -> FxRatesApiPayload {
    FxRatesApiPayload {
        rates: BTreeMap::new(),
        fetched_at: None,
        source: "none".into(),
        is_stale: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_rates() -> HashMap<String, Decimal> {
        let mut m = HashMap::new();
        m.insert("USD".into(), Decimal::ONE);
        m.insert("USDT".into(), Decimal::ONE);
        m.insert("HUF".into(), Decimal::from_str_exact("360").unwrap());
        m.insert("PKR".into(), Decimal::from_str_exact("278.5").unwrap());
        m.insert("EUR".into(), Decimal::from_str_exact("0.92").unwrap());
        m.insert("GBP".into(), Decimal::from_str_exact("0.79").unwrap());
        m
    }

    #[test]
    fn convert_usd_to_usd() {
        let r = sample_rates();
        let out = convert_with_rates(Decimal::from(100), "USD", "USD", &r).unwrap();
        assert_eq!(out, Decimal::from(100));
    }

    #[test]
    fn convert_usdt_to_usd() {
        let r = sample_rates();
        let out = convert_with_rates(Decimal::from(100), "USDT", "USD", &r).unwrap();
        assert_eq!(out, Decimal::from(100));
    }

    #[test]
    fn convert_huf_to_usd() {
        let r = sample_rates();
        // 36000 HUF @ 360 HUF/USD = 100 USD
        let out = convert_with_rates(Decimal::from(36000), "HUF", "USD", &r).unwrap();
        assert_eq!(out, Decimal::from(100));
    }

    #[test]
    fn convert_usd_to_pkr() {
        let r = sample_rates();
        let out = convert_with_rates(Decimal::ONE, "USD", "PKR", &r).unwrap();
        assert_eq!(out, Decimal::from_str_exact("278.5").unwrap());
    }

    #[test]
    fn convert_eur_to_gbp_cross() {
        let r = sample_rates();
        // 100 EUR -> USD = 100/0.92, then -> GBP * 0.79
        let out = convert_with_rates(Decimal::from(100), "EUR", "GBP", &r).unwrap();
        let expected = Decimal::from(100) * Decimal::from_str_exact("0.79").unwrap()
            / Decimal::from_str_exact("0.92").unwrap();
        assert_eq!(out, expected);
    }
}
