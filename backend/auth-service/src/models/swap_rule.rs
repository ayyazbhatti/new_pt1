use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SwapRule {
    pub id: Uuid,
    pub group_id: Uuid,
    pub symbol: String,
    pub market: String,
    pub calc_mode: String,
    pub unit: String,
    pub long_rate: rust_decimal::Decimal,
    pub short_rate: rust_decimal::Decimal,
    pub rollover_time_utc: String,
    pub triple_day: Option<String>,
    pub weekend_rule: String,
    pub min_charge: Option<rust_decimal::Decimal>,
    pub max_charge: Option<rust_decimal::Decimal>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SwapRuleWithGroupName {
    pub id: Uuid,
    pub group_id: Uuid,
    pub group_name: Option<String>,
    pub symbol: String,
    pub market: String,
    pub calc_mode: String,
    pub unit: String,
    pub long_rate: rust_decimal::Decimal,
    pub short_rate: rust_decimal::Decimal,
    pub rollover_time_utc: String,
    pub triple_day: Option<String>,
    pub weekend_rule: String,
    pub min_charge: Option<rust_decimal::Decimal>,
    pub max_charge: Option<rust_decimal::Decimal>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
}
