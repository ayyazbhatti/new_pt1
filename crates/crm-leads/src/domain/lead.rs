use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Lead {
    pub id: Uuid,
    pub team_id: Uuid,
    pub owner_user_id: Option<Uuid>,
    pub first_name: String,
    pub last_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub language: Option<String>,
    pub timezone: Option<String>,
    pub status: LeadStatus,
    pub stage_id: Uuid,
    pub source: Option<String>,
    pub campaign: Option<String>,
    pub utm_source: Option<String>,
    pub utm_medium: Option<String>,
    pub utm_campaign: Option<String>,
    pub tags: Vec<String>,
    pub priority: LeadPriority,
    pub score: i32,
    pub last_contact_at: Option<DateTime<Utc>>,
    pub next_followup_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum LeadStatus {
    Open,
    Converted,
    Lost,
    Junk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum LeadPriority {
    Low,
    Normal,
    High,
    Vip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLeadInput {
    pub first_name: String,
    pub last_name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub language: Option<String>,
    pub timezone: Option<String>,
    pub stage_id: Uuid,
    pub owner_user_id: Option<Uuid>,
    pub source: Option<String>,
    pub campaign: Option<String>,
    pub tags: Option<Vec<String>>,
    pub priority: Option<LeadPriority>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateLeadInput {
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub language: Option<String>,
    pub timezone: Option<String>,
    pub source: Option<String>,
    pub campaign: Option<String>,
    pub tags: Option<Vec<String>>,
    pub priority: Option<LeadPriority>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListLeadsQuery {
    pub status: Option<LeadStatus>,
    pub stage_id: Option<Uuid>,
    pub owner_user_id: Option<Uuid>,
    pub source: Option<String>,
    pub country: Option<String>,
    pub score_min: Option<i32>,
    pub score_max: Option<i32>,
    pub search: Option<String>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}
