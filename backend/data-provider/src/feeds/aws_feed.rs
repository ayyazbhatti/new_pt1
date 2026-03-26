use anyhow::{Context, Result};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::str::FromStr;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
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
}

impl AwsFeed {
    pub fn new(ws_url: String) -> Self {
        Self {
            ws_url,
            prices: Arc::new(RwLock::new(HashMap::new())),
            msg_count: Arc::new(AtomicU64::new(0)),
            symbol_update_count: Arc::new(AtomicU64::new(0)),
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
        // Expected payload:
        // {
        //   "EURUSD": { "a": 1.15498, "b": 1.15486, "d": 5, "t": 1710700000000, ... },
        //   "BTCUSD": { "a": 42152.30, "b": 42150.50, "d": 2, "t": 1710700000000, ... }
        // }
        let parsed: Result<HashMap<String, AwsTick>, _> = serde_json::from_str(txt);
        let ticks = match parsed {
            Ok(v) => v,
            Err(_) => {
                // Some providers send whitespace/keepalive; keep quiet.
                debug!("AWS WS: message not parsed as ticks map");
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
}

