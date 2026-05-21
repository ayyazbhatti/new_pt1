//! Resolve effective IANA timezone: user → group → platform → UTC.
//! Invalid strings at any level are skipped (same idea as frontend `isValidIanaTimezone`).

use chrono_tz::Tz;
use sqlx::PgPool;
use std::str::FromStr;

pub fn is_valid_iana_timezone(tz: &str) -> bool {
    let t = tz.trim();
    !t.is_empty() && Tz::from_str(t).is_ok()
}

/// Returns `(effective_iana, origin)` where origin is `user` | `group` | `platform` | `fallback`.
pub fn resolve_effective_timezone(
    user_tz: Option<&str>,
    group_tz: Option<&str>,
    platform_tz: Option<&str>,
) -> (String, String) {
    if let Some(u) = user_tz.map(str::trim).filter(|s| !s.is_empty()) {
        if is_valid_iana_timezone(u) {
            return (u.to_string(), "user".to_string());
        }
    }
    if let Some(g) = group_tz.map(str::trim).filter(|s| !s.is_empty()) {
        if is_valid_iana_timezone(g) {
            return (g.to_string(), "group".to_string());
        }
    }
    if let Some(p) = platform_tz.map(str::trim).filter(|s| !s.is_empty()) {
        if is_valid_iana_timezone(p) {
            return (p.to_string(), "platform".to_string());
        }
    }
    ("UTC".to_string(), "fallback".to_string())
}

pub async fn fetch_platform_timezone(pool: &PgPool) -> Result<Option<String>, sqlx::Error> {
    let row: Option<String> = sqlx::query_scalar(
        "SELECT timezone FROM platform_general_settings WHERE singleton_id = 1",
    )
    .fetch_optional(pool)
    .await?;

    Ok(row
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()))
}
