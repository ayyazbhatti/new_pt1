//! Symbol → upstream feed resolution.
//!
//! - **MMDPS auto mode** (default when `MMDPS_API_KEY` is set): Binance-style spot symbols → Binance;
//!   everything else (forex, metals, equities, …) → MMDPS.
//! - **MMDPS explicit mode** (`MMDPS_AUTO_ROUTE=false`): only symbols in `MMDPS_SYMBOLS` → MMDPS.
//! - Otherwise → Binance.

use std::collections::HashSet;

/// Which upstream implementation handles a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedKind {
    Binance,
    /// MMDPS WebSocket (`MMDPS_API_KEY`).
    Mmdps,
}

/// True when the symbol should use the Binance multiplex feed (spot-style `BASE + QUOTE` tickers).
///
/// **Important:** Many Binance quote assets (`EUR`, `TRY`, `ZAR`, `AUD`, …) are also used as
/// **forex / metal** quotes (`XAUEUR`, `USDZAR`, …). A naive `ends_with(EUR)` rule misroutes those
/// to Binance (no such pair) so the UI shows no price. We therefore:
/// 1. Treat **stablecoin** suffixes as Binance.
/// 2. Treat **classic 6-letter FX / metal** pairs (ISO-style + `XAU`/`XAG`/…) as **not** Binance.
/// 3. Treat remaining symbols that end with common **crypto** quote legs as Binance (`BTCEUR`, …).
#[inline]
pub fn is_binance_spot_style(symbol_upper: &str) -> bool {
    // Classic 6-letter FX/metals must run **before** stablecoin suffix checks: e.g. `XPTUSD`
    // (platinum vs USD) ends with the substring `TUSD` and would otherwise match the TrueUSD
    // ticker suffix and be misrouted to Binance.
    if is_likely_classic_fx_or_metal_6(symbol_upper) {
        return false;
    }
    const STABLE_QUOTE_SUFFIXES: &[&str] =
        &["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDD", "DAI"];
    if STABLE_QUOTE_SUFFIXES
        .iter()
        .any(|s| symbol_upper.len() > s.len() && symbol_upper.ends_with(s))
    {
        return true;
    }
    const CRYPTO_QUOTE_SUFFIXES: &[&str] = &[
        "EUR", "TRY", "BRL", "BTC", "ETH", "BNB", "AUD", "GBP", "RUB", "ZAR", "MXN", "ARS", "PLN",
        "RON", "UAH", "NGN",
    ];
    CRYPTO_QUOTE_SUFFIXES
        .iter()
        .any(|s| symbol_upper.len() > s.len() && symbol_upper.ends_with(s))
}

/// Six-letter symbols like `EURUSD`, `USDZAR`, `XAUEUR` (forex / precious metals), not Binance spot.
#[inline]
fn is_likely_classic_fx_or_metal_6(symbol_upper: &str) -> bool {
    if symbol_upper.len() != 6 {
        return false;
    }
    if !symbol_upper.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    let a = &symbol_upper[0..3];
    let b = &symbol_upper[3..6];
    if is_fiat3(a) && is_fiat3(b) {
        return true;
    }
    const METAL3: &[&str] = &["XAU", "XAG", "XPT", "XPD"];
    if METAL3.contains(&a) && is_fiat3(b) {
        return true;
    }
    false
}

#[inline]
fn is_fiat3(code: &str) -> bool {
    matches!(
        code,
        "USD"
            | "EUR"
            | "GBP"
            | "JPY"
            | "AUD"
            | "NZD"
            | "CAD"
            | "CHF"
            | "SEK"
            | "NOK"
            | "DKK"
            | "MXN"
            | "ZAR"
            | "TRY"
            | "PLN"
            | "HUF"
            | "CZK"
            | "ILS"
            | "CNY"
            | "CNH"
            | "HKD"
            | "SGD"
            | "RON"
            | "RUB"
            | "INR"
            | "IDR"
            | "THB"
            | "PHP"
            | "KRW"
            | "SAR"
            | "AED"
            | "COP"
            | "BRL"
            | "ARS"
            | "CLP"
            | "PEN"
            | "BGN"
            | "HRK"
            | "ISK"
            | "MAD"
            | "TWD"
            | "MYR"
            | "VND"
            | "BHD"
            | "JOD"
            | "KWD"
            | "OMR"
            | "QAR"
            | "EGP"
            | "NGN"
            | "GHS"
            | "KES"
            | "UGX"
            | "TZS"
            | "ZMW"
    )
}

/// Resolve routing for a symbol already normalized to uppercase.
#[inline]
pub fn resolve_feed(
    symbol_upper: &str,
    mmdps_feed_active: bool,
    mmdps_auto_route: bool,
    mmdps_explicit_symbols: &HashSet<String>,
) -> FeedKind {
    if !mmdps_feed_active {
        return FeedKind::Binance;
    }
    if mmdps_auto_route {
        if is_binance_spot_style(symbol_upper) {
            return FeedKind::Binance;
        }
        return FeedKind::Mmdps;
    }
    if mmdps_explicit_symbols.contains(symbol_upper) {
        return FeedKind::Mmdps;
    }
    FeedKind::Binance
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_crypto_binance() {
        let empty: HashSet<String> = HashSet::new();
        assert_eq!(
            resolve_feed("BTCUSDT", true, true, &empty),
            FeedKind::Binance
        );
        assert_eq!(
            resolve_feed("1000PEPEUSDT", true, true, &empty),
            FeedKind::Binance
        );
    }

    #[test]
    fn forex_and_equities_mmdps_when_auto() {
        let empty: HashSet<String> = HashSet::new();
        assert_eq!(resolve_feed("EURUSD", true, true, &empty), FeedKind::Mmdps);
        assert_eq!(resolve_feed("XAUUSD", true, true, &empty), FeedKind::Mmdps);
        assert_eq!(resolve_feed("AAPL", true, true, &empty), FeedKind::Mmdps);
    }

    /// Regressions: fiat quote codes overlap Binance quote assets — must not route FX/metals to Binance.
    #[test]
    fn exotic_fx_and_metal_crosses_are_mmdps_not_binance_quote_collision() {
        let empty: HashSet<String> = HashSet::new();
        for sym in [
            "USDZAR", "USDTRY", "ZARJPY", "XAUEUR", "XAGEUR", "XAUAUD", "XPTUSD", "XPDUSD",
        ] {
            assert_eq!(resolve_feed(sym, true, true, &empty), FeedKind::Mmdps);
        }
    }

    #[test]
    fn crypto_crosses_still_binance() {
        let empty: HashSet<String> = HashSet::new();
        assert_eq!(
            resolve_feed("BTCEUR", true, true, &empty),
            FeedKind::Binance
        );
        assert_eq!(
            resolve_feed("ETHBTC", true, true, &empty),
            FeedKind::Binance
        );
        assert_eq!(
            resolve_feed("BTCTUSD", true, true, &empty),
            FeedKind::Binance
        );
    }

    #[test]
    fn explicit_list_only_when_auto_off() {
        let mut m = HashSet::new();
        m.insert("EURUSD".into());
        assert_eq!(resolve_feed("EURUSD", true, false, &m), FeedKind::Mmdps);
        assert_eq!(resolve_feed("GBPUSD", true, false, &m), FeedKind::Binance);
    }

    #[test]
    fn mmdps_inactive_all_binance() {
        let empty: HashSet<String> = HashSet::new();
        assert_eq!(
            resolve_feed("EURUSD", false, true, &empty),
            FeedKind::Binance
        );
    }
}
