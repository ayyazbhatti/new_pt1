use std::env;
use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub nats_url: String,
    pub redis_url: String,
    pub max_pending_orders_per_symbol: usize,
    pub log_level: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            nats_url: env::var("NATS_URL")
                .unwrap_or_else(|_| "nats://localhost:4222".to_string()),
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            max_pending_orders_per_symbol: env::var("MAX_PENDING_ORDERS_PER_SYMBOL")
                .unwrap_or_else(|_| "50000".to_string())
                .parse()
                .context("Invalid MAX_PENDING_ORDERS_PER_SYMBOL")?,
            log_level: env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,order_engine=debug".to_string()),
        })
    }
}

