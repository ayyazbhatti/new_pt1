use crate::cache::redis_client::{MarkupConfig, RedisClient};
use rust_decimal::Decimal;
use rust_decimal::prelude::*;
use std::sync::Arc;
use tracing::{debug, warn};

pub struct MarkupEngine {
    redis: Arc<RedisClient>,
}

impl MarkupEngine {
    pub fn new(redis: RedisClient) -> Self {
        Self { redis: Arc::new(redis) }
    }

    pub async fn apply_markup(
        &self,
        symbol: &str,
        group: &str,
        bid: Decimal,
        ask: Decimal,
    ) -> Option<(Decimal, Decimal)> {
        // Get markup config from Redis
        let markup = match self.redis.get_markup(symbol, group).await {
            Ok(Some(m)) => m,
            Ok(None) => {
                // No markup configured, return original prices
                return Some((bid, ask));
            }
            Err(e) => {
                warn!("Failed to get markup for {}:{}: {}", symbol, group, e);
                return Some((bid, ask)); // Fallback to original
            }
        };

        let (final_bid, final_ask) = match markup.markup_type.as_str() {
            "points" => {
                // Add/subtract points
                let bid_markup = decimal_from_f64(markup.bid_markup)?;
                let ask_markup = decimal_from_f64(markup.ask_markup)?;
                (bid + bid_markup, ask + ask_markup)
            }
            "percent" => {
                // Apply percentage markup
                let bid_multiplier = Decimal::from(1) + decimal_from_f64(markup.bid_markup / 100.0)?;
                let ask_multiplier = Decimal::from(1) + decimal_from_f64(markup.ask_markup / 100.0)?;
                (bid * bid_multiplier, ask * ask_multiplier)
            }
            _ => {
                warn!("Unknown markup type: {}", markup.markup_type);
                return Some((bid, ask));
            }
        };

        // Ensure ask > bid after markup
        if final_ask <= final_bid {
            warn!("Markup resulted in invalid spread for {}:{}", symbol, group);
            return Some((bid, ask)); // Fallback
        }

        debug!(
            "Applied markup to {}:{}: bid {} -> {}, ask {} -> {}",
            symbol, group, bid, final_bid, ask, final_ask
        );

        Some((final_bid, final_ask))
    }
}

// Helper for Decimal conversion
fn decimal_from_f64(f: f64) -> Option<Decimal> {
    use rust_decimal::prelude::*;
    Decimal::from_f64(f)
}

