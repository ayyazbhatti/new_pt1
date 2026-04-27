//! Tiered notional → max symbol leverage, clamped to [user_min, user_max].
//! Returns `None` if configuration is missing or notional does not match any tier (no silent defaults).

use contracts::commands::LeverageTier;
use rust_decimal::Decimal;
use std::str::FromStr;

/// Effective leverage: pick tier for `notional`, then clamp to `[min_leverage, max_leverage]`.
/// - Requires non-empty `tiers`, both `min_leverage` and `max_leverage` present, and a matching tier.
/// - Open-ended last tier: `notional_to` is `None` or empty/parse → upper bound is unbounded.
pub fn effective_leverage(
    notional: Decimal,
    min_leverage: Option<i32>,
    max_leverage: Option<i32>,
    tiers: Option<&[LeverageTier]>,
) -> Option<Decimal> {
    let (min_l, max_l) = (min_leverage?, max_leverage?);
    if min_l < 1 || max_l < 1 || min_l > max_l {
        return None;
    }
    let tiers = tiers?;
    if tiers.is_empty() {
        return None;
    }
    if notional < Decimal::ZERO {
        return None;
    }

    let min_d = Decimal::from(min_l);
    let max_d = Decimal::from(max_l);
    if min_d > max_d {
        return None;
    }

    // Pick the applicable tier: among all rows where (from <= notional < to) or (to open and from <= notional),
    // use the one with the largest `notional_from` (tightest bracket). Avoids off-by-one at band edges and
    // first-match ordering bugs when tiers are contiguous.
    let mut best_lev: Option<i32> = None;
    let mut best_from: Option<Decimal> = None;
    for t in tiers {
        let from = Decimal::from_str(t.notional_from.trim()).ok()?;
        if notional < from {
            continue;
        }
        let in_tier = match t.notional_to.as_ref().map(|s| s.trim()) {
            None | Some("") => true,
            Some(upper) => {
                let to = Decimal::from_str(upper).ok()?;
                notional < to
            }
        };
        if in_tier {
            let take = best_from
                .map(|bf| from > bf)
                .unwrap_or(true);
            if take {
                best_from = Some(from);
                best_lev = Some(t.max_leverage);
            }
        }
    }
    let mut symbol_lev = best_lev;
    // If nothing matched (e.g. gap in tier table), use the last open-ended tier (no upper) with from <= notional, if any.
    if symbol_lev.is_none() {
        for t in tiers.iter().rev() {
            if t.notional_to.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()).is_some() {
                continue;
            }
            let from = Decimal::from_str(t.notional_from.trim()).ok()?;
            if notional >= from {
                symbol_lev = Some(t.max_leverage);
                break;
            }
        }
    }

    // Positions below the minimum configured notional (e.g. 0.004 when first rung is 1–N) use the
    // lowest notional rung's max leverage, so small FX/CFD/crypto notionals are not left uncovered.
    if symbol_lev.is_none() && notional > Decimal::ZERO {
        let mut best_floor: Option<(Decimal, i32)> = None;
        for t in tiers {
            let from = match Decimal::from_str(t.notional_from.trim()) {
                Ok(f) => f,
                Err(_) => continue,
            };
            if best_floor.map_or(true, |(bf, _)| from < bf) {
                best_floor = Some((from, t.max_leverage));
            }
        }
        if let Some((min_from, lev)) = best_floor {
            if notional < min_from {
                symbol_lev = Some(lev);
            }
        }
    }

    let s = symbol_lev?;
    if s < 1 {
        return None;
    }
    let sym = Decimal::from(s);
    Some(sym.max(min_d).min(max_d))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tier(from: &str, to: Option<&str>, max: i32) -> LeverageTier {
        LeverageTier {
            notional_from: from.to_string(),
            notional_to: to.map(|s| s.to_string()),
            max_leverage: max,
        }
    }

    #[test]
    fn lower_tier_and_clamp_to_user_max() {
        let tiers = [tier("0", Some("1000"), 20), tier("1000", Some("2000"), 110)];
        let r = effective_leverage(
            "500".parse().unwrap(),
            Some(1),
            Some(100),
            Some(&tiers),
        );
        assert_eq!(r, Some("20".parse().unwrap()));
        let r2 = effective_leverage(
            "1500".parse().unwrap(),
            Some(1),
            Some(100),
            Some(&tiers),
        );
        assert_eq!(r2, Some("100".parse().unwrap()));
    }

    #[test]
    fn missing_tiers_is_none() {
        assert_eq!(
            effective_leverage("100".parse().unwrap(), Some(1), Some(10), None),
            None
        );
    }

    #[test]
    fn missing_user_bounds_is_none() {
        let tiers = [tier("0", None, 50)];
        assert_eq!(
            effective_leverage("100".parse().unwrap(), None, Some(10), Some(&tiers)),
            None
        );
    }

    #[test]
    fn picks_highest_from_bracket_at_boundary() {
        let tiers = [
            tier("0", Some("10000"), 50),
            tier("10000", Some("50000"), 120),
        ];
        let r = effective_leverage(
            "10000".parse().unwrap(),
            Some(1),
            Some(200),
            Some(&tiers),
        );
        assert_eq!(r, Some("120".parse().unwrap()));
    }

    #[test]
    fn sub_minimum_notional_uses_lowest_tier() {
        let tiers = [tier("1", Some("1000"), 100), tier("1000", None, 50)];
        let r = effective_leverage(
            "0.00405257196".parse().unwrap(),
            Some(1),
            Some(200),
            Some(&tiers),
        );
        assert_eq!(r, Some("100".parse().unwrap()));
    }
}
