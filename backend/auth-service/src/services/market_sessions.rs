//! Resolve market session templates and compute open/closed status (Phase 2 enforcement support).
//! Template resolution: explicit `symbols.session_template_id` → default for `symbols.market` →
//! first 24/7 template (prefer crypto default), with WARN on fallback.

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, Utc, Weekday};
use chrono::TimeZone;
use chrono_tz::Tz;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub is_open: bool,
    pub template_id: Uuid,
    pub template_name: String,
    pub timezone: String,
    pub is24_7: bool,
    /// UTC instant when the market next opens (None if open or 24/7).
    pub next_open_at: Option<DateTime<Utc>>,
    /// UTC instant when the current window closes (None if closed or 24/7).
    pub next_close_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holiday_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holiday_type: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("symbol not found")]
    SymbolNotFound,
    #[error("invalid timezone: {0}")]
    InvalidTimezone(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("no session templates configured")]
    NoTemplates,
}

#[derive(Debug, Clone)]
struct ResolvedTemplate {
    id: Uuid,
    name: String,
    timezone: String,
    is_24_7: bool,
}

#[derive(Debug, Clone)]
struct WindowRow {
    day_of_week: i16,
    open_time: NaiveTime,
    close_time: NaiveTime,
}

/// Postgres `EXTRACT(DOW)` convention: 0 = Sunday … 6 = Saturday.
fn pg_dow(w: Weekday) -> i16 {
    match w {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

fn parse_tz(name: &str) -> Result<Tz, SessionError> {
    name.trim()
        .parse::<Tz>()
        .map_err(|_| SessionError::InvalidTimezone(name.to_string()))
}

fn local_from_utc(tz: Tz, at: DateTime<Utc>) -> DateTime<Tz> {
    at.with_timezone(&tz)
}

/// Convert local wall time on `date` to UTC; skips impossible local times (DST gaps).
fn local_naive_to_utc(tz: Tz, date: NaiveDate, time: NaiveTime) -> Option<DateTime<Utc>> {
    let naive = NaiveDateTime::new(date, time);
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
        chrono::LocalResult::Ambiguous(earliest, _) => Some(earliest.with_timezone(&Utc)),
        chrono::LocalResult::None => None,
    }
}

async fn resolve_template_id(pool: &PgPool, symbol_id: Uuid) -> Result<ResolvedTemplate, SessionError> {
    let explicit: Option<(Uuid, String, String, bool)> = sqlx::query_as(
        r#"
        SELECT t.id, t.name, t.timezone, t.is_24_7
        FROM symbols s
        JOIN market_session_templates t ON t.id = s.session_template_id
        WHERE s.id = $1 AND s.session_template_id IS NOT NULL
        "#,
    )
    .bind(symbol_id)
    .fetch_optional(pool)
    .await?;

    if let Some((id, name, timezone, is_24_7)) = explicit {
        return Ok(ResolvedTemplate {
            id,
            name,
            timezone,
            is_24_7,
        });
    }

    let market_default: Option<(Uuid, String, String, bool)> = sqlx::query_as(
        r#"
        SELECT t.id, t.name, t.timezone, t.is_24_7
        FROM symbols s
        JOIN market_session_templates t ON t.is_default_for_market = s.market
        WHERE s.id = $1
        LIMIT 1
        "#,
    )
    .bind(symbol_id)
    .fetch_optional(pool)
    .await?;

    if let Some((id, name, timezone, is_24_7)) = market_default {
        return Ok(ResolvedTemplate {
            id,
            name,
            timezone,
            is_24_7,
        });
    }

    let fallback: Option<(Uuid, String, String, bool)> = sqlx::query_as(
        r#"
        SELECT id, name, timezone, is_24_7
        FROM market_session_templates
        WHERE is_24_7 = true
        ORDER BY
            CASE WHEN is_default_for_market = 'crypto'::market_type THEN 0 ELSE 1 END,
            created_at
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await?;

    match fallback {
        Some((id, name, timezone, is_24_7)) => {
            tracing::warn!(
                symbol_id = %symbol_id,
                template_id = %id,
                template_name = %name,
                "market_sessions: no symbol-specific or market-default template found, \
                 falling back to 24/7 template. This may indicate missing admin configuration."
            );
            Ok(ResolvedTemplate {
                id,
                name,
                timezone,
                is_24_7,
            })
        }
        None => {
            tracing::error!(
                symbol_id = %symbol_id,
                "market_sessions: NO 24/7 template found. Phase 1 seed may have failed."
            );
            Err(SessionError::NoTemplates)
        }
    }
}

async fn load_windows(pool: &PgPool, template_id: Uuid) -> Result<Vec<WindowRow>, SessionError> {
    let rows: Vec<(i16, NaiveTime, NaiveTime)> = sqlx::query_as(
        r#"
        SELECT day_of_week, open_time, close_time
        FROM session_template_windows
        WHERE template_id = $1
        ORDER BY day_of_week, open_time
        "#,
    )
    .bind(template_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(day_of_week, open_time, close_time)| WindowRow {
            day_of_week,
            open_time,
            close_time,
        })
        .collect())
}

/// Full-day closed holidays in `[from, to_inclusive]` (template-local calendar dates).
async fn load_closed_holiday_dates_inclusive(
    pool: &PgPool,
    template_id: Uuid,
    from: NaiveDate,
    to_inclusive: NaiveDate,
) -> Result<HashSet<NaiveDate>, sqlx::Error> {
    let rows: Vec<(NaiveDate,)> = sqlx::query_as(
        r#"
        SELECT holiday_date
        FROM market_holidays
        WHERE template_id = $1
          AND "type" = 'closed'
          AND holiday_date >= $2
          AND holiday_date <= $3
        "#,
    )
    .bind(template_id)
    .bind(from)
    .bind(to_inclusive)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(d,)| d).collect())
}

