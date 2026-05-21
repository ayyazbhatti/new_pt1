use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FeeRule {
    pub id: Uuid,
    pub group_id: Uuid,
    pub symbol: Option<String>,
    pub market: Option<String>,
    pub fee_percent: rust_decimal::Decimal,
    pub min_fee: rust_decimal::Decimal,
    pub max_fee: Option<rust_decimal::Decimal>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub created_by_user_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FeeRuleWithGroupName {
    pub id: Uuid,
    pub group_id: Uuid,
    pub group_name: Option<String>,
    pub symbol: Option<String>,
    pub market: Option<String>,
    pub fee_percent: rust_decimal::Decimal,
    pub min_fee: rust_decimal::Decimal,
    pub max_fee: Option<rust_decimal::Decimal>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    pub created_by_user_id: Option<Uuid>,
    pub created_by_email: Option<String>,
}
