//! Persisted admin config for market data providers (see `platform_data_provider_integrations`).

use contracts::{
    DataProvidersConfig, REDIS_CHANNEL_INTEGRATIONS_UPDATED, REDIS_KEY_ADMIN_INTEGRATIONS,
};
use redis::AsyncCommands;
use sqlx::PgPool;

use crate::redis_pool::RedisPool;

pub struct DataProviderIntegrationsService {
    pool: PgPool,
}

impl DataProviderIntegrationsService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    fn strip_legacy_mock_providers(mut cfg: DataProvidersConfig) -> DataProvidersConfig {
        cfg.providers
            .retain(|p| p.provider_type != "mock_forex");
        cfg
    }

    pub async fn get(&self) -> Result<DataProvidersConfig, sqlx::Error> {
        let v: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT config_json FROM platform_data_provider_integrations WHERE singleton_id = 1",
        )
        .fetch_optional(&self.pool)
        .await?;

        match v {
            Some(json) => {
                let parsed: DataProvidersConfig =
                    serde_json::from_value(json).unwrap_or_else(|_| DataProvidersConfig::default_v1());
                Ok(Self::merge_with_defaults(Self::strip_legacy_mock_providers(parsed)))
            }
            None => Ok(DataProvidersConfig::default_v1()),
        }
    }

    pub async fn save(&self, cfg: &DataProvidersConfig) -> Result<(), sqlx::Error> {
        let json = serde_json::to_value(cfg).expect("DataProvidersConfig serializes to JSON");
        sqlx::query(
            r#"UPDATE platform_data_provider_integrations SET config_json = $1, updated_at = NOW() WHERE singleton_id = 1"#,
        )
        .bind(json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Normalize and validate. Binance stays enabled (required for crypto routing).
    pub fn validate_and_normalize(mut cfg: DataProvidersConfig) -> Result<DataProvidersConfig, String> {
        cfg.version = 1;
        cfg = Self::strip_legacy_mock_providers(cfg);

        let allowed = ["binance"];
        for p in &cfg.providers {
            if !allowed.contains(&p.provider_type.as_str()) {
                return Err(format!("Unknown provider type: {}", p.provider_type));
            }
        }

        if !cfg.providers.iter().any(|p| p.provider_type == "binance") {
            return Err("Configuration must include a Binance provider entry".into());
        }

        for p in &mut cfg.providers {
            if p.provider_type == "binance" {
                p.enabled = true;
                if let Some(ref u) = p.ws_url {
                    let t = u.trim();
                    if t.is_empty() {
                        p.ws_url = None;
                    } else if !t.starts_with("wss://") && !t.starts_with("ws://") {
                        return Err("Binance WebSocket URL must start with wss:// or ws://".into());
                    } else {
                        p.ws_url = Some(t.to_string());
                    }
                }
            }
        }

        Ok(cfg)
    }

    /// Ensure default entries exist (merge missing ids from default_v1).
    pub fn merge_with_defaults(mut cfg: DataProvidersConfig) -> DataProvidersConfig {
        let default = DataProvidersConfig::default_v1();
        for d in default.providers {
            if !cfg.providers.iter().any(|p| p.id == d.id) {
                cfg.providers.push(d);
            }
        }
        cfg
    }

    pub async fn sync_to_redis(redis: &RedisPool, cfg: &DataProvidersConfig) -> Result<(), String> {
        let mut conn = redis
            .get()
            .await
            .map_err(|_| "Redis unavailable".to_string())?;
        let payload = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
        conn
            .set::<_, _, ()>(REDIS_KEY_ADMIN_INTEGRATIONS, payload)
            .await
            .map_err(|e| format!("Redis SET: {}", e))?;
        let _: i64 = conn
            .publish(REDIS_CHANNEL_INTEGRATIONS_UPDATED, "1")
            .await
            .map_err(|e| format!("Redis PUBLISH: {}", e))?;
        Ok(())
    }
}
