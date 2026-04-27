use rust_decimal::Decimal;
use std::time::{SystemTime, UNIX_EPOCH};

/// Normalize bid/ask for broadcasting. Forex (MMDPS) often has very tight spreads; rounding too
/// aggressively used to collapse bid==ask and **drop every tick** (`broadcast_price` skipped), while
/// HTTP `/prices` still showed snapshots — looked like “static forex, live crypto”.
pub fn normalize_price(bid: Decimal, ask: Decimal) -> Option<(Decimal, Decimal)> {
    if ask <= bid {
        return None;
    }

    const DP: u32 = 10;
    let bid_r = bid.round_dp(DP);
    let ask_r = ask.round_dp(DP);
    if ask_r > bid_r {
        return Some((bid_r, ask_r));
    }
    // Sub-1e-10 spread: rounding made sides equal; still a valid quote — pass through full precision.
    Some((bid, ask))
}

pub fn get_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tight_forex_spread_still_broadcasts() {
        let bid: Decimal = "1.085881".parse().unwrap();
        let ask: Decimal = "1.085882".parse().unwrap();
        let out = normalize_price(bid, ask).expect("micro-spread must not drop tick");
        assert!(out.1 > out.0);
    }
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
