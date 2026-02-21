use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "user_status", rename_all = "lowercase")]
pub enum UserStatus {
    Active,
    Disabled,
    Suspended,
}

impl From<UserStatus> for String {
    fn from(status: UserStatus) -> Self {
        match status {
            UserStatus::Active => "active".to_string(),
            UserStatus::Disabled => "disabled".to_string(),
            UserStatus::Suspended => "suspended".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub first_name: String,
    pub last_name: String,
    pub phone: Option<String>,
    pub country: Option<String>,
    pub status: UserStatus,
    pub role: String, // VARCHAR in database, not enum
    pub group_id: Option<Uuid>,
    #[serde(default)]
    pub account_type: Option<String>, // 'hedging' | 'netting'; from users.account_type (migration 0019)
    pub min_leverage: Option<i32>,
    pub max_leverage: Option<i32>,
    pub referral_code: Option<String>,
    pub referred_by_user_id: Option<Uuid>,
    pub email_verified: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub refresh_token_hash: String,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
    pub is_revoked: bool,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub status: String,
}

impl From<User> for PublicUser {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: user.role.into(),
            status: user.status.into(),
        }
    }
}

