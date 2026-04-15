//! Admin-configured market data providers (stored in Postgres, mirrored to Redis for data-provider).

use serde::{Deserialize, Serialize};

pub const REDIS_KEY_ADMIN_INTEGRATIONS: &str = "data_provider:admin_integrations";
pub const REDIS_CHANNEL_INTEGRATIONS_UPDATED: &str = "data_provider:integrations_updated";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataProvidersConfig {
    pub version: u32,
    pub providers: Vec<DataProviderEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataProviderEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub enabled: bool,
    pub display_name: String,
    #[serde(default)]
    pub ws_url: Option<String>,
    #[serde(default)]
    pub symbols: Vec<String>,
}

impl DataProvidersConfig {
    pub fn default_v1() -> Self {
        Self {
            version: 1,
            providers: vec![DataProviderEntry {
                id: "binance".into(),
                provider_type: "binance".into(),
                enabled: true,
                display_name: "Binance Spot".into(),
                ws_url: None,
                symbols: vec![],
            }],
        }
    }
}
