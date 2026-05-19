//! Append-only user activity events for admin User Events History.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use crate::utils::device_from_ua::{
    device_from_user_agent_or_unknown, merge_device_into_meta, DEVICE_UNKNOWN,
};

#[derive(Debug, Clone)]
pub struct RecordUserEventInput {
    pub subject_user_id: Uuid,
    pub actor_user_id: Option<Uuid>,
    pub event_type: &'static str,
    pub category: &'static str,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub meta: JsonValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserEventListItem {
    pub id: Uuid,
    pub subject_user_id: Uuid,
    pub subject_email: String,
    pub subject_name: String,
    pub actor_user_id: Option<Uuid>,
    pub actor_email: Option<String>,
    pub actor_name: Option<String>,
    pub event_type: String,
    pub category: String,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub device_class: String,
    pub device_os: Option<String>,
    pub device_browser: Option<String>,
    pub meta: JsonValue,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListUserEventsResponse {
    pub items: Vec<UserEventListItem>,
    pub cursor: Option<String>,
    pub has_more: bool,
    pub total: i64,
}

#[derive(Debug, Deserialize)]
pub struct ListUserEventsQuery {
    pub user_id: Option<Uuid>,
    pub category: Option<String>,
    pub event_type: Option<String>,
    pub search: Option<String>,
    pub device_class: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

pub struct UserEventsService {
    pool: PgPool,
}

/// Record a user event without failing the caller (shared helper for routes).
pub async fn record_user_event_fail_open(
    pool: &PgPool,
    subject_user_id: Uuid,
    actor_user_id: Option<Uuid>,
    event_type: &'static str,
    category: &'static str,
    ip: Option<String>,
    user_agent: Option<String>,
    meta: JsonValue,
) {
    UserEventsService::new(pool.clone())
        .record_fail_open(RecordUserEventInput {
            subject_user_id,
            actor_user_id,
            event_type,
            category,
            ip,
            user_agent,
            meta,
        })
        .await;
}

impl UserEventsService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Fail-open: never propagate errors to auth/trading callers.
    pub async fn record_fail_open(&self, input: RecordUserEventInput) {
        let subject_user_id = input.subject_user_id;
        let event_type = input.event_type;
        if let Err(e) = self.record(input).await {
            tracing::warn!(
                subject_user_id = %subject_user_id,
                event_type = event_type,
                "user_events insert failed: {}",
                e
            );
        }
    }

    async fn record(&self, input: RecordUserEventInput) -> Result<(), sqlx::Error> {
        let ip = input
            .ip
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let user_agent = input
            .user_agent
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| {
                if s.len() > 512 {
                    s.chars().take(512).collect()
                } else {
                    s.to_string()
                }
            });

        let device = device_from_user_agent_or_unknown(user_agent.as_deref());
        let meta = merge_device_into_meta(input.meta, &device);

        sqlx::query(
            r#"
            INSERT INTO user_events (
                subject_user_id, actor_user_id, event_type, category,
                ip, user_agent, device_class, device_os, device_browser, meta
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            "#,
        )
        .bind(input.subject_user_id)
        .bind(input.actor_user_id)
        .bind(input.event_type)
        .bind(input.category)
        .bind(ip)
        .bind(user_agent)
        .bind(device.class)
        .bind(device.os.as_deref())
        .bind(device.browser.as_deref())
        .bind(meta)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list(
        &self,
        query: ListUserEventsQuery,
        allowed_group_ids: Option<Vec<Uuid>>,
    ) -> Result<ListUserEventsResponse, sqlx::Error> {
        let limit = query.limit.unwrap_or(50).clamp(1, 100);
        let fetch_limit = limit + 1;

        let from = query
            .from
            .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
        let to = query.to;

        let (cursor_created_at, cursor_id) = parse_cursor(query.cursor.as_deref());

        let search_pattern = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| format!("%{}%", s.to_lowercase()));

        let category = query
            .category
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "all");

        let event_type = query
            .event_type
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let device_class = query
            .device_class
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "all");

        let scope_empty = matches!(allowed_group_ids.as_ref(), Some(ids) if ids.is_empty());

        if scope_empty {
            return Ok(ListUserEventsResponse {
                items: vec![],
                cursor: None,
                has_more: false,
                total: 0,
            });
        }

        #[derive(sqlx::FromRow)]
        struct Row {
            id: Uuid,
            subject_user_id: Uuid,
            subject_email: String,
            subject_first: String,
            subject_last: String,
            actor_user_id: Option<Uuid>,
            actor_email: Option<String>,
            actor_first: Option<String>,
            actor_last: Option<String>,
            event_type: String,
            category: String,
            ip: Option<String>,
            user_agent: Option<String>,
            device_class: String,
            device_os: Option<String>,
            device_browser: Option<String>,
            meta: JsonValue,
            created_at: DateTime<Utc>,
        }

