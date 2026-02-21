use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LeadMessage {
    pub id: Uuid,
    pub team_id: Uuid,
    pub lead_id: Uuid,
    pub actor_user_id: Uuid,
    pub message_type: MessageType,
    pub to_email: Option<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: Option<String>,
    pub body: String,
    pub status: MessageStatus,
    pub provider: Option<String>,
    pub provider_message_id: Option<String>,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Email,
    Note,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum MessageStatus {
    Queued,
    Sent,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendEmailInput {
    pub template_id: Option<Uuid>,
    pub subject: String,
    pub body: String,
    pub to_email: String,
    pub cc: Option<Vec<String>>,
    pub bcc: Option<Vec<String>>,
}
