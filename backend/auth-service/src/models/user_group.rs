use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserGroup {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub status: String, // 'active' or 'disabled'
    pub priority: i32,
    pub min_leverage: i32,
    pub max_leverage: i32,
    pub max_open_positions: Option<i32>, // Nullable in database
    pub max_open_orders: Option<i32>, // Nullable in database
    pub risk_mode: String, // 'standard', 'conservative', 'aggressive'
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_price_profile_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_leverage_profile_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

