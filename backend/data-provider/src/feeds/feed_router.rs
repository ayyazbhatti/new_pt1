//! Routes each symbol to Binance or MMDPS.
//! With MMDPS auto-routing, Binance-style spot symbols use Binance; others use MMDPS.

use std::collections::HashSet;
use std::sync::Arc;

use anyhow::{Context, Result};
use serde::Serialize;

use super::binance_feed::{BinanceFeed, PriceState};
use super::mmdps_feed::MmdpsFeed;
use super::routing::{resolve_feed, FeedKind};

pub struct FeedRouter {
    binance: Arc<BinanceFeed>,
    mmdps: Option<Arc<MmdpsFeed>>,
    mmdps_auto_route: bool,
    mmdps_symbols: Arc<HashSet<String>>,
}

#[derive(Debug, Serialize)]
pub struct FeedRouterDiagnostics {
    pub binance_tracked_symbols: usize,
    pub mmdps_configured: bool,
    pub mmdps_auto_route: bool,
    pub mmdps_symbols: Vec<String>,
    pub mmdps_tracked_symbols: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct FeedFreshnessDiagnostics {
    pub now_ms: u64,
    pub binance_last_tick_ts: Option<u64>,
    pub binance_tick_age_secs: Option<u64>,
    pub mmdps_last_tick_ts: Option<u64>,
    pub mmdps_tick_age_secs: Option<u64>,
}

impl FeedRouter {
    pub fn new(
        binance: Arc<BinanceFeed>,
        mmdps: Option<Arc<MmdpsFeed>>,
        mmdps_auto_route: bool,
        mmdps_symbols: HashSet<String>,
    ) -> Self {
        let upper_mmdps: HashSet<String> = mmdps_symbols
            .into_iter()
            .map(|s| s.to_uppercase())
            .collect();
        Self {
            binance,
            mmdps,
            mmdps_auto_route,
            mmdps_symbols: Arc::new(upper_mmdps),
        }
    }

    pub fn mmdps_is_configured(&self) -> bool {
        self.mmdps.is_some() && (self.mmdps_auto_route || !self.mmdps_symbols.is_empty())
    }

    pub async fn diagnostics(&self) -> FeedRouterDiagnostics {
        let binance_tracked_symbols = self.binance.tracked_symbol_count().await;

        let mmdps_tracked_symbols = self
            .mmdps
            .as_ref()
            .map(|m| m.tracked_symbol_count())
            .unwrap_or(0);
        let mut mmdps_symbols: Vec<String> = self.mmdps_symbols.iter().cloned().collect();
        mmdps_symbols.sort();

        FeedRouterDiagnostics {
            binance_tracked_symbols,
            mmdps_configured: self.mmdps_is_configured(),
            mmdps_auto_route: self.mmdps_auto_route,
            mmdps_symbols,
            mmdps_tracked_symbols,
        }
    }

    pub fn freshness(&self) -> FeedFreshnessDiagnostics {
        let now_ms = current_time_ms();
        let binance_last_tick_ts = self.binance.latest_tick_ts();
        let mmdps_last_tick_ts = self.mmdps.as_ref().and_then(|m| m.latest_tick_ts());
        FeedFreshnessDiagnostics {
            now_ms,
            binance_tick_age_secs: binance_last_tick_ts
                .map(|ts| (now_ms.saturating_sub(ts)) / 1000),
            binance_last_tick_ts,
            mmdps_tick_age_secs: mmdps_last_tick_ts.map(|ts| (now_ms.saturating_sub(ts)) / 1000),
            mmdps_last_tick_ts,
        }
    }

    pub fn force_resync_upstreams(&self) {
        self.binance.force_reconnect();
        if let Some(mmdps) = &self.mmdps {
            mmdps.force_resync();
        }
    }

    #[inline]
    pub async fn get_price(&self, symbol: &str) -> Option<PriceState> {
        let u = symbol.to_uppercase();
        let mmdps_on = self.mmdps.is_some();
        match resolve_feed(&u, mmdps_on, self.mmdps_auto_route, &self.mmdps_symbols) {
            FeedKind::Binance => self.binance.get_price(&u).await,
            FeedKind::Mmdps => {
                let m = self.mmdps.as_ref()?;
                m.get_price(&u).await
            }
        }
    }

    #[inline]
    pub async fn subscribe_symbol(&self, symbol: &str) -> Result<()> {
        let u = symbol.to_uppercase();
        let mmdps_on = self.mmdps.is_some();
        match resolve_feed(&u, mmdps_on, self.mmdps_auto_route, &self.mmdps_symbols) {
            FeedKind::Binance => self.binance.subscribe_symbol(&u).await,
            FeedKind::Mmdps => {
                let m = self.mmdps.as_ref().context("MMDPS feed not initialized")?;
                m.subscribe_symbol(&u).await
            }
        }
    }
}

fn current_time_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
