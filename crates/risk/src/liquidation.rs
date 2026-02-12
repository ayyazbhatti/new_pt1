use rust_decimal::Decimal;
use contracts::enums::PositionSide;

/// Calculate liquidation price for a position
/// This is a placeholder - real implementation would consider:
/// - Maintenance margin requirements
/// - Cross-margin vs isolated margin
/// - Multiple positions
pub fn calculate_liquidation_price(
    entry_price: Decimal,
    side: PositionSide,
    leverage: Decimal,
    maintenance_margin_ratio: Decimal,
) -> Decimal {
    // Simplified liquidation calculation
    // Real implementation would be more complex
    match side {
        PositionSide::Long => {
            entry_price * (Decimal::ONE - (Decimal::ONE / leverage) + maintenance_margin_ratio)
        }
        PositionSide::Short => {
            entry_price * (Decimal::ONE + (Decimal::ONE / leverage) - maintenance_margin_ratio)
        }
    }
}

/// Check if position should be liquidated
pub fn should_liquidate(
    current_price: Decimal,
    liquidation_price: Decimal,
    side: PositionSide,
) -> bool {
    match side {
        PositionSide::Long => current_price <= liquidation_price,
        PositionSide::Short => current_price >= liquidation_price,
    }
}

