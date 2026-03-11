use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LeverageProfile {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub status: String, // 'active' or 'disabled' - stored as user_status enum in DB, cast to text in queries
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// User (manager/admin/super_admin) who created this profile.
    pub created_by_user_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LeverageProfileTier {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub tier_index: i32,
    pub notional_from: String,
    pub notional_to: Option<String>,
    pub max_leverage: i32,
    pub initial_margin_percent: String,
    pub maintenance_margin_percent: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LeverageProfileWithCounts {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    #[sqlx(rename = "tiers_count")]
    pub tiers_count: i64,
    #[sqlx(rename = "symbols_count")]
    pub symbols_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by_user_id: Option<Uuid>,
    pub created_by_email: Option<String>,
}

