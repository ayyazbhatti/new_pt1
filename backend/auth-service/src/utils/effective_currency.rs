//! Resolve effective display currency: user → group → platform → USD.
//! Values are trimmed; empty strings are ignored at each level.

use sqlx::PgPool;

#[derive(sqlx::FromRow)]
struct PlatformGeneralRow {
    timezone: String,
    currency: String,
}

/// Loads platform default timezone and currency from the singleton row.
pub async fn fetch_platform_settings(
    pool: &PgPool,
) -> Result<(Option<String>, Option<String>), sqlx::Error> {
    let row = sqlx::query_as::<_, PlatformGeneralRow>(
        "SELECT timezone, currency FROM platform_general_settings WHERE singleton_id = 1",
    )
    .fetch_optional(pool)
    .await?;

    Ok(match row {
        Some(r) => (nonempty_trimmed(r.timezone), nonempty_trimmed(r.currency)),
        None => (None, None),
    })
}

fn nonempty_trimmed(s: String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Returns `(effective_code, origin)` where origin is `user` | `group` | `platform` | `fallback`.
pub fn resolve_effective_display_currency(
    user_c: Option<&str>,
    group_c: Option<&str>,
    platform_c: Option<&str>,
) -> (String, String) {
    if let Some(u) = user_c.map(str::trim).filter(|s| !s.is_empty()) {
        return (u.to_ascii_uppercase(), "user".into());
    }
    if let Some(g) = group_c.map(str::trim).filter(|s| !s.is_empty()) {
        return (g.to_ascii_uppercase(), "group".into());
    }
    if let Some(p) = platform_c.map(str::trim).filter(|s| !s.is_empty()) {
        return (p.to_ascii_uppercase(), "platform".into());
    }
    ("USD".into(), "fallback".into())
}
