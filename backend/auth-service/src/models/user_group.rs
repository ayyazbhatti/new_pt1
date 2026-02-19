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
    pub default_price_profile_id: Option<Uuid>,
    pub default_leverage_profile_id: Option<Uuid>,
    /// Margin call level as percentage (e.g. 50 = 50%). NULL = use platform default.
    pub margin_call_level: Option<rust_decimal::Decimal>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

