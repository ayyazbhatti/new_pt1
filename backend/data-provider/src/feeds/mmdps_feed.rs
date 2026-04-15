//! MMDPS WebSocket feed (forex/CFD symbols). Uses same [`PriceState`] as Binance for downstream compatibility.
//!
//! Protocol: connect to `wss://.../feed/ws?api_key=...`, send `{"action":"subscribe","symbols":[...]}`,
//! receive `{"type":"tick","symbol","bid","ask",...}`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use dashmap::DashSet;
use futures_util::{SinkExt, StreamExt};
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use tokio::sync::mpsc;
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, trace, warn};

use super::binance_feed::PriceState;

pub struct MmdpsFeed {
    price_states: Arc<RwLock<HashMap<String, PriceState>>>,
    ws_url: String,
    subscribed: Arc<DashSet<String>>,
    resync_tx: Mutex<Option<mpsc::UnboundedSender<()>>>,
}

impl MmdpsFeed {
    pub fn new(ws_url_with_key: String) -> Self {
        Self {
            price_states: Arc::new(RwLock::new(HashMap::new())),
            ws_url: ws_url_with_key,
            subscribed: Arc::new(DashSet::new()),
            resync_tx: Mutex::new(None),
        }
    }

    pub async fn get_price(&self, symbol: &str) -> Option<PriceState> {
        let u = symbol.to_uppercase();
        let states = self.price_states.read().await;
        states.get(&u).cloned()
    }

    pub fn tracked_symbol_count(&self) -> usize {
        self.subscribed.len()
    }

    pub async fn subscribe_symbol(&self, symbol: &str) -> Result<()> {
        let u = symbol.to_uppercase();
        if !self.subscribed.insert(u) {
            return Ok(());
        }

        let mut lock = self.resync_tx.lock().expect("mmdps resync mutex");
        if lock.is_none() {
            let (tx, rx) = mpsc::unbounded_channel();
            *lock = Some(tx.clone());
            let url = self.ws_url.clone();
            let states = self.price_states.clone();
            let subs = self.subscribed.clone();
            tokio::spawn(async move {
                mmdps_connection_loop(url, states, subs, rx).await;
            });
            let _ = tx.send(());
        } else if let Some(tx) = lock.as_ref() {
            let _ = tx.send(());
        }
        Ok(())
    }
}

async fn mmdps_connection_loop(
    url: String,
    price_states: Arc<RwLock<HashMap<String, PriceState>>>,
    subscribed: Arc<DashSet<String>>,
    mut resync_rx: mpsc::UnboundedReceiver<()>,
) {
    const RECONNECT_SECS: u64 = 5;
    loop {
        info!("MMDPS: connecting…");
        let ws = match connect_async(&url).await {
            Ok((s, _)) => s,
            Err(e) => {
                error!("MMDPS connect failed: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(RECONNECT_SECS)).await;
                continue;
            }
        };

        let (mut write, mut read) = ws.split();

        /// Large subscribe payloads can exceed WS frame limits; chunk symbol lists.
        const CHUNK: usize = 200;

        async fn send_subscribe(
            write: &mut (impl SinkExt<Message> + Unpin),
            symbols: &[String],
        ) -> Result<()> {
            if symbols.is_empty() {
                return Ok(());
            }
            let mut sorted = symbols.to_vec();
            sorted.sort();
            sorted.dedup();
            for chunk in sorted.chunks(CHUNK) {
                let payload = serde_json::json!({
                    "action": "subscribe",
                    "symbols": chunk,
                });
                write
                    .send(Message::Text(payload.to_string().into()))
                    .await
                    .map_err(|_| anyhow::anyhow!("mmdps subscribe send failed"))?;
            }
            Ok(())
        }

        let initial: Vec<String> = subscribed.iter().map(|r| r.clone()).collect();
        if !initial.is_empty() {
            if let Err(e) = send_subscribe(&mut write, &initial).await {
                error!("MMDPS initial subscribe: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_secs(RECONNECT_SECS)).await;
                continue;
            }
            let chunks = (initial.len() + CHUNK - 1) / CHUNK;
            info!(
                "MMDPS: subscribed to {} symbols ({} WS message(s))",
                initial.len(),
                chunks
            );
        }

        let mut connection_ok = true;
        while connection_ok {
            tokio::select! {
                biased;
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            let t = text.to_string();
                            if let Err(e) = apply_mmdps_message(&t, &price_states).await {
                                trace!("mmdps parse skip: {} ({})", e, t.chars().take(120).collect::<String>());
                            }
                        }
                        Some(Ok(Message::Ping(d))) => {
                            if let Err(e) = write.send(Message::Pong(d)).await {
                                warn!("MMDPS pong: {}", e);
                                connection_ok = false;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            warn!("MMDPS read ended");
                            connection_ok = false;
                        }
                        Some(Ok(_)) => {}
                        Some(Err(e)) => {
                            error!("MMDPS read error: {}", e);
                            connection_ok = false;
                        }
                    }
                }
                _ = resync_rx.recv() => {
                    let list: Vec<String> = subscribed.iter().map(|r| r.clone()).collect();
                    if list.is_empty() {
                        continue;
                    }
                    if let Err(e) = send_subscribe(&mut write, &list).await {
                        error!("MMDPS resubscribe: {}", e);
                        connection_ok = false;
                    } else {
                        debug!("MMDPS resent subscribe for {} symbols", list.len());
                    }
                }
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(RECONNECT_SECS)).await;
    }
}

async fn apply_mmdps_message(text: &str, price_states: &Arc<RwLock<HashMap<String, PriceState>>>) -> Result<()> {
    let v: serde_json::Value = serde_json::from_str(text)?;
    let typ = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    if typ != "tick" {
        return Ok(());
    }
    let sym = v
        .get("symbol")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow::anyhow!("tick without symbol"))?;
    let bid = parse_decimal_json(&v["bid"])?;
    let ask = parse_decimal_json(&v["ask"])?;
    if ask <= bid {
        trace!(symbol = %sym, "mmdps skip invalid spread");
        return Ok(());
    }
    let ts = v
        .get("timestamp")
        .and_then(|x| x.as_u64())
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
        });

    let sym_key = sym.to_uppercase();
    let price_state = PriceState { bid, ask, ts };
    {
        let mut states = price_states.write().await;
        states.insert(sym_key.clone(), price_state);
    }
    trace!(symbol = %sym_key, %bid, %ask, "mmdps tick");
    Ok(())
}

fn parse_decimal_json(v: &serde_json::Value) -> Result<Decimal> {
    if let Some(s) = v.as_str() {
        return Decimal::from_str_exact(s).map_err(|e| anyhow::anyhow!("decimal: {}", e));
    }
    if let Some(f) = v.as_f64() {
        return Decimal::from_f64(f).ok_or_else(|| anyhow::anyhow!("decimal from f64"));
    }
    if let Some(i) = v.as_i64() {
        return Ok(Decimal::from(i));
    }
    anyhow::bail!("not a number")
}
