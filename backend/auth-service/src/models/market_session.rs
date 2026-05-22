use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTemplateWindowDto {
    pub id: Option<Uuid>,
    pub day_of_week: i16,
    pub open_time: String,
    pub close_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSessionTemplateDto {
    pub id: Uuid,
    pub name: String,
    pub timezone: String,
    pub description: Option<String>,
    /// JSON uses `is24_7` (matches clients; avoids serde `camelCase` → `is247`).
    #[serde(rename = "is24_7")]
    pub is_24_7: bool,
    pub is_default_for_market: Option<String>,
    pub windows: Vec<SessionTemplateWindowDto>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
}

/// Admin API: holiday row for a session template (Phase 4).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketHolidayDto {
    pub id: Uuid,
    pub template_id: Uuid,
    pub holiday_date: NaiveDate,
    pub name: String,
    /// `"closed"` | `"half_day"` (JSON field `type`).
    #[serde(rename = "type")]
    pub holiday_type: String,
    pub half_day_close_time: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}
