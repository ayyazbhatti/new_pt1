//! Persisted admin config for market data providers (see `platform_data_provider_integrations`).

use contracts::{
    DataProvidersConfig, REDIS_CHANNEL_INTEGRATIONS_UPDATED, REDIS_KEY_ADMIN_INTEGRATIONS,
    REDIS_KEY_DATA_PROVIDER_MMDPS_API_KEY,
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

    /// Whether a non-empty MMDPS API key is stored (never returns the secret).
    pub async fn mmdps_api_key_configured(&self) -> Result<bool, sqlx::Error> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT mmdps_api_key FROM platform_data_provider_integrations WHERE singleton_id = 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row
            .and_then(|(v,)| v)
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false))
    }

    /// Prefer DB key for MMDPS HTTP calls; fall back to `MMDPS_API_KEY` env.
    pub async fn resolve_mmdps_api_key(pool: &sqlx::PgPool) -> Option<String> {
        let row: Option<Option<String>> = sqlx::query_scalar(
            "SELECT mmdps_api_key FROM platform_data_provider_integrations WHERE singleton_id = 1",
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        let from_db = row.flatten().and_then(|s| {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        });
        if from_db.is_some() {
            return from_db;
        }
        std::env::var("MMDPS_API_KEY")
            .ok()
            .and_then(|s| {
                let t = s.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            })
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

    /// Update stored MMDPS key when `mmdpsApiKey` was present in the request body.
    /// `None` = leave DB unchanged; `Some(s)` = set to trimmed `s`, or NULL if `s` is empty (clear).
    pub async fn apply_mmdps_api_key_from_request(&self, key: Option<String>) -> Result<(), sqlx::Error> {
        let Some(raw) = key else {
            return Ok(());
        };
        let sql_val: Option<&str> = {
            let t = raw.trim();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        };
        sqlx::query(
            r#"UPDATE platform_data_provider_integrations SET mmdps_api_key = $1, updated_at = NOW() WHERE singleton_id = 1"#,
        )
        .bind(sql_val)
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

    /// Mirror DB MMDPS key to Redis for data-provider (overrides env at startup).
    pub async fn sync_mmdps_key_to_redis(
        redis: &RedisPool,
        key: Option<&str>,
    ) -> Result<(), String> {
        let mut conn = redis
            .get()
            .await
            .map_err(|_| "Redis unavailable".to_string())?;
        let trimmed = key.map(str::trim).filter(|s| !s.is_empty());
        match trimmed {
            Some(s) => conn
                .set::<_, _, ()>(REDIS_KEY_DATA_PROVIDER_MMDPS_API_KEY, s)
                .await
                .map_err(|e| format!("Redis SET mmdps key: {}", e))?,
            None => {
                let _: () = conn
                    .del(REDIS_KEY_DATA_PROVIDER_MMDPS_API_KEY)
                    .await
                    .map_err(|e| format!("Redis DEL mmdps key: {}", e))?;
            }
        }
        Ok(())
    }
}
