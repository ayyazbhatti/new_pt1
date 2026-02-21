use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LeadActivity {
    pub id: Uuid,
    pub team_id: Uuid,
    pub lead_id: Uuid,
    pub actor_user_id: Uuid,
    pub activity_type: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}
