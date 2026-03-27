use anyhow::{Context, Result};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::Value;
use std::str::FromStr;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

use crate::feeds::binance_feed::PriceState;

#[derive(Debug, Clone, Deserialize)]
struct AwsTick {
    #[serde(rename = "a")]
    ask: f64,
    #[serde(rename = "b")]
    bid: f64,
    #[serde(rename = "d")]
    digits: Option<u32>,
    #[serde(rename = "t")]
    ts: Option<u64>,
    #[serde(rename = "is_session_active")]
    is_session_active: Option<i64>,
}

#[derive(Clone)]
pub struct AwsFeed {
    ws_url: String,
    prices: Arc<RwLock<HashMap<String, PriceState>>>,
    msg_count: Arc<AtomicU64>,
    symbol_update_count: Arc<AtomicU64>,
    logged_unparsed_sample_once: Arc<AtomicBool>,
}

impl AwsFeed {
    pub fn new(ws_url: String) -> Self {
        Self {
            ws_url,
            prices: Arc::new(RwLock::new(HashMap::new())),
            msg_count: Arc::new(AtomicU64::new(0)),
            symbol_update_count: Arc::new(AtomicU64::new(0)),
            logged_unparsed_sample_once: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn ws_url(&self) -> &str {
        &self.ws_url
    }

    /// Connects to AWS WS and keeps `prices` updated.
    /// AWS pushes all symbols continuously; this maintains an in-memory last price per symbol.
    pub async fn run(self: Arc<Self>) -> Result<()> {
        info!("🌩️  Connecting to AWS WS: {}", self.ws_url);
        let (ws_stream, _resp) = connect_async(&self.ws_url)
            .await
            .with_context(|| format!("connect_async failed: {}", self.ws_url))?;

        info!("✅ Connected to AWS WS");
        let (_write, mut read) = ws_stream.split();

        use futures_util::StreamExt;
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(txt)) => {
                    self.process_text_message(&txt).await;
                }
                Ok(Message::Binary(bin)) => {
                    if let Ok(txt) = String::from_utf8(bin) {
                        self.process_text_message(&txt).await;
                    } else {
                        debug!("AWS WS: non-utf8 binary message ignored");
                    }
                }
                Ok(Message::Ping(_)) => {}
                Ok(Message::Pong(_)) => {}
                Ok(Message::Frame(_)) => {}
                Ok(Message::Close(frame)) => {
                    warn!("AWS WS closed: {:?}", frame);
                    break;
                }
                Err(e) => {
                    error!("AWS WS read error: {}", e);
                    break;
                }
            }
        }

