//! Admin call records API: list call history (initiated, answered, rejected, ended, timeout).

use axum::{
    extract::{Query, State, Extension},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;

fn check_admin(claims: &Claims) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Admin access required" })),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Default)]
pub struct ListCallRecordsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub admin_user_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub status: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallRecordRow {
    pub id: String,
    pub call_id: String,
    pub admin_user_id: String,
    pub admin_email: Option<String>,
    pub admin_display_name: Option<String>,
    pub user_id: String,
    pub user_email: Option<String>,
    pub user_display_name: Option<String>,
    pub status: String,
    pub initiated_at: String,
    pub answered_at: Option<String>,
    pub ended_at: Option<String>,
    pub duration_seconds: Option<i32>,
    pub ended_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ListCallRecordsResponse {
    pub records: Vec<CallRecordRow>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

async fn list_call_records(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<ListCallRecordsQuery>,
) -> Result<Json<ListCallRecordsResponse>, (StatusCode, Json<serde_json::Value>)> {
    check_admin(&claims)?;

    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let offset = q.offset.unwrap_or(0).max(0);

    // Optional date bounds for SQL
    let from_ts: Option<DateTime<Utc>> = q
        .from_date
        .as_deref()
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0).unwrap()));
    let to_ts: Option<DateTime<Utc>> = q
        .to_date
        .as_deref()
        .and_then(|s| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .map(|d| Utc.from_utc_datetime(&d.and_hms_opt(23, 59, 59).unwrap()));

    // List with optional filters
    let rows = sqlx::query_as::<_, (
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        String,
        DateTime<Utc>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<i32>,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
        DateTime<Utc>,
        Option<String>,
        Option<String>,
        Option<String>,
    )>(
        r#"
        SELECT r.id, r.call_id, r.admin_user_id, r.user_id, r.status,
               r.initiated_at, r.answered_at, r.ended_at, r.duration_seconds, r.ended_by,
               r.admin_display_name, r.created_at, r.updated_at,
               a.email AS admin_email, u.email AS user_email,
               COALESCE(TRIM(u.first_name || ' ' || u.last_name), u.email) AS user_display_name
        FROM admin_call_records r
        LEFT JOIN users a ON a.id = r.admin_user_id
        LEFT JOIN users u ON u.id = r.user_id
        WHERE ($1::uuid IS NULL OR r.admin_user_id = $1)
          AND ($2::uuid IS NULL OR r.user_id = $2)
          AND ($3::text IS NULL OR r.status = $3)
          AND ($4::timestamptz IS NULL OR r.initiated_at >= $4)
          AND ($5::timestamptz IS NULL OR r.initiated_at <= $5)
        ORDER BY r.initiated_at DESC
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(q.admin_user_id)
    .bind(q.user_id)
    .bind(q.status.as_deref())
    .bind(from_ts)
    .bind(to_ts)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    let total_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM admin_call_records r
        WHERE ($1::uuid IS NULL OR r.admin_user_id = $1)
          AND ($2::uuid IS NULL OR r.user_id = $2)
          AND ($3::text IS NULL OR r.status = $3)
          AND ($4::timestamptz IS NULL OR r.initiated_at >= $4)
          AND ($5::timestamptz IS NULL OR r.initiated_at <= $5)
        "#,
    )
    .bind(q.admin_user_id)
    .bind(q.user_id)
    .bind(q.status.as_deref())
    .bind(from_ts)
    .bind(to_ts)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    let records: Vec<CallRecordRow> = rows
        .into_iter()
        .map(
            |(
                id,
                call_id,
                admin_user_id,
                user_id,
                status,
                initiated_at,
                answered_at,
                ended_at,
                duration_seconds,
                ended_by,
                admin_display_name,
                created_at,
                updated_at,
                admin_email,
                user_email,
                user_display_name,
            )| CallRecordRow {
                id: id.to_string(),
                call_id: call_id.to_string(),
                admin_user_id: admin_user_id.to_string(),
                admin_email,
                admin_display_name,
                user_id: user_id.to_string(),
                user_email,
                user_display_name,
                status,
                initiated_at: initiated_at.to_rfc3339(),
                answered_at: answered_at.map(|t| t.to_rfc3339()),
                ended_at: ended_at.map(|t| t.to_rfc3339()),
                duration_seconds,
                ended_by,
                created_at: created_at.to_rfc3339(),
                updated_at: updated_at.to_rfc3339(),
            },
        )
        .collect();

    Ok(Json(ListCallRecordsResponse {
        records,
        total: total_count.0,
        limit,
        offset,
    }))
}

pub fn create_admin_call_records_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_call_records))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
