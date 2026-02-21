use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LeadTask {
    pub id: Uuid,
    pub team_id: Uuid,
    pub lead_id: Uuid,
    pub assigned_to_user_id: Uuid,
    pub task_type: TaskType,
    pub due_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub status: TaskStatus,
    pub priority: LeadPriority,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TaskType {
    Call,
    Email,
    Whatsapp,
    Meeting,
    Doc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

use crate::domain::LeadPriority;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTaskInput {
    pub task_type: TaskType,
    pub due_at: DateTime<Utc>,
    pub assigned_to_user_id: Uuid,
    pub priority: Option<LeadPriority>,
    pub notes: Option<String>,
}
