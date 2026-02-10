use anyhow::{Context, Result};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceState {
    pub bid: Decimal,
    pub ask: Decimal,
    pub ts: u64,
}

#[derive(Debug, Deserialize)]
struct BinanceBookTicker {
    #[serde(rename = "u")]
    update_id: Option<u64>, // Update ID (optional)
    #[serde(rename = "s")]
    symbol: String,
    #[serde(rename = "b")]
    bid: String,
    #[serde(rename = "B")]
    bid_qty: Option<String>, // Bid quantity (optional)
    #[serde(rename = "a")]
    ask: String,
    #[serde(rename = "A")]
    ask_qty: Option<String>, // Ask quantity (optional)
    #[serde(rename = "E")]
    event_time: Option<u64>, // Event time (optional - @bookTicker doesn't always include it)
}

pub struct BinanceFeed {
    price_states: Arc<RwLock<HashMap<String, PriceState>>>,
    ws_url: String,
    reconnect_delay: u64,
}

impl BinanceFeed {
    pub fn new(ws_url: String) -> Self {
        Self {
            price_states: Arc::new(RwLock::new(HashMap::new())),
            ws_url,
            reconnect_delay: 5,
        }
    }

    pub async fn get_price(&self, symbol: &str) -> Option<PriceState> {
        let states = self.price_states.read().await;
        states.get(symbol).cloned()
    }

    pub async fn subscribe_symbol(&self, symbol: &str) -> Result<()> {
        let symbol_lower = symbol.to_lowercase();
        let ws_url = format!("{}/{}@bookTicker", self.ws_url, symbol_lower);
        let symbol_owned = symbol.to_string();

        let price_states = self.price_states.clone();

        tokio::spawn(async move {
            loop {
                match Self::connect_and_listen(&ws_url, &symbol_owned, price_states.clone()).await {
                    Ok(_) => {
                        warn!("Binance connection closed for {}", symbol_owned);
                    }
                    Err(e) => {
                        error!("Binance connection error for {}: {}", symbol_owned, e);
                    }
                }

                // Reconnect delay
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                info!("Reconnecting to Binance for {}", symbol_owned);
            }
        });

        Ok(())
    }

    async fn connect_and_listen(
        ws_url: &str,
        symbol: &str,
        price_states: Arc<RwLock<HashMap<String, PriceState>>>,
    ) -> Result<()> {
        info!("Connecting to Binance: {}", ws_url);

        let (ws_stream, _) = connect_async(ws_url)
            .await
            .context("Failed to connect to Binance WebSocket")?;

        info!("✅ Connected to Binance for {}", symbol);

        let (_, mut read) = ws_stream.split();

        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    debug!("📥 Received Binance message for {}: {}", symbol, &text[..text.len().min(100)]);
                    if let Err(e) = Self::process_message(&text, symbol, price_states.clone()).await
                    {
                        error!("Error processing message: {}", e);
                    }
                }
                Ok(Message::Ping(data)) => {
                    // Handle ping
                }
                Ok(Message::Close(_)) => {
                    warn!("Binance WebSocket closed for {}", symbol);
                    break;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
                _ => {}
            }
        }

        Ok(())
    }

    async fn process_message(
        text: &str,
        symbol: &str,
        price_states: Arc<RwLock<HashMap<String, PriceState>>>,
    ) -> Result<()> {
        // Log full message for debugging
        debug!("Full Binance message for {}: {}", symbol, text);
        
        let ticker: BinanceBookTicker = serde_json::from_str(text)
            .context(format!("Failed to parse Binance message. Text: {}", &text[..text.len().min(200)]))?;

        let bid = Decimal::from_str_exact(&ticker.bid)
            .context("Invalid bid price")?;
        let ask = Decimal::from_str_exact(&ticker.ask)
            .context("Invalid ask price")?;

        // Validation
        if ask <= bid {
            warn!("Invalid spread: ask ({}) <= bid ({}) for {}", ask, bid, symbol);
            return Ok(());
        }

        let mid = (bid + ask) / Decimal::from(2);
        let spread = ask - bid;
        let spread_percent = (spread / mid) * Decimal::from(100);

        if spread_percent > Decimal::from(10) {
            warn!("Spread too wide: {}% for {}", spread_percent, symbol);
            return Ok(());
        }

        let price_state = PriceState {
            bid,
            ask,
            ts: ticker.event_time.unwrap_or_else(|| {
                use std::time::{SystemTime, UNIX_EPOCH};
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64
            }),
        };

        let mut states = price_states.write().await;
        states.insert(symbol.to_string(), price_state.clone());
        
        info!(
            "📊 Price updated: {} | Bid: {} | Ask: {} | Spread: {:.4}%",
            symbol,
            bid,
            ask,
            spread_percent
        );

        Ok(())
    }
}

use futures_util::StreamExt;
use rust_decimal::prelude::*;

