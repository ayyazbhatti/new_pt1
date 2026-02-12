use rust_decimal::Decimal;
use rust_decimal_macros::dec;

/// Calculate margin required for a position
pub fn calculate_margin(size: Decimal, entry_price: Decimal, leverage: Decimal) -> Decimal {
    let notional = size * entry_price;
    notional / leverage
}

/// Calculate free margin
pub fn calculate_free_margin(
    equity: Decimal,
    margin_used: Decimal,
) -> Decimal {
    equity - margin_used
}

/// Calculate margin used from all open positions
pub fn calculate_total_margin_used(positions_margin: &[Decimal]) -> Decimal {
    positions_margin.iter().sum()
}

/// Check if user has sufficient free margin
pub fn has_sufficient_margin(free_margin: Decimal, required_margin: Decimal) -> bool {
    free_margin >= required_margin
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_calculate_margin() {
        let size = dec!(1.0);
        let entry_price = dec!(50000.0);
        let leverage = dec!(100.0);
        let margin = calculate_margin(size, entry_price, leverage);
        assert_eq!(margin, dec!(500.0));
    }

    #[test]
    fn test_calculate_free_margin() {
        let equity = dec!(10000.0);
        let margin_used = dec!(2000.0);
        let free = calculate_free_margin(equity, margin_used);
        assert_eq!(free, dec!(8000.0));
    }
}

