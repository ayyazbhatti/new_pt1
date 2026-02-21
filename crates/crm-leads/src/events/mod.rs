use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Outbox event row and NATS payloads for leads module.
/// Subject names: leads.created, leads.updated, leads.assigned, leads.stage_changed,
/// leads.task.created, leads.task.completed, leads.activity.added,
/// leads.email.queued, leads.email.sent, leads.email.failed

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxEventRow {
    pub id: i64,
    pub aggregate_type: String,
    pub aggregate_id: Uuid,
    pub team_id: Uuid,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub published_at: Option<DateTime<Utc>>,
    pub publish_attempts: i32,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadCreatedPayload {
    pub lead_id: Uuid,
    pub team_id: Uuid,
    #[serde(flatten)]
    pub lead: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadUpdatedPayload {
    pub lead_id: Uuid,
    pub team_id: Uuid,
    #[serde(flatten)]
    pub lead: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadAssignedPayload {
    pub lead_id: Uuid,
    pub team_id: Uuid,
    pub owner_user_id: Uuid,
    #[serde(flatten)]
    pub lead: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadStageChangedPayload {
    pub lead_id: Uuid,
    pub team_id: Uuid,
    pub stage_id: Uuid,
    pub previous_stage_id: Uuid,
    #[serde(flatten)]
    pub lead: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadTaskCreatedPayload {
    pub task_id: Uuid,
    pub lead_id: Uuid,
    pub team_id: Uuid,
    #[serde(flatten)]
    pub task: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadTaskCompletedPayload {
    pub task_id: Uuid,
    pub lead_id: Uuid,
    pub team_id: Uuid,
    #[serde(flatten)]
    pub task: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadActivityAddedPayload {
    pub activity_id: Uuid,
    pub lead_id: Uuid,
    pub team_id: Uuid,
    pub actor_user_id: Uuid,
    pub activity_type: String,
    #[serde(flatten)]
    pub activity: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadEmailQueuedPayload {
    pub message_id: Uuid,
    pub lead_id: Uuid,
    pub team_id: Uuid,
    #[serde(flatten)]
    pub message: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadEmailSentPayload {
    pub message_id: Uuid,
    pub lead_id: Uuid,
    pub team_id: Uuid,
    pub provider_message_id: Option<String>,
    #[serde(flatten)]
    pub message: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadEmailFailedPayload {
    pub message_id: Uuid,
    pub lead_id: Uuid,
    pub team_id: Uuid,
    pub error: Option<String>,
    #[serde(flatten)]
    pub message: serde_json::Value,
}

/// WS broadcast format: { "type": "leads.email.sent", "ts": "...", "payload": {...} }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsLeadsEvent {
    pub r#type: String,
    pub ts: DateTime<Utc>,
    pub payload: serde_json::Value,
}