/// Holiday row for `holiday_date` in template-local calendar, if any.
async fn load_holiday_on_date(
    pool: &PgPool,
    template_id: Uuid,
    holiday_date: NaiveDate,
) -> Result<Option<(String, String, Option<NaiveTime>)>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT name, "type", half_day_close_time
        FROM market_holidays
        WHERE template_id = $1 AND holiday_date = $2
        "#,
    )
    .bind(template_id)
    .bind(holiday_date)
    .fetch_optional(pool)
    .await
}

fn is_within_windows(windows: &[WindowRow], tz: Tz, at: DateTime<Utc>) -> (bool, Option<&WindowRow>) {
    let local = local_from_utc(tz, at);
    let dow = pg_dow(local.weekday());
    let t = local.time();
    for w in windows {
        if w.day_of_week == dow && t >= w.open_time && t <= w.close_time {
            return (true, Some(w));
        }
    }
    (false, None)
}

/// Earliest UTC instant strictly after `at` when a window opens, scanning up to `max_days`,
/// skipping template-local dates that are full `closed` holidays.
fn compute_next_open_utc_with_closed_days(
    windows: &[WindowRow],
    tz: Tz,
    at: DateTime<Utc>,
    max_days: i64,
    closed_holiday_dates: &HashSet<NaiveDate>,
) -> Option<DateTime<Utc>> {
    let local = local_from_utc(tz, at);
    let base_date = local.date_naive();
    let mut best: Option<DateTime<Utc>> = None;

    for day_off in 0..=max_days {
        let check_date = base_date + Duration::days(day_off);
        if closed_holiday_dates.contains(&check_date) {
            continue;
        }
        let dow = pg_dow(check_date.weekday());
        for w in windows {
            if w.day_of_week != dow {
                continue;
            }
            let Some(open_utc) = local_naive_to_utc(tz, check_date, w.open_time) else {
                continue;
            };
            if open_utc > at {
                best = Some(match best {
                    None => open_utc,
                    Some(b) if open_utc < b => open_utc,
                    Some(b) => b,
                });
            }
        }
    }
    best
}

async fn compute_next_open_respecting_closed_holidays(
    pool: &PgPool,
    template_id: Uuid,
    windows: &[WindowRow],
    tz: Tz,
    at: DateTime<Utc>,
    max_days: i64,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    let local = local_from_utc(tz, at);
    let base_date = local.date_naive();
    let end_inclusive = base_date + Duration::days(max_days + 31);
    let closed = load_closed_holiday_dates_inclusive(pool, template_id, base_date, end_inclusive).await?;
    Ok(compute_next_open_utc_with_closed_days(
        windows,
        tz,
        at,
        max_days,
        &closed,
    ))
}

fn compute_next_close_utc(active: &WindowRow, tz: Tz, at: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let local = local_from_utc(tz, at);
    let date = local.date_naive();
    local_naive_to_utc(tz, date, active.close_time).filter(|close| *close > at)
}

