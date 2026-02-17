//! Effective leverage from symbol tiers and user min/max.

use rust_decimal::Decimal;
use std::str::FromStr;

use crate::models::LeverageTier;

/// Compute effective leverage for a given notional (exposure):
/// find tier where notional_from <= notional < notional_to (or last tier if above all),
/// symbol_leverage = tier.max_leverage, then clamp to [user_min, user_max].
/// Returns default_leverage if no tiers or missing user limits.
pub fn effective_leverage(
    notional: Decimal,
    min_leverage: Option<i32>,
    max_leverage: Option<i32>,
    tiers: Option<&[LeverageTier]>,
    default_leverage: f64,
) -> f64 {
    let notional_f = match notional.to_string().parse::<f64>() {
        Ok(n) if n >= 0.0 => n,
        _ => return default_leverage,
    };

    let tiers = match tiers {
        Some(t) if !t.is_empty() => t,
        _ => return default_leverage,
    };

    let mut symbol_leverage = default_leverage;
    for tier in tiers {
        let from = f64::from_str(tier.notional_from.trim()).unwrap_or(0.0);
        let to = tier
            .notional_to
            .as_ref()
            .and_then(|s| s.trim().parse::<f64>().ok());
        let in_range = notional_f >= from && to.map(|t| notional_f < t).unwrap_or(true);
        if in_range {
            symbol_leverage = tier.max_leverage as f64;
            break;
        }
    }

    let min_l = min_leverage.map(|x| x as f64).unwrap_or(1.0);
    let max_l = max_leverage.map(|x| x as f64).unwrap_or(1000.0);
    symbol_leverage.clamp(min_l, max_l)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_effective_leverage_tier_and_clamp() {
        let tiers = vec![
            LeverageTier {
                notional_from: "0".to_string(),
                notional_to: Some("1000".to_string()),
                max_leverage: 20,
            },
            LeverageTier {
                notional_from: "1001".to_string(),
                notional_to: Some("2000".to_string()),
                max_leverage: 110,
            },
        ];
        // notional 500 -> tier 0 -> 20x; user max 100 -> 20
        let r = effective_leverage(dec!(500), Some(1), Some(100), Some(&tiers), 100.0);
        assert!((r - 20.0).abs() < 1e-6);
        // notional 1500 -> tier 1 -> 110x; user max 100 -> 100
        let r = effective_leverage(dec!(1500), Some(1), Some(100), Some(&tiers), 100.0);
        assert!((r - 100.0).abs() < 1e-6);
    }
}
