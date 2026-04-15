//! Binance spot **bookTicker** via a **single multiplexed WebSocket** (dynamic `SUBSCRIBE`).
//! Replaces one connection per symbol — fewer FDs, less kernel overhead, same tick latency.
//!
//! Limits (Binance): up to **1024 streams per connection**; we batch `SUBSCRIBE` in chunks to stay
//! under per-second message limits when subscribing many symbols at once.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use dashmap::DashSet;
use futures_util::{SinkExt, StreamExt};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, trace, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceState {
    pub bid: Decimal,
    pub ask: Decimal,
    pub ts: u64,
}

#[derive(Debug, Deserialize)]
struct BinanceBookTicker {
    #[serde(rename = "s")]
    symbol: String,
    #[serde(rename = "b")]
    bid: String,
    #[serde(rename = "a")]
    ask: String,
    #[serde(rename = "E")]
    event_time: Option<u64>,
}

/// Combined stream envelope: `{"stream":"btcusdt@bookTicker","data":{...}}`
#[derive(Debug, Deserialize)]
struct CombinedEnvelope {
    #[allow(dead_code)]
    stream: String,
    data: serde_json::Value,
}

/// Max stream names per `SUBSCRIBE` frame (well under Binance **1024 streams per connection** cap).
const SUBSCRIBE_BATCH: usize = 200;
/// Hard cap per multiplex socket (Binance limit). If you need more symbols, add a second connection (future shard).
const MAX_STREAMS_PER_SOCKET: usize = 1020;
/// Binance allows ~5 **incoming** messages per second per connection — space out multi-frame subscribe bursts.
const SUBSCRIBE_BURST_GAP_MS: u64 = 220;

pub struct BinanceFeed {
    price_states: Arc<RwLock<HashMap<String, PriceState>>>,
    multiplex_url: String,
    reconnect_delay: u64,
    /// Uppercase symbols we must maintain on the wire (dedup for `subscribe_symbol`).
    subscribed: Arc<DashSet<String>>,
    cmd_tx: std::sync::OnceLock<mpsc::UnboundedSender<String>>,
}

impl BinanceFeed {
    pub fn new(ws_url: String) -> Self {
        Self {
            price_states: Arc::new(RwLock::new(HashMap::new())),
            multiplex_url: normalize_multiplex_url(&ws_url),
            reconnect_delay: 5,
            subscribed: Arc::new(DashSet::new()),
            cmd_tx: std::sync::OnceLock::new(),
        }
    }

    pub async fn get_price(&self, symbol: &str) -> Option<PriceState> {
        let u = symbol.to_uppercase();
        let states = self.price_states.read().await;
        states.get(&u).cloned()
    }

    pub async fn tracked_symbol_count(&self) -> usize {
        self.price_states.read().await.len()
    }

    /// Register a symbol on the shared Binance multiplex connection (no extra TCP socket per symbol).
    pub async fn subscribe_symbol(&self, symbol: &str) -> Result<()> {
        let u = symbol.to_uppercase();
        if !self.subscribed.insert(u.clone()) {
            return Ok(());
        }

        let tx = self.cmd_tx.get_or_init(|| {
            let (tx, rx) = mpsc::unbounded_channel();
            let url = self.multiplex_url.clone();
            let states = self.price_states.clone();
            let global = self.subscribed.clone();
            let delay = self.reconnect_delay;
            tokio::spawn(async move {
                multiplex_connection_loop(url, states, global, rx, delay).await;
            });
            tx
        });

        tx.send(u)
            .map_err(|e| anyhow::anyhow!("multiplex command channel closed: {}", e))?;
        Ok(())
    }
}

/// Strip `.../ws/<stream>` → `.../ws` so we can use dynamic `SUBSCRIBE` on the multiplex endpoint.
fn normalize_multiplex_url(raw: &str) -> String {
    let r = raw.trim();
    if let Some(i) = r.find("/ws") {
        let after = &r[i + 3..];
        if after.starts_with('/') && after.len() > 1 {
            return r[..i + 3].to_string();
        }
    }
    r.to_string()
}

