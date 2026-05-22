//! Market-order slippage vs submission snapshot (bid/ask + max bps).
//!
//! LIMIT orders are not checked here (limit price is the protection). SL/TP closes positions
//! via a separate engine path (`sltp_handler` → position close), not through user `Order` fills.

use contracts::enums::Side;
use rust_decimal::Decimal;
use rust_decimal::RoundingStrategy;

#[derive(Debug, Clone)]
pub struct SlippageCheckInput {
    pub side: Side,
    pub fill_price: Decimal,
    pub requested_bid: Option<Decimal>,
    pub requested_ask: Option<Decimal>,
    pub max_slippage_bps: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct SlippageCheckResult {
    pub passed: bool,
    pub reference_price: Decimal,
    pub slippage_bps: i32,
    pub max_bps: i32,
}

#[derive(Debug, Clone)]
pub enum SlippageCheckOutcome {
    /// Missing snapshot or tolerance — legacy order / core-api; do not enforce.
    NotApplicable,
    Passed(SlippageCheckResult),
    Exceeded(SlippageCheckResult),
}

fn decimal_bps_ceiling_to_i32(d: Decimal) -> i32 {
    let ceiled = d.round_dp_with_strategy(0, RoundingStrategy::ToPositiveInfinity);
    if ceiled > Decimal::from(i32::MAX) {
        return i32::MAX;
    }
    if ceiled < Decimal::ZERO {
        return 0;
    }
    ceiled.to_string().parse::<i32>().unwrap_or(i32::MAX)
}

pub fn check_slippage(input: SlippageCheckInput) -> SlippageCheckOutcome {
    let (Some(bid), Some(ask), Some(max_bps)) = (
        input.requested_bid,
        input.requested_ask,
        input.max_slippage_bps,
    ) else {
        return SlippageCheckOutcome::NotApplicable;
    };

    let reference = match input.side {
        Side::Buy => ask,
        Side::Sell => bid,
    };

    if reference <= Decimal::ZERO {
        return SlippageCheckOutcome::NotApplicable;
    }

    let diff = (input.fill_price - reference).abs();
    let slippage_fraction = diff / reference;
    let slippage_bps_raw = slippage_fraction * Decimal::from(10_000);
    let slippage_bps = decimal_bps_ceiling_to_i32(slippage_bps_raw);

    let max_bps = max_bps.max(0);
    let passed = slippage_bps <= max_bps;
    let result = SlippageCheckResult {
        passed,
        reference_price: reference,
        slippage_bps,
        max_bps,
    };

    if passed {
        SlippageCheckOutcome::Passed(result)
    } else {
        SlippageCheckOutcome::Exceeded(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn skip_when_no_snapshot() {
        let result = check_slippage(SlippageCheckInput {
            side: Side::Buy,
            fill_price: dec!(100),
            requested_bid: None,
            requested_ask: None,
            max_slippage_bps: Some(50),
        });
        assert!(matches!(result, SlippageCheckOutcome::NotApplicable));
    }

    #[test]
    fn passes_within_tolerance_buy() {
        let result = check_slippage(SlippageCheckInput {
            side: Side::Buy,
            fill_price: dec!(100.4),
            requested_bid: Some(dec!(99.5)),
            requested_ask: Some(dec!(100.0)),
            max_slippage_bps: Some(50),
        });
        match result {
            SlippageCheckOutcome::Passed(r) => assert_eq!(r.slippage_bps, 40),
            _ => panic!("expected Passed, got {:?}", result),
        }
    }

    #[test]
    fn rejects_above_tolerance_buy() {
        let result = check_slippage(SlippageCheckInput {
            side: Side::Buy,
            fill_price: dec!(100.6),
            requested_bid: Some(dec!(99.5)),
            requested_ask: Some(dec!(100.0)),
            max_slippage_bps: Some(50),
        });
        match result {
            SlippageCheckOutcome::Exceeded(r) => assert!(r.slippage_bps > 50),
            _ => panic!("expected Exceeded, got {:?}", result),
        }
    }

    #[test]
    fn rejects_above_tolerance_sell() {
        let result = check_slippage(SlippageCheckInput {
            side: Side::Sell,
            fill_price: dec!(99.4),
            requested_bid: Some(dec!(100.0)),
            requested_ask: Some(dec!(100.5)),
            max_slippage_bps: Some(50),
        });
        assert!(matches!(result, SlippageCheckOutcome::Exceeded(_)));
    }
}
