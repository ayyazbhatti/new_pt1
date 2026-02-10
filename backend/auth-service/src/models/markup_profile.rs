use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MarkupProfile {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub group_id: Option<Uuid>,
    pub markup_type: String, // 'points' or 'percent'
    pub bid_markup: String,
    pub ask_markup: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MarkupProfileWithGroup {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub group_id: Option<Uuid>,
    pub group_name: Option<String>,
    pub markup_type: String,
    pub bid_markup: String,
    pub ask_markup: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SymbolMarkupOverride {
    pub id: Uuid,
    pub profile_id: Uuid,
    pub symbol_id: Uuid,
    pub symbol_code: String,
    pub bid_markup: String,
    pub ask_markup: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

