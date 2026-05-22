//! Explicit column lists for `sqlx::query_as` — avoids `SELECT *` / `RETURNING *`.
//!
//! PostgreSQL can error with **"cached plan must not change result type"** when a pooled
//! connection still has a prepared statement for `SELECT * FROM users` and `ALTER TABLE users
//! ADD COLUMN` changes the expanded row shape. Fixed column lists keep the result type stable
//! across DDL until this list is updated.

/// Columns for [`super::user::User`] — must match `public.users` and [`super::user::User`].
pub const USERS_ROW_SQL: &str = "\
id, email, password_hash, first_name, last_name, phone, country, status, role, group_id, \
account_type, margin_calculation_type, trading_access, min_leverage, max_leverage, \
referral_code, referred_by_user_id, email_verified, created_at, updated_at, last_login_at, \
permission_profile_id, deleted_at, timezone, display_currency, \
confirm_orders_before_placement";

/// Columns for [`super::user::UserSession`] — must match `public.user_sessions`.
pub const USER_SESSIONS_ROW_SQL: &str =
    "id, user_id, refresh_token_hash, user_agent, ip, is_revoked, expires_at, created_at";
