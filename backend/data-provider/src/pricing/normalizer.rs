use rust_decimal::Decimal;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn normalize_price(bid: Decimal, ask: Decimal) -> Option<(Decimal, Decimal)> {
    // Ensure ask > bid
    if ask <= bid {
        return None;
    }

    // Round to 5 decimal places for most symbols
    let bid_rounded = bid.round_dp(5);
    let ask_rounded = ask.round_dp(5);

    // Final validation
    if ask_rounded <= bid_rounded {
        return None;
    }

    Some((bid_rounded, ask_rounded))
}

pub fn get_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

pub fn validate_spread(bid: Decimal, ask: Decimal, max_spread_percent: Decimal) -> bool {
    if ask <= bid {
        return false;
    }

    let mid = (bid + ask) / Decimal::from(2);
    let spread = ask - bid;
    let spread_percent = (spread / mid) * Decimal::from(100);

    spread_percent <= max_spread_percent
}

