use crate::feeds::binance_feed::PriceState;
use crate::pricing::markup_engine::MarkupEngine;
use crate::pricing::normalizer::{get_timestamp_ms, normalize_price};
use dashmap::DashMap;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{debug, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceTick {
    #[serde(rename = "type")]
    pub tick_type: String,
    pub symbol: String,
    pub bid: Decimal,
    pub ask: Decimal,
    pub ts: u64,
}

pub struct Broadcaster {
    // Room -> Sender
    rooms: Arc<DashMap<String, broadcast::Sender<PriceTick>>>,
    markup_engine: Arc<MarkupEngine>,
}

impl Broadcaster {
    pub fn new(markup_engine: MarkupEngine) -> Self {
        Self {
            rooms: Arc::new(DashMap::new()),
            markup_engine: Arc::new(markup_engine),
        }
    }

    pub fn subscribe_room(&self, room: String) -> broadcast::Receiver<PriceTick> {
        let sender = self.rooms.entry(room.clone()).or_insert_with(|| {
            let (tx, _) = broadcast::channel(1000);
            info!("Created room: {}", room);
            tx
        });

        sender.subscribe()
    }

    pub async fn broadcast_price(
        &self,
        symbol: &str,
        group: Option<&str>,
        bid: Decimal,
        ask: Decimal,
    ) {
        let (normalized_bid, normalized_ask) = match normalize_price(bid, ask) {
            Some(prices) => prices,
            None => {
                debug!("Invalid price for {}, skipping broadcast", symbol);
                return;
            }
        };

        // Apply markup if group provided
        let (final_bid, final_ask) = if let Some(grp) = group {
            match self
                .markup_engine
                .apply_markup(symbol, grp, normalized_bid, normalized_ask)
                .await
            {
                Some(prices) => prices,
                None => {
                    debug!("Markup failed for {}:{}, skipping", symbol, grp);
                    return;
                }
            }
        } else {
            (normalized_bid, normalized_ask)
        };

        let tick = PriceTick {
            tick_type: "tick".to_string(),
            symbol: symbol.to_string(),
            bid: final_bid,
            ask: final_ask,
            ts: get_timestamp_ms(),
        };

        // Broadcast to symbol room (both with and without group prefix)
        let symbol_room = format!("symbol:{}", symbol);
        let group_default_room = format!("group:default:symbol:{}", symbol);
        
        // Broadcast to symbol room (no group)
        if let Some(sender) = self.rooms.get(&symbol_room) {
            debug!(
                "📡 Broadcasting {} to room '{}': bid={}, ask={}",
                symbol, symbol_room, final_bid, final_ask
            );
            match sender.send(tick.clone()) {
                Ok(count) => debug!("✅ Sent to {} receivers", count),
                Err(_) => debug!("⚠️  No active receivers for room '{}'", symbol_room),
            }
        } else {
            debug!("⚠️  No room exists for '{}'", symbol_room);
        }

        // Broadcast to group+symbol room if group provided
        if let Some(grp) = group {
            let group_room = format!("group:{}:symbol:{}", grp, symbol);
            if let Some(sender) = self.rooms.get(&group_room) {
                debug!(
                    "📡 Broadcasting {} to room '{}': bid={}, ask={}",
                    symbol, group_room, final_bid, final_ask
                );
                match sender.send(tick) {
                    Ok(count) => debug!("✅ Sent to {} receivers", count),
                    Err(_) => debug!("⚠️  No active receivers for room '{}'", group_room),
                }
            } else {
                debug!("⚠️  No room exists for '{}'", group_room);
            }
        }
    }

    pub fn get_room_count(&self) -> usize {
        self.rooms.len()
    }
}