fn stream_name(symbol_upper: &str) -> String {
    format!("{}@bookTicker", symbol_upper.to_lowercase())
}

async fn send_subscribe_batch(
    write: &mut (impl SinkExt<Message> + Unpin),
    streams: &[String],
    msg_id: &AtomicU64,
) -> Result<()> {
    if streams.is_empty() {
        return Ok(());
    }
    let params: Vec<String> = streams.iter().cloned().collect();
    let id = msg_id.fetch_add(1, Ordering::Relaxed);
    let payload = serde_json::json!({
        "method": "SUBSCRIBE",
        "params": params,
        "id": id
    });
    let text = payload.to_string();
    write
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| anyhow::anyhow!("failed to send SUBSCRIBE"))?;
    Ok(())
}

async fn subscribe_all_batches(
    write: &mut (impl SinkExt<Message> + Unpin),
    symbols_upper: &[String],
    msg_id: &AtomicU64,
) -> Result<()> {
    let streams: Vec<String> = symbols_upper.iter().map(|s| stream_name(s)).collect();
    let chunks: Vec<&[String]> = streams.chunks(SUBSCRIBE_BATCH).collect();
    let n = chunks.len();
    for (i, chunk) in chunks.into_iter().enumerate() {
        let owned: Vec<String> = chunk.to_vec();
        send_subscribe_batch(write, &owned, msg_id).await?;
        if i + 1 < n {
            tokio::time::sleep(tokio::time::Duration::from_millis(SUBSCRIBE_BURST_GAP_MS)).await;
        }
    }
    Ok(())
}

/// Parse either combined wrapper or raw bookTicker JSON.
fn parse_book_ticker(text: &str) -> Result<BinanceBookTicker> {
    if let Ok(w) = serde_json::from_str::<CombinedEnvelope>(text) {
        return serde_json::from_value(w.data).context("combined stream data");
    }
    serde_json::from_str(text).context("raw bookTicker")
}

async fn apply_ticker(
    ticker: BinanceBookTicker,
    price_states: &Arc<RwLock<HashMap<String, PriceState>>>,
) -> Result<()> {
    let sym_key = ticker.symbol.to_uppercase();

    let bid = Decimal::from_str_exact(&ticker.bid).context("invalid bid")?;
    let ask = Decimal::from_str_exact(&ticker.ask).context("invalid ask")?;

    if ask <= bid {
        trace!(symbol = %sym_key, "skip invalid spread");
        return Ok(());
    }

    let mid = (bid + ask) / Decimal::from(2);
    let spread = ask - bid;
    let spread_percent = (spread / mid) * Decimal::from(100);
    if spread_percent > Decimal::from(10) {
        trace!(symbol = %sym_key, %spread_percent, "skip wide spread");
        return Ok(());
    }

    let ts = ticker.event_time.unwrap_or_else(|| {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    });

    let price_state = PriceState { bid, ask, ts };
    {
        let mut states = price_states.write().await;
        states.insert(sym_key.clone(), price_state);
    }
    trace!(symbol = %sym_key, %bid, %ask, "bookTicker");
    Ok(())
}

