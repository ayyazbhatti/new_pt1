use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Symbol {
    pub id: Uuid,
    #[sqlx(rename = "symbol_code")]
    pub symbol_code: String,
    pub provider_symbol: Option<String>,
    pub asset_class: Option<String>,
    pub base_currency: String,
    pub quote_currency: String,
    pub price_precision: i32,
    pub volume_precision: i32,
    pub contract_size: String,
    #[sqlx(rename = "tick_size")]
    pub tick_size: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "lot_min")]
    pub lot_min: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "lot_max")]
    pub lot_max: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "default_pip_position")]
    pub default_pip_position: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "pip_position_min")]
    pub pip_position_min: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "pip_position_max")]
    pub pip_position_max: Option<rust_decimal::Decimal>,
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
    #[sqlx(rename = "tick_size")]
    pub tick_size: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "lot_min")]
    pub lot_min: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "lot_max")]
    pub lot_max: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "default_pip_position")]
    pub default_pip_position: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "pip_position_min")]
    pub pip_position_min: Option<rust_decimal::Decimal>,
    #[sqlx(rename = "pip_position_max")]
    pub pip_position_max: Option<rust_decimal::Decimal>,
    pub is_enabled: bool,
    pub trading_enabled: bool,
    pub leverage_profile_id: Option<Uuid>,
    pub leverage_profile_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