        anyhow::bail!("AWS WS connection ended")
    }

    /// Placeholder: AWS feed pushes all symbols continuously, so we won't need
    /// per-symbol WS subscribe like Binance does.
    pub async fn subscribe_symbol(&self, _symbol: &str) -> Result<()> {
        Ok(())
    }

    pub async fn set_price(&self, symbol: &str, bid: Decimal, ask: Decimal, ts: u64) {
        let mut map = self.prices.write().await;
        map.insert(
            symbol.to_string(),
            PriceState {
                bid,
                ask,
                ts,
            },
        );
    }

    pub async fn get_price(&self, symbol: &str) -> Option<PriceState> {
        let map = self.prices.read().await;
        map.get(symbol).cloned()
    }

    async fn process_text_message(&self, txt: &str) {
        let ticks = match Self::parse_ticks(txt) {
            Some(v) => v,
            None => {
                // Keep this lightweight; useful to quickly identify envelope shape mismatches.
                let preview: String = txt.chars().take(160).collect();
                debug!("AWS WS: message not parsed as ticks map; preview={}", preview);
                if !self
                    .logged_unparsed_sample_once
                    .swap(true, Ordering::Relaxed)
                {
                    let sample: String = txt.chars().take(4000).collect();
                    info!(
                        "AWS WS unparsed sample (first 4000 chars, logged once): {}",
                        sample
                    );
                }
                return;
            }
        };

        let mut updated = 0u64;
        let mut map = self.prices.write().await;
        for (symbol, tick) in ticks {
            // If session closed, we still keep last price (UI may want to show last known).
            let bid = match Decimal::from_str(&tick.bid.to_string()) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let ask = match Decimal::from_str(&tick.ask.to_string()) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let ts = tick.ts.unwrap_or_else(|| chrono::Utc::now().timestamp_millis() as u64);

            map.insert(symbol, PriceState { bid, ask, ts });
            updated += 1;
        }

        let msg_n = self.msg_count.fetch_add(1, Ordering::Relaxed) + 1;
        self.symbol_update_count.fetch_add(updated, Ordering::Relaxed);

        // Log occasionally (every 200 messages) to avoid spam.
        if msg_n % 200 == 0 {
            let total_symbols = self.symbol_update_count.load(Ordering::Relaxed);
            info!(
                "🌩️  AWS feed ingest: messages={}, symbol_updates_total={} (last_msg_updates={})",
                msg_n, total_symbols, updated
            );
        } else {
            debug!("AWS feed msg: updated {} symbols", updated);
        }
    }

    fn parse_ticks(txt: &str) -> Option<HashMap<String, AwsTick>> {
        // 1) Direct map shape: { "EURUSD": {a,b,...}, "BTCUSD": {a,b,...} }
        if let Ok(map) = serde_json::from_str::<HashMap<String, AwsTick>>(txt) {
            if !map.is_empty() {
                return Some(map);
            }
        }

        // 2) Envelope/array shapes.
        let value: Value = serde_json::from_str(txt).ok()?;
        Self::parse_ticks_from_value(&value)
    }

    fn parse_ticks_from_value(value: &Value) -> Option<HashMap<String, AwsTick>> {
        // Common envelope keys used by WS providers.
        const ENVELOPES: [&str; 7] = ["data", "payload", "ticks", "prices", "result", "message", "body"];

        // Object case.
        if let Value::Object(obj) = value {
            // Try this object directly as symbol->tick map.
            if let Ok(map) = serde_json::from_value::<HashMap<String, AwsTick>>(value.clone()) {
                if !map.is_empty() {
                    return Some(map);
                }
            }

            // Try symbol -> rich object where tick is nested (e.g. metadata + nested price payload).
            let mut nested_map: HashMap<String, AwsTick> = HashMap::new();
            for (k, v) in obj {
                // Skip non-symbol envelope keys in this pass.
                if ENVELOPES.contains(&k.as_str()) {
                    continue;
                }
                if let Some(tick) = Self::find_tick_in_value(v, 4) {
                    nested_map.insert(k.clone(), tick);
                }
            }
            if !nested_map.is_empty() {
                return Some(nested_map);
            }

            // Try explicit envelope keys.
            for key in ENVELOPES {
                if let Some(inner) = obj.get(key) {
                    if let Some(map) = Self::parse_ticks_from_value(inner) {
                        if !map.is_empty() {
                            return Some(map);
                        }
                    }
                }
            }
        }

        // Array case: [ {symbol/s, a, b, ...}, ... ].
        if let Value::Array(items) = value {
            let mut out: HashMap<String, AwsTick> = HashMap::new();
            for item in items {
                if let Value::Object(obj) = item {
                    let symbol = obj
                        .get("symbol")
                        .and_then(Value::as_str)
                        .or_else(|| obj.get("s").and_then(Value::as_str))
                        .map(str::to_string);
                    let tick = serde_json::from_value::<AwsTick>(item.clone()).ok();
                    if let (Some(sym), Some(t)) = (symbol, tick) {
                        out.insert(sym, t);
                    }
                }
            }
            if !out.is_empty() {
                return Some(out);
            }
        }

        None
    }

    fn find_tick_in_value(value: &Value, depth: usize) -> Option<AwsTick> {
        if depth == 0 {
            return None;
        }

        if let Some(tick) = Self::tick_from_loose_value(value) {
            return Some(tick);
        }

        if let Ok(tick) = serde_json::from_value::<AwsTick>(value.clone()) {
            return Some(tick);
        }

        match value {
            Value::Object(obj) => {
                for nested in obj.values() {
                    if let Some(tick) = Self::find_tick_in_value(nested, depth - 1) {
                        return Some(tick);
                    }
                }
                None
            }
            Value::Array(items) => {
                for nested in items {
                    if let Some(tick) = Self::find_tick_in_value(nested, depth - 1) {
                        return Some(tick);
                    }
                }
                None
            }
            _ => None,
        }
    }

    fn tick_from_loose_value(value: &Value) -> Option<AwsTick> {
        let obj = match value {
            Value::Object(o) => o,
            _ => return None,
        };

        let ask = obj.get("a").and_then(Self::value_to_f64)
            .or_else(|| obj.get("ask").and_then(Self::value_to_f64))
            .or_else(|| obj.get("ask_price").and_then(Self::value_to_f64));
        let bid = obj.get("b").and_then(Self::value_to_f64)
            .or_else(|| obj.get("bid").and_then(Self::value_to_f64))
            .or_else(|| obj.get("bid_price").and_then(Self::value_to_f64));
        let ts = obj.get("t").and_then(Self::value_to_u64)
            .or_else(|| obj.get("ts").and_then(Self::value_to_u64))
            .or_else(|| obj.get("timestamp").and_then(Self::value_to_u64));
        let digits = obj.get("d").and_then(Self::value_to_u64)
            .or_else(|| obj.get("digit").and_then(Self::value_to_u64))
            .map(|v| v as u32);
        let is_session_active = obj
            .get("is_session_active")
            .and_then(Self::value_to_i64);

        match (ask, bid) {
            (Some(ask), Some(bid)) => Some(AwsTick {
                ask,
                bid,
                digits,
                ts,
                is_session_active,
            }),
            _ => None,
        }
    }

    fn value_to_f64(v: &Value) -> Option<f64> {
        match v {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.parse::<f64>().ok(),
            _ => None,
        }
    }

    fn value_to_u64(v: &Value) -> Option<u64> {
        match v {
            Value::Number(n) => n.as_u64(),
            Value::String(s) => s.parse::<u64>().ok(),
            _ => None,
        }
    }

    fn value_to_i64(v: &Value) -> Option<i64> {
        match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.parse::<i64>().ok(),
            _ => None,
        }
    }
}