async fn multiplex_connection_loop(
    multiplex_url: String,
    price_states: Arc<RwLock<HashMap<String, PriceState>>>,
    global_subscribed: Arc<DashSet<String>>,
    mut cmd_rx: mpsc::UnboundedReceiver<String>,
    reconnect_delay_secs: u64,
) {
    let msg_id = AtomicU64::new(1);
    loop {
        info!("Binance multiplex: connecting {}", multiplex_url);
        let ws = match connect_async(&multiplex_url).await {
            Ok((s, _)) => s,
            Err(e) => {
                error!("Binance multiplex connect failed: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(reconnect_delay_secs)).await;
                continue;
            }
        };

        let (mut write, mut read) = ws.split();
        let mut session_active: HashSet<String> = HashSet::new();

        // Full resync: everything we should be subscribed to.
        let mut all: Vec<String> = global_subscribed.iter().map(|r| r.clone()).collect();
        all.sort();
        if all.len() > MAX_STREAMS_PER_SOCKET {
            warn!(
                "Binance multiplex: {} symbols requested; only first {} are subscribed on this socket (exchange limit ~1024 streams)",
                all.len(),
                MAX_STREAMS_PER_SOCKET
            );
            all.truncate(MAX_STREAMS_PER_SOCKET);
        }
        while let Ok(more) = cmd_rx.try_recv() {
            if all.len() < MAX_STREAMS_PER_SOCKET && !all.contains(&more) {
                all.push(more);
            }
        }
        all.sort();
        all.dedup();
        if all.len() > MAX_STREAMS_PER_SOCKET {
            all.truncate(MAX_STREAMS_PER_SOCKET);
        }

        if let Err(e) = subscribe_all_batches(&mut write, &all, &msg_id).await {
            error!("initial SUBSCRIBE failed: {}", e);
            tokio::time::sleep(tokio::time::Duration::from_secs(reconnect_delay_secs)).await;
            continue;
        }
        for s in &all {
            session_active.insert(s.clone());
        }
        info!(
            "Binance multiplex: subscribed {} streams on one socket",
            session_active.len()
        );

        let mut connection_ok = true;
        while connection_ok {
            tokio::select! {
                biased;
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            let t = text.to_string();
                            if let Ok(ticker) = parse_book_ticker(&t) {
                                if let Err(e) = apply_ticker(ticker, &price_states).await {
                                    debug!("ticker apply: {}", e);
                                }
                            } else {
                                // subscription ACK, errors, etc.
                                debug!(payload = %t.chars().take(200).collect::<String>(), "binance non-ticker");
                            }
                        }
                        Some(Ok(Message::Ping(d))) => {
                            if let Err(e) = write.send(Message::Pong(d)).await {
                                warn!("pong failed: {}", e);
                                connection_ok = false;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            warn!("Binance multiplex read ended");
                            connection_ok = false;
                        }
                        Some(Ok(_)) => {}
                        Some(Err(e)) => {
                            error!("Binance multiplex read error: {}", e);
                            connection_ok = false;
                        }
                    }
                }
                sym = cmd_rx.recv() => {
                    match sym {
                        Some(u) => {
                            if session_active.len() >= MAX_STREAMS_PER_SOCKET {
                                warn!(
                                    "Binance multiplex: max {} streams on socket; cannot add {}",
                                    MAX_STREAMS_PER_SOCKET, u
                                );
                                continue;
                            }
                            if session_active.insert(u.clone()) {
                                let sn = stream_name(&u);
                                if let Err(e) =
                                    send_subscribe_batch(&mut write, std::slice::from_ref(&sn), &msg_id)
                                        .await
                                {
                                    error!("incremental SUBSCRIBE failed: {}", e);
                                    connection_ok = false;
                                }
                            }
                        }
                        None => {
                            info!("Binance multiplex: command channel closed");
                            return;
                        }
                    }
                }
            }
        }

        warn!(
            "Binance multiplex: reconnecting in {}s",
            reconnect_delay_secs
        );
        tokio::time::sleep(tokio::time::Duration::from_secs(reconnect_delay_secs)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_multiplex_url;

    #[test]
    fn normalize_keeps_plain_ws_base() {
        assert_eq!(
            normalize_multiplex_url("wss://stream.binance.com:9443/ws"),
            "wss://stream.binance.com:9443/ws"
        );
    }

    #[test]
    fn normalize_strips_single_stream_suffix() {
        assert_eq!(
            normalize_multiplex_url("wss://stream.binance.com:9443/ws/btcusdt@bookTicker"),
            "wss://stream.binance.com:9443/ws"
        );
    }
}
