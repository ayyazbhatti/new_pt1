use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LeadStage {
    pub id: Uuid,
    pub team_id: Uuid,
    pub name: String,
    pub position: i32,
    pub color_token: String,
    pub sla_minutes: i32,
    pub require_email: bool,
    pub require_phone: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStageInput {
    pub name: String,
    pub position: Option<i32>,
    pub color_token: Option<String>,
    pub sla_minutes: Option<i32>,
    pub require_email: Option<bool>,
    pub require_phone: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStageInput {
    pub name: Option<String>,
    pub position: Option<i32>,
    pub color_token: Option<String>,
    pub sla_minutes: Option<i32>,
    pub require_email: Option<bool>,
    pub require_phone: Option<bool>,
}
