use std::collections::HashSet;
use std::env;

use contracts::DataProvidersConfig;

#[derive(Debug, Clone)]
pub struct Config {
    pub redis_url: String,
    /// Legacy label (default `binance`). Logged for operators; routing uses MMDPS env and symbol lists.
    pub feed_provider: String,
    pub server_region: String,
    pub max_connections: usize,
    pub ws_port: u16,
    pub admin_secret_key: String,
    pub http_port: u16,
    pub binance_ws_url: String,
    /// MMDPS live + history (`MMDPS_API_KEY`).
    pub mmdps_api_key: Option<String>,
    pub mmdps_ws_base: String,
    pub mmdps_history_base: String,
    /// When `true` (default with API key): route non–Binance-style symbols to MMDPS. When `false`, only [`Self::mmdps_symbols`] use MMDPS (legacy).
    pub mmdps_auto_route: bool,
    /// Explicit list from `MMDPS_SYMBOLS`; also used for legacy mode when [`Self::mmdps_auto_route`] is `false`. When auto-routing, optional extra bootstrap seeds only.
    pub mmdps_symbols: HashSet<String>,
    /// When set, periodically load enabled MMDPS-routed symbols from Postgres (`symbols` table, same DB as auth-service).
    pub symbols_database_url: Option<String>,
    /// How often to merge new catalog symbols into upstream subscriptions (`0` = run once at startup only).
    pub symbol_catalog_refresh_secs: u64,
    /// Safety cap for catalog-driven MMDPS symbols (after Binance-style filter).
    pub catalog_mmdps_max_symbols: usize,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let mmdps_api_key = env::var("MMDPS_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let mmdps_symbols_from_env: HashSet<String> = env::var("MMDPS_SYMBOLS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty())
            .collect();

        let mmdps_auto_route_env = match env::var("MMDPS_AUTO_ROUTE") {
            Ok(v) if v == "0" || v.eq_ignore_ascii_case("false") => false,
            _ => true,
        };
        // Auto-routing requires an API key; explicit-only mode uses MMDPS_AUTO_ROUTE=false.
        let mmdps_auto_route = mmdps_api_key.is_some() && mmdps_auto_route_env;

        // Legacy: key + auto off + empty env list → default EURUSD,GBPUSD as explicit MMDPS set.
        let mmdps_symbols: HashSet<String> = if mmdps_api_key.is_some()
            && !mmdps_auto_route
            && mmdps_symbols_from_env.is_empty()
        {
            ["EURUSD", "GBPUSD"].into_iter().map(String::from).collect()
        } else {
            mmdps_symbols_from_env
        };

        let symbols_database_url = env::var("SYMBOLS_DATABASE_URL")
            .ok()
            .or_else(|| env::var("DATABASE_URL").ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let symbol_catalog_refresh_secs = env::var("SYMBOLS_CATALOG_REFRESH_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(300);

        let catalog_mmdps_max_symbols = env::var("CATALOG_MMDPS_MAX_SYMBOLS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(25_000_usize);

        Ok(Config {
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
            feed_provider: env::var("FEED_PROVIDER").unwrap_or_else(|_| "binance".to_string()),
            server_region: env::var("SERVER_REGION").unwrap_or_else(|_| "asia-1".to_string()),
            max_connections: env::var("MAX_CONNECTIONS")
                .unwrap_or_else(|_| "200000".to_string())
                .parse()
                .unwrap_or(200000),
            ws_port: env::var("WS_PORT")
                .unwrap_or_else(|_| "9003".to_string())
                .parse()
                .unwrap_or(9003),
            http_port: env::var("HTTP_PORT")
                .unwrap_or_else(|_| "9004".to_string())
                .parse()
                .unwrap_or(9004),
            admin_secret_key: env::var("ADMIN_SECRET_KEY")
                .unwrap_or_else(|_| "change-me-in-production".to_string()),
            binance_ws_url: env::var("BINANCE_WS_URL")
                .unwrap_or_else(|_| "wss://stream.binance.com:9443/ws".to_string()),
            mmdps_api_key,
            mmdps_ws_base: env::var("MMDPS_WS_BASE")
                .unwrap_or_else(|_| "wss://api.mmdps.uk/feed/ws".to_string()),
            mmdps_history_base: env::var("MMDPS_HISTORY_BASE")
                .unwrap_or_else(|_| "https://api.mmdps.uk/feed/history".to_string()),
            mmdps_auto_route,
            mmdps_symbols,
            symbols_database_url,
            symbol_catalog_refresh_secs,
            catalog_mmdps_max_symbols,
        })
    }

    /// Full MMDPS WebSocket URL including `api_key` query (env `MMDPS_WS_BASE` + `MMDPS_API_KEY`).
    pub fn mmdps_ws_connect_url(&self) -> Option<String> {
        let key = self.mmdps_api_key.as_ref()?;
        let base = self.mmdps_ws_base.trim();
        if base.contains('?') {
            Some(format!("{}&api_key={}", base, key))
        } else {
            Some(format!("{}?api_key={}", base, key))
        }
    }

    /// Apply admin UI / Redis config on top of env-based defaults (Binance multiplex URL only).
    pub fn merge_data_providers_admin(&mut self, cfg: &DataProvidersConfig) {
        for p in &cfg.providers {
            if p.provider_type == "binance" {
                if let Some(ref u) = p.ws_url {
                    let t = u.trim();
                    if !t.is_empty() {
                        self.binance_ws_url = t.to_string();
                    }
                }
            }
        }
    }
}
