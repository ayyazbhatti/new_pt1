use dashmap::DashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::warn;

pub struct SymbolValidator {
    enabled_symbols: Arc<DashSet<String>>,
    max_symbols_per_connection: usize,
}

impl SymbolValidator {
    pub fn new(max_symbols_per_connection: usize) -> Self {
        Self {
            enabled_symbols: Arc::new(DashSet::new()),
            max_symbols_per_connection,
        }
    }

    pub fn max_symbols_per_connection(&self) -> usize {
        self.max_symbols_per_connection
    }

    pub fn is_symbol_enabled(&self, symbol: &str) -> bool {
        self.enabled_symbols.contains(symbol)
    }

    pub fn enable_symbol(&self, symbol: String) {
        self.enabled_symbols.insert(symbol);
    }

    pub fn disable_symbol(&self, symbol: &str) {
        self.enabled_symbols.remove(symbol);
    }

    pub fn validate_subscription(&self, symbols: &[String]) -> Result<(), String> {
        if symbols.len() > self.max_symbols_per_connection {
            return Err(format!(
                "Too many symbols: {} (max: {})",
                symbols.len(),
                self.max_symbols_per_connection
            ));
        }

        for symbol in symbols {
            if !self.is_symbol_enabled(symbol) {
                return Err(format!("Symbol not enabled: {}", symbol));
            }
        }

        Ok(())
    }

    pub fn validate_symbol_format(&self, symbol: &str) -> bool {
        // Basic validation: alphanumeric, max 20 chars
        symbol.len() <= 20 && symbol.chars().all(|c| c.is_alphanumeric() || c == '_')
    }
}

pub struct RateLimiter {
    requests: Arc<DashSet<(String, Instant)>>,
    window: Duration,
    max_requests: usize,
}

impl RateLimiter {
    pub fn new(window_secs: u64, max_requests: usize) -> Self {
        Self {
            requests: Arc::new(DashSet::new()),
            window: Duration::from_secs(window_secs),
            max_requests,
        }
    }

    pub fn check_rate_limit(&self, identifier: &str) -> bool {
        let now = Instant::now();

        // Clean old entries
        self.requests.retain(|entry| {
            entry.0.as_str() == identifier && now.duration_since(entry.1) < self.window
        });

        let count = self
            .requests
            .iter()
            .filter(|entry| entry.0.as_str() == identifier)
            .count();

        if count >= self.max_requests {
            warn!("Rate limit exceeded for {}", identifier);
            return false;
        }

        self.requests.insert((identifier.to_string(), now));
        true
    }
}
