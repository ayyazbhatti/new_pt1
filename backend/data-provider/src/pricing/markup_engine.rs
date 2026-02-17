use crate::cache::redis_client::{MarkupConfig, RedisClient};
use rust_decimal::Decimal;
use rust_decimal::prelude::*;
use std::sync::Arc;
use tracing::{debug, warn};

pub struct MarkupEngine {
    redis: Arc<RedisClient>,
}

impl MarkupEngine {
    pub fn new(redis: Arc<RedisClient>) -> Self {
        Self { redis }
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

        // Bid and ask markup applied separately (e.g. 2% bid, 4% ask): (1 + pct/100) per side
        let bid_multiplier = Decimal::from(1) + decimal_from_f64(markup.bid_markup / 100.0)?;
        let ask_multiplier = Decimal::from(1) + decimal_from_f64(markup.ask_markup / 100.0)?;
        let (final_bid, final_ask) = (bid * bid_multiplier, ask * ask_multiplier);

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