/// Public: session status for a symbol at `at_time` (usually `Utc::now()`).
pub async fn get_session_status(
    pool: &PgPool,
    symbol_id: Uuid,
    at_time: DateTime<Utc>,
) -> Result<SessionStatus, SessionError> {
    let tmpl = resolve_template_id(pool, symbol_id).await?;

    if tmpl.is_24_7 {
        return Ok(SessionStatus {
            is_open: true,
            template_id: tmpl.id,
            template_name: tmpl.name,
            timezone: tmpl.timezone.clone(),
            is24_7: true,
            next_open_at: None,
            next_close_at: None,
            holiday_name: None,
            holiday_type: None,
        });
    }

    let windows = load_windows(pool, tmpl.id).await?;
    if windows.is_empty() {
        tracing::warn!(
            template_id = %tmpl.id,
            "market_sessions: template has no windows; treating as closed"
        );
        return Ok(SessionStatus {
            is_open: false,
            template_id: tmpl.id,
            template_name: tmpl.name,
            timezone: tmpl.timezone,
            is24_7: false,
            next_open_at: None,
            next_close_at: None,
            holiday_name: None,
            holiday_type: None,
        });
    }

    let tz = parse_tz(&tmpl.timezone)?;
    let local = local_from_utc(tz, at_time);
    let today_local = local.date_naive();
    let local_time = local.time();

    if let Some((h_name, h_type, h_half_close)) =
        load_holiday_on_date(pool, tmpl.id, today_local).await?
    {
        if h_type == "closed" {
            let next_open_at = compute_next_open_respecting_closed_holidays(
                pool, tmpl.id, &windows, tz, at_time, 400,
            )
            .await?;
            return Ok(SessionStatus {
                is_open: false,
                template_id: tmpl.id,
                template_name: tmpl.name,
                timezone: tmpl.timezone,
                is24_7: false,
                next_open_at,
                next_close_at: None,
                holiday_name: Some(h_name),
                holiday_type: Some(h_type),
            });
        }

        if h_type == "half_day" {
            if let Some(half_close) = h_half_close {
                let dow = pg_dow(local.weekday());
                let today_win = windows.iter().find(|w| w.day_of_week == dow);

                let Some(w) = today_win else {
                    let next_open_at = compute_next_open_respecting_closed_holidays(
                        pool, tmpl.id, &windows, tz, at_time, 400,
                    )
                    .await?;
                    return Ok(SessionStatus {
                        is_open: false,
                        template_id: tmpl.id,
                        template_name: tmpl.name,
                        timezone: tmpl.timezone,
                        is24_7: false,
                        next_open_at,
                        next_close_at: None,
                        holiday_name: Some(h_name),
                        holiday_type: Some("half_day".to_string()),
                    });
                };

                let effective_close = w.close_time.min(half_close);

                if local_time < w.open_time {
                    let next_open_at = local_naive_to_utc(tz, today_local, w.open_time);
                    return Ok(SessionStatus {
                        is_open: false,
                        template_id: tmpl.id,
                        template_name: tmpl.name.clone(),
                        timezone: tmpl.timezone.clone(),
                        is24_7: false,
                        next_open_at,
                        next_close_at: None,
                        holiday_name: Some(h_name),
                        holiday_type: Some("half_day".to_string()),
                    });
                }

                if local_time < effective_close {
                    let next_close_at =
                        local_naive_to_utc(tz, today_local, effective_close).filter(|c| *c > at_time);
                    return Ok(SessionStatus {
                        is_open: true,
                        template_id: tmpl.id,
                        template_name: tmpl.name,
                        timezone: tmpl.timezone,
                        is24_7: false,
                        next_open_at: None,
                        next_close_at,
                        holiday_name: Some(h_name),
                        holiday_type: Some("half_day".to_string()),
                    });
                }

                let next_open_at = compute_next_open_respecting_closed_holidays(
                    pool, tmpl.id, &windows, tz, at_time, 400,
                )
                .await?;
                return Ok(SessionStatus {
                    is_open: false,
                    template_id: tmpl.id,
                    template_name: tmpl.name,
                    timezone: tmpl.timezone,
                    is24_7: false,
                    next_open_at,
                    next_close_at: None,
                    holiday_name: Some(h_name),
                    holiday_type: Some("half_day".to_string()),
                });
            }
        }
    }

    let (is_open, active) = is_within_windows(&windows, tz, at_time);

    let next_close_at = if is_open {
        active.and_then(|w| compute_next_close_utc(w, tz, at_time))
    } else {
        None
    };

    let next_open_at = if !is_open {
        compute_next_open_respecting_closed_holidays(pool, tmpl.id, &windows, tz, at_time, 14).await?
    } else {
        None
    };

    Ok(SessionStatus {
        is_open,
        template_id: tmpl.id,
        template_name: tmpl.name,
        timezone: tmpl.timezone,
        is24_7: false,
        next_open_at,
        next_close_at,
        holiday_name: None,
        holiday_type: None,
    })
}

/// Resolve symbol id from display code (case-insensitive trim).
pub async fn resolve_symbol_id_by_code(pool: &PgPool, code: &str) -> Result<Uuid, SessionError> {
    let id: Option<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM symbols WHERE LOWER(TRIM(code)) = LOWER(TRIM($1)) LIMIT 1"#,
    )
    .bind(code)
    .fetch_optional(pool)
    .await?;

    id.ok_or(SessionError::SymbolNotFound)
}

/// Status for public API; invalid timezone returns synthetic "open" only if we cannot parse TZ (should not happen for seeded rows).
pub async fn get_session_status_for_symbol_code(
    pool: &PgPool,
    symbol_code: &str,
    at_time: DateTime<Utc>,
) -> Result<SessionStatus, SessionError> {
    let sid = resolve_symbol_id_by_code(pool, symbol_code).await?;
    get_session_status(pool, sid, at_time).await
}
