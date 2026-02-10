use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Symbol {
    pub id: Uuid,
    #[sqlx(rename = "code")]
    pub symbol_code: String,
    pub provider_symbol: Option<String>,
    pub asset_class: Option<String>,
    pub base_currency: String,
    pub quote_currency: String,
    pub price_precision: i32,
    pub volume_precision: i32,
    pub contract_size: String,
    pub is_enabled: bool,
    pub trading_enabled: bool,
    pub leverage_profile_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SymbolWithProfile {
    pub id: Uuid,
    #[sqlx(rename = "symbol_code")]
    pub symbol_code: String,
    pub provider_symbol: Option<String>,
    pub asset_class: Option<String>,
    pub base_currency: String,
    pub quote_currency: String,
    pub price_precision: i32,
    pub volume_precision: i32,
    #[sqlx(rename = "contract_size")]
    pub contract_size: String,
    pub is_enabled: bool,
    pub trading_enabled: bool,
    pub leverage_profile_id: Option<Uuid>,
    pub leverage_profile_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

