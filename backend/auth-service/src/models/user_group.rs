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
    /// Unique slug for signup link (e.g. "golduser"). Used in /register?ref=<slug>. 3-20 chars, alphanumeric.
    pub signup_slug: Option<String>,
    pub default_price_profile_id: Option<Uuid>,
    pub default_leverage_profile_id: Option<Uuid>,
    /// Margin call level as percentage (e.g. 50 = 50%). NULL = use platform default.
    pub margin_call_level: Option<rust_decimal::Decimal>,
    /// Stop out level as percentage (e.g. 20 = 20%). When margin level falls below this, all positions are closed. NULL = no automatic stop out.
    pub stop_out_level: Option<rust_decimal::Decimal>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// User (manager/admin/super_admin) who created this group.
    pub created_by_user_id: Option<Uuid>,
    /// When true, users in this group do not see the Leverage section in the trading terminal right panel.
    pub hide_leverage_in_terminal: bool,
    /// Optional IANA timezone default for members (unless overridden per user).
    #[serde(default)]
    #[sqlx(default)]
    pub timezone: Option<String>,
    /// Optional ISO 4217 display currency default for members (unless overridden per user).
    #[serde(default)]
    #[sqlx(default)]
    pub display_currency: Option<String>,
    /// When true, swap (overnight financing) may be charged for open positions at rollover (Phase 3 engine).
    #[serde(default)]
    pub swap_enabled: bool,
    /// When true, per-trade fees may be charged at order placement (Phase 2 engine).
    #[serde(default)]
    pub fees_enabled: bool,
    /// Optional per-group default max slippage (bps) for market orders; NULL = use platform default.
    #[serde(default)]
    #[sqlx(default)]
    pub default_slippage_bps: Option<i32>,
}

