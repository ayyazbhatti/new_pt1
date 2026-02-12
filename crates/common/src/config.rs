use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    pub redis_url: String,
    pub nats_url: String,
    pub log_level: String,
    pub service_name: String,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost:5432/trading".to_string()),
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            nats_url: env::var("NATS_URL")
                .unwrap_or_else(|_| "nats://localhost:4222".to_string()),
            log_level: env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string()),
            service_name: env::var("SERVICE_NAME").unwrap_or_else(|_| "trading-service".to_string()),
        })
    }
}