        let rows: Vec<Row> = sqlx::query_as(
            r#"
            SELECT
                e.id,
                e.subject_user_id,
                su.email AS subject_email,
                su.first_name AS subject_first,
                su.last_name AS subject_last,
                e.actor_user_id,
                au.email AS actor_email,
                au.first_name AS actor_first,
                au.last_name AS actor_last,
                e.event_type,
                e.category,
                e.ip,
                e.user_agent,
                e.device_class,
                e.device_os,
                e.device_browser,
                e.meta,
                e.created_at
            FROM user_events e
            INNER JOIN users su ON su.id = e.subject_user_id AND su.deleted_at IS NULL
            LEFT JOIN users au ON au.id = e.actor_user_id
            WHERE e.created_at >= $1
              AND ($2::timestamptz IS NULL OR e.created_at <= $2)
              AND ($3::uuid IS NULL OR e.subject_user_id = $3)
              AND ($4::text IS NULL OR e.category = $4)
              AND ($5::text IS NULL OR e.event_type = $5 OR e.event_type LIKE $5 || '.%')
              AND ($6::text IS NULL OR (
                LOWER(su.email) LIKE $6
                OR LOWER(su.first_name || ' ' || su.last_name) LIKE $6
                OR LOWER(e.event_type) LIKE $6
              ))
              AND ($7::uuid[] IS NULL OR su.group_id = ANY($7))
              AND ($8::text IS NULL OR e.device_class = $8)
              AND (
                $9::timestamptz IS NULL
                OR e.created_at < $9
                OR (e.created_at = $9 AND ($10::uuid IS NULL OR e.id < $10))
              )
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT $11
            "#,
        )
        .bind(from)
        .bind(to)
        .bind(query.user_id)
        .bind(category)
        .bind(event_type)
        .bind(search_pattern)
        .bind(allowed_group_ids.as_ref())
        .bind(device_class)
        .bind(cursor_created_at)
        .bind(cursor_id)
        .bind(fetch_limit)
        .fetch_all(&self.pool)
        .await?;

        let has_more = rows.len() as i64 > limit;
        let page_rows: Vec<Row> = rows.into_iter().take(limit as usize).collect();

        let next_cursor = if has_more {
            page_rows.last().map(|r| format!("{}|{}", r.created_at.to_rfc3339(), r.id))
        } else {
            None
        };

        let total: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)::bigint
            FROM user_events e
            INNER JOIN users su ON su.id = e.subject_user_id AND su.deleted_at IS NULL
            WHERE e.created_at >= $1
              AND ($2::timestamptz IS NULL OR e.created_at <= $2)
              AND ($3::uuid IS NULL OR e.subject_user_id = $3)
              AND ($4::text IS NULL OR e.category = $4)
              AND ($5::text IS NULL OR e.event_type = $5 OR e.event_type LIKE $5 || '.%')
              AND ($6::text IS NULL OR (
                LOWER(su.email) LIKE $6
                OR LOWER(su.first_name || ' ' || su.last_name) LIKE $6
                OR LOWER(e.event_type) LIKE $6
              ))
              AND ($7::uuid[] IS NULL OR su.group_id = ANY($7))
              AND ($8::text IS NULL OR e.device_class = $8)
            "#,
        )
        .bind(from)
        .bind(to)
        .bind(query.user_id)
        .bind(category)
        .bind(event_type)
        .bind(
            query
                .search
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| format!("%{}%", s.to_lowercase())),
        )
        .bind(allowed_group_ids.as_ref())
        .bind(device_class)
        .fetch_one(&self.pool)
        .await?;

        let items = page_rows
            .into_iter()
            .map(|r| UserEventListItem {
                id: r.id,
                subject_user_id: r.subject_user_id,
                subject_email: r.subject_email,
                subject_name: format!("{} {}", r.subject_first, r.subject_last),
                actor_user_id: r.actor_user_id,
                actor_email: r.actor_email,
                actor_name: match (r.actor_first, r.actor_last) {
                    (Some(f), Some(l)) => Some(format!("{} {}", f, l)),
                    _ => None,
                },
                event_type: r.event_type,
                category: r.category,
                ip: r.ip,
                user_agent: r.user_agent,
                device_class: if r.device_class.is_empty() {
                    DEVICE_UNKNOWN.to_string()
                } else {
                    r.device_class
                },
                device_os: r.device_os,
                device_browser: r.device_browser,
                meta: r.meta,
                created_at: r.created_at,
            })
            .collect();

        Ok(ListUserEventsResponse {
            items,
            cursor: next_cursor,
            has_more,
            total,
        })
    }
}

fn parse_cursor(cursor: Option<&str>) -> (Option<DateTime<Utc>>, Option<Uuid>) {
    let Some(c) = cursor else {
        return (None, None);
    };
    let mut parts = c.splitn(2, '|');
    let ts = parts.next().and_then(|s| DateTime::parse_from_rfc3339(s).ok());
    let id = parts.next().and_then(|s| Uuid::parse_str(s).ok());
    match (ts, id) {
        (Some(t), Some(uid)) => (Some(t.with_timezone(&Utc)), Some(uid)),
        _ => (None, None),
    }
}

/// Extract client IP and User-Agent from request headers and optional peer address.
pub fn extract_client_meta(
    headers: &axum::http::HeaderMap,
    peer_addr: Option<std::net::SocketAddr>,
) -> (Option<String>, Option<String>) {
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());
    let ip = crate::utils::client_ip::extract_client_ip(headers, peer_addr);
    (ip, user_agent)
}

#[cfg(test)]
mod tests {
    use super::parse_cursor;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn parse_cursor_valid_roundtrip() {
        let uid = Uuid::new_v4();
        let ts = Utc::now();
        let cursor = format!("{}|{}", ts.to_rfc3339(), uid);
        let (parsed_ts, parsed_id) = parse_cursor(Some(&cursor));
        assert!(parsed_ts.is_some());
        assert_eq!(parsed_id, Some(uid));
    }

    #[test]
    fn parse_cursor_invalid_returns_none() {
        assert_eq!(parse_cursor(None), (None, None));
        assert_eq!(parse_cursor(Some("not-a-cursor")), (None, None));
    }
}
