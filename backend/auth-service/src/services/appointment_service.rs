//! Appointment service: list, get, stats, search users, create, update, delete, reschedule, cancel, complete, send_reminder.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

const MAX_LIST_LIMIT: i64 = 200;
const DEFAULT_LIST_LIMIT: i64 = 20;
const SEARCH_USERS_LIMIT: i64 = 20;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "snake_case")]
pub struct AppointmentRow {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub admin_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub scheduled_at: DateTime<Utc>,
    pub duration_minutes: i32,
    pub status: String,
    #[serde(rename = "type")]
    pub appointment_type: String,
    pub meeting_link: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub rescheduled_at: Option<DateTime<Utc>>,
    pub cancelled_reason: Option<String>,
    pub completion_notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub admin_email: Option<String>,
    pub lead_id: Option<Uuid>,
    pub lead_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "snake_case")]
pub struct AppointmentStatsRow {
    pub total_appointments: i64,
    pub scheduled_appointments: i64,
    pub confirmed_appointments: i64,
    pub completed_appointments: i64,
    pub cancelled_appointments: i64,
    pub rescheduled_appointments: i64,
    pub today_appointments: i64,
    pub upcoming_7_days: i64,
    pub overdue_appointments: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "snake_case")]
pub struct UserSearchRow {
    pub id: Uuid,
    pub email: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub full_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ListAppointmentsParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search: Option<String>,
    pub status: Option<String>,
    pub r#type: Option<String>,
    pub user_id: Option<Uuid>,
    pub admin_id: Option<Uuid>,
    pub lead_id: Option<Uuid>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateAppointmentPayload {
    pub user_id: Option<Uuid>,
    pub lead_id: Option<Uuid>,
    pub title: String,
    pub description: Option<String>,
    pub scheduled_at: String,
    pub duration_minutes: i32,
    pub r#type: Option<String>,
    pub meeting_link: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, serde::Deserialize, Default)]
pub struct UpdateAppointmentPayload {
    pub title: Option<String>,
    pub description: Option<String>,
    pub scheduled_at: Option<String>,
    pub duration_minutes: Option<i32>,
    pub status: Option<String>,
    pub r#type: Option<String>,
    pub meeting_link: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct ReschedulePayload {
    pub scheduled_at: String,
    pub reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct CancelPayload {
    pub reason: String,
    pub additional_details: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct CompletePayload {
    pub completion_notes: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SendReminderPayload {
    pub reminder_type: Option<String>,
    pub subject: Option<String>,
    pub message: Option<String>,
}

pub fn clamp_limit(limit: Option<i64>) -> i64 {
    match limit {
        None => DEFAULT_LIST_LIMIT,
        Some(l) if l <= 0 => DEFAULT_LIST_LIMIT,
        Some(l) if l > MAX_LIST_LIMIT => MAX_LIST_LIMIT,
        Some(l) => l,
    }
}

pub fn clamp_offset(offset: Option<i64>) -> i64 {
    offset.unwrap_or(0).max(0)
}

/// List appointments for a user (scoped by user_id).
pub async fn list_for_user(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    params: &ListAppointmentsParams,
) -> Result<(Vec<AppointmentRow>, i64), sqlx::Error> {
    let limit = clamp_limit(params.limit);
    let offset = clamp_offset(params.offset);

    let mut q_str = r#"
        SELECT a.id, a.user_id, a.admin_id, a.title, a.description, a.scheduled_at, a.duration_minutes,
               a.status, a.type AS appointment_type, a.meeting_link, a.location, a.notes,
               a.cancelled_at, a.completed_at, a.rescheduled_at, a.cancelled_reason, a.completion_notes,
               a.created_at, a.updated_at,
               u.email AS user_email,
               CONCAT(u.first_name, ' ', u.last_name) AS user_name,
               adm.email AS admin_email,
               a.lead_id,
               l.name AS lead_name
        FROM appointments a
        LEFT JOIN users u ON u.id = a.user_id
        JOIN users adm ON adm.id = a.admin_id
        LEFT JOIN leads l ON l.id = a.lead_id
        WHERE a.user_id = $1
    "#
    .to_string();
    let mut bind_pos: u32 = 2;
    if params.status.as_deref().is_some_and(|s| !s.is_empty()) {
        q_str.push_str(&format!(" AND a.status = ${}", bind_pos));
        bind_pos += 1;
    }
    if params.r#type.as_deref().is_some_and(|t| !t.is_empty()) {
        q_str.push_str(&format!(" AND a.type = ${}", bind_pos));
        bind_pos += 1;
    }
    if params.start_date.as_deref().is_some_and(|s| !s.is_empty()) {
        q_str.push_str(&format!(" AND a.scheduled_at >= ${}::timestamptz", bind_pos));
        bind_pos += 1;
    }
    if params.end_date.as_deref().is_some_and(|s| !s.is_empty()) {
        q_str.push_str(&format!(" AND a.scheduled_at <= ${}::timestamptz", bind_pos));
        bind_pos += 1;
    }
    q_str.push_str(" ORDER BY a.scheduled_at DESC");
    q_str.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut count_str = r#"SELECT COUNT(*) FROM appointments a WHERE a.user_id = $1"#.to_string();
    let mut cpos: u32 = 2;
    if params.status.as_deref().is_some_and(|s| !s.is_empty()) {
        count_str.push_str(&format!(" AND a.status = ${}", cpos));
        cpos += 1;
    }
    if params.r#type.as_deref().is_some_and(|t| !t.is_empty()) {
        count_str.push_str(&format!(" AND a.type = ${}", cpos));
        cpos += 1;
    }
    if params.start_date.as_deref().is_some_and(|s| !s.is_empty()) {
        count_str.push_str(&format!(" AND a.scheduled_at >= ${}::timestamptz", cpos));
        cpos += 1;
    }
    if params.end_date.as_deref().is_some_and(|s| !s.is_empty()) {
        count_str.push_str(&format!(" AND a.scheduled_at <= ${}::timestamptz", cpos));
    }
    let mut count_q = sqlx::query_scalar::<_, i64>(&count_str).bind(user_id);
    if let Some(s) = &params.status {
        if !s.is_empty() {
            count_q = count_q.bind(s);
        }
    }
    if let Some(t) = &params.r#type {
        if !t.is_empty() {
            count_q = count_q.bind(t);
        }
    }
    if let Some(s) = &params.start_date {
        if !s.is_empty() {
            count_q = count_q.bind(s);
        }
    }
    if let Some(e) = &params.end_date {
        if !e.is_empty() {
            count_q = count_q.bind(e);
        }
    }
    let total: i64 = count_q.fetch_one(pool).await?;

    let mut q = sqlx::query_as::<_, AppointmentRow>(&q_str).bind(user_id);
    if let Some(s) = &params.status {
        if !s.is_empty() {
            q = q.bind(s);
        }
    }
    if let Some(t) = &params.r#type {
        if !t.is_empty() {
            q = q.bind(t);
        }
    }
    if let Some(s) = &params.start_date {
        if !s.is_empty() {
            q = q.bind(s);
        }
    }
    if let Some(e) = &params.end_date {
        if !e.is_empty() {
            q = q.bind(e);
        }
    }
    let rows = q.fetch_all(pool).await?;
    Ok((rows, total))
}

/// Admin list with optional search, filters, pagination.
/// allowed_user_ids: scope for user appointments (None = all users for super_admin).
/// allowed_lead_ids: scope for lead appointments (None = all leads for super_admin).
/// Show appointments where (user_id IN allowed_user_ids) OR (lead_id IN allowed_lead_ids). When both are Some(empty), returns (vec![], 0).
pub async fn list_admin(
    pool: &sqlx::PgPool,
    params: &ListAppointmentsParams,
    allowed_user_ids: Option<&[Uuid]>,
    allowed_lead_ids: Option<&[Uuid]>,
) -> Result<(Vec<AppointmentRow>, i64), sqlx::Error> {
    let user_scope_empty = allowed_user_ids.map(|v| v.is_empty()).unwrap_or(false);
    let lead_scope_empty = allowed_lead_ids.map(|v| v.is_empty()).unwrap_or(false);
    if user_scope_empty && lead_scope_empty {
        return Ok((vec![], 0));
    }

    let limit = clamp_limit(params.limit);
    let offset = clamp_offset(params.offset);

    let mut q_str = r#"
        SELECT a.id, a.user_id, a.admin_id, a.title, a.description, a.scheduled_at, a.duration_minutes,
               a.status, a.type AS appointment_type, a.meeting_link, a.location, a.notes,
               a.cancelled_at, a.completed_at, a.rescheduled_at, a.cancelled_reason, a.completion_notes,
               a.created_at, a.updated_at,
               u.email AS user_email,
               CONCAT(u.first_name, ' ', u.last_name) AS user_name,
               adm.email AS admin_email,
               a.lead_id,
               l.name AS lead_name
        FROM appointments a
        LEFT JOIN users u ON u.id = a.user_id
        JOIN users adm ON adm.id = a.admin_id
        LEFT JOIN leads l ON l.id = a.lead_id
        WHERE 1=1
    "#
    .to_string();
    let mut bind_pos: u32 = 1;
    // Scope: super_admin has (None, None) = no filter. Admin has (Some(user_ids), Some(lead_ids)) = (user_id IN user_ids OR lead_id IN lead_ids).
    if let (Some(uid), Some(lid)) = (allowed_user_ids, allowed_lead_ids) {
        q_str.push_str(&format!(" AND (a.user_id = ANY(${}) OR a.lead_id = ANY(${}))", bind_pos, bind_pos + 1));
        bind_pos += 2;
    }
    if params.search.as_deref().is_some_and(|s| !s.is_empty()) {
        let pattern = format!("%{}%", params.search.as_ref().unwrap().to_lowercase());
        q_str.push_str(&format!(
            " AND (LOWER(a.title) LIKE ${} OR LOWER(COALESCE(u.email,'')) LIKE ${} OR LOWER(COALESCE(CONCAT(u.first_name, ' ', u.last_name),'')) LIKE ${} OR LOWER(COALESCE(l.name,'')) LIKE ${})",
            bind_pos, bind_pos + 1, bind_pos + 2, bind_pos + 3
        ));
        bind_pos += 4;
    }
    if params.status.as_deref().is_some_and(|s| !s.is_empty()) {
        q_str.push_str(&format!(" AND a.status = ${}", bind_pos));
        bind_pos += 1;
    }
    if params.r#type.as_deref().is_some_and(|t| !t.is_empty()) {
        q_str.push_str(&format!(" AND a.type = ${}", bind_pos));
        bind_pos += 1;
    }
    if params.user_id.is_some() {
        q_str.push_str(&format!(" AND a.user_id = ${}", bind_pos));
        bind_pos += 1;
    }
    if params.lead_id.is_some() {
        q_str.push_str(&format!(" AND a.lead_id = ${}", bind_pos));
        bind_pos += 1;
    }
    if params.admin_id.is_some() {
        q_str.push_str(&format!(" AND a.admin_id = ${}", bind_pos));
        bind_pos += 1;
    }
    if params.start_date.as_deref().is_some_and(|s| !s.is_empty()) {
        q_str.push_str(&format!(" AND a.scheduled_at >= ${}::timestamptz", bind_pos));
        bind_pos += 1;
    }
    if params.end_date.as_deref().is_some_and(|s| !s.is_empty()) {
        q_str.push_str(&format!(" AND a.scheduled_at <= ${}::timestamptz", bind_pos));
        bind_pos += 1;
    }
    q_str.push_str(" ORDER BY a.scheduled_at DESC");
    q_str.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut count_sql = "SELECT COUNT(*) FROM appointments a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN leads l ON l.id = a.lead_id WHERE 1=1".to_string();
    let mut cpos = 1u32;
    if let (Some(_), Some(_)) = (allowed_user_ids, allowed_lead_ids) {
        count_sql.push_str(&format!(" AND (a.user_id = ANY(${}) OR a.lead_id = ANY(${}))", cpos, cpos + 1));
        cpos += 2;
    }
    if params.search.as_deref().is_some_and(|s| !s.is_empty()) {
        count_sql.push_str(&format!(
            " AND (LOWER(a.title) LIKE ${} OR LOWER(COALESCE(u.email,'')) LIKE ${} OR LOWER(COALESCE(CONCAT(u.first_name, ' ', u.last_name),'')) LIKE ${} OR LOWER(COALESCE(l.name,'')) LIKE ${})",
            cpos, cpos + 1, cpos + 2, cpos + 3
        ));
        cpos += 4;
    }
    if params.status.as_deref().is_some_and(|s| !s.is_empty()) {
        count_sql.push_str(&format!(" AND a.status = ${}", cpos));
        cpos += 1;
    }
    if params.r#type.as_deref().is_some_and(|t| !t.is_empty()) {
        count_sql.push_str(&format!(" AND a.type = ${}", cpos));
        cpos += 1;
    }
    if params.user_id.is_some() {
        count_sql.push_str(&format!(" AND a.user_id = ${}", cpos));
        cpos += 1;
    }
    if params.lead_id.is_some() {
        count_sql.push_str(&format!(" AND a.lead_id = ${}", cpos));
        cpos += 1;
    }
    if params.admin_id.is_some() {
        count_sql.push_str(&format!(" AND a.admin_id = ${}", cpos));
        cpos += 1;
    }
    if params.start_date.as_deref().is_some_and(|s| !s.is_empty()) {
        count_sql.push_str(&format!(" AND a.scheduled_at >= ${}::timestamptz", cpos));
        cpos += 1;
    }
    if params.end_date.as_deref().is_some_and(|s| !s.is_empty()) {
        count_sql.push_str(&format!(" AND a.scheduled_at <= ${}::timestamptz", cpos));
    }
    let mut count_q = sqlx::query_scalar::<_, i64>(&count_sql);
    if let (Some(uid), Some(lid)) = (allowed_user_ids, allowed_lead_ids) {
        count_q = count_q.bind(uid).bind(lid);
    }
    if let Some(s) = &params.search {
        if !s.is_empty() {
            let p = format!("%{}%", s.to_lowercase());
            count_q = count_q.bind(p.clone()).bind(p.clone()).bind(p.clone()).bind(p);
        }
    }
    if let Some(st) = &params.status {
        if !st.is_empty() {
            count_q = count_q.bind(st);
        }
    }
    if let Some(t) = &params.r#type {
        if !t.is_empty() {
            count_q = count_q.bind(t);
        }
    }
    if let Some(uid) = &params.user_id {
        count_q = count_q.bind(uid);
    }
    if let Some(lid) = &params.lead_id {
        count_q = count_q.bind(lid);
    }
    if let Some(aid) = &params.admin_id {
        count_q = count_q.bind(aid);
    }
    if let Some(sd) = &params.start_date {
        if !sd.is_empty() {
            count_q = count_q.bind(sd);
        }
    }
    if let Some(ed) = &params.end_date {
        if !ed.is_empty() {
            count_q = count_q.bind(ed);
        }
    }
    let total: i64 = count_q.fetch_one(pool).await?;

    let mut q = sqlx::query_as::<_, AppointmentRow>(&q_str);
    if let (Some(uid), Some(lid)) = (allowed_user_ids, allowed_lead_ids) {
        q = q.bind(uid).bind(lid);
    }
    if let Some(s) = &params.search {
        if !s.is_empty() {
            let p = format!("%{}%", s.to_lowercase());
            q = q.bind(p.clone()).bind(p.clone()).bind(p.clone()).bind(p);
        }
    }
    if let Some(st) = &params.status {
        if !st.is_empty() {
            q = q.bind(st);
        }
    }
    if let Some(t) = &params.r#type {
        if !t.is_empty() {
            q = q.bind(t);
        }
    }
    if let Some(uid) = &params.user_id {
        q = q.bind(uid);
    }
    if let Some(lid) = &params.lead_id {
        q = q.bind(lid);
    }
    if let Some(aid) = &params.admin_id {
        q = q.bind(aid);
    }
    if let Some(sd) = &params.start_date {
        if !sd.is_empty() {
            q = q.bind(sd);
        }
    }
    if let Some(ed) = &params.end_date {
        if !ed.is_empty() {
            q = q.bind(ed);
        }
    }
    let rows = q.fetch_all(pool).await?;
    Ok((rows, total))
}

/// Get one appointment by id with joins (for admin or for response).
pub async fn get_by_id(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<AppointmentRow>, sqlx::Error> {
    let row = sqlx::query_as::<_, AppointmentRow>(r#"
        SELECT a.id, a.user_id, a.admin_id, a.title, a.description, a.scheduled_at, a.duration_minutes,
               a.status, a.type AS appointment_type, a.meeting_link, a.location, a.notes,
               a.cancelled_at, a.completed_at, a.rescheduled_at, a.cancelled_reason, a.completion_notes,
               a.created_at, a.updated_at,
               u.email AS user_email,
               CONCAT(u.first_name, ' ', u.last_name) AS user_name,
               adm.email AS admin_email,
               a.lead_id,
               l.name AS lead_name
        FROM appointments a
        LEFT JOIN users u ON u.id = a.user_id
        JOIN users adm ON adm.id = a.admin_id
        LEFT JOIN leads l ON l.id = a.lead_id
        WHERE a.id = $1
    "#)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

/// Single aggregated query for admin stats.
/// When (allowed_user_ids, allowed_lead_ids) is (Some(empty), Some(empty)), returns zeroed stats.
/// When both Some(non-empty), counts appointments where user_id IN uid OR lead_id IN lid. When (None, None), all.
pub async fn get_stats(
    pool: &sqlx::PgPool,
    allowed_user_ids: Option<&[Uuid]>,
    allowed_lead_ids: Option<&[Uuid]>,
) -> Result<AppointmentStatsRow, sqlx::Error> {
    let now = Utc::now();
    let today_start = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
    let today_end = today_start + chrono::Duration::days(1);
    let week_end = today_end + chrono::Duration::days(7);

    if let (Some(uid), Some(lid)) = (allowed_user_ids, allowed_lead_ids) {
        if uid.is_empty() && lid.is_empty() {
            return Ok(AppointmentStatsRow {
                total_appointments: 0,
                scheduled_appointments: 0,
                confirmed_appointments: 0,
                completed_appointments: 0,
                cancelled_appointments: 0,
                rescheduled_appointments: 0,
                today_appointments: 0,
                upcoming_7_days: 0,
                overdue_appointments: 0,
            });
        }
    }

    let row = if let (Some(uid), Some(lid)) = (allowed_user_ids, allowed_lead_ids) {
        sqlx::query_as::<_, AppointmentStatsRow>(r#"
            SELECT
                COUNT(*)::bigint AS total_appointments,
                COUNT(*) FILTER (WHERE status = 'scheduled')::bigint AS scheduled_appointments,
                COUNT(*) FILTER (WHERE status = 'confirmed')::bigint AS confirmed_appointments,
                COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed_appointments,
                COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled_appointments,
                COUNT(*) FILTER (WHERE status = 'rescheduled')::bigint AS rescheduled_appointments,
                COUNT(*) FILTER (WHERE scheduled_at >= $1 AND scheduled_at < $2)::bigint AS today_appointments,
                COUNT(*) FILTER (WHERE scheduled_at >= $2 AND scheduled_at < $3)::bigint AS upcoming_7_days,
                COUNT(*) FILTER (WHERE scheduled_at < $1 AND status NOT IN ('completed','cancelled'))::bigint AS overdue_appointments
            FROM appointments
            WHERE user_id = ANY($4) OR lead_id = ANY($5)
        "#)
            .bind(today_start)
            .bind(today_end)
            .bind(week_end)
            .bind(uid)
            .bind(lid)
            .fetch_one(pool)
            .await?
    } else {
        sqlx::query_as::<_, AppointmentStatsRow>(r#"
            SELECT
                COUNT(*)::bigint AS total_appointments,
                COUNT(*) FILTER (WHERE status = 'scheduled')::bigint AS scheduled_appointments,
                COUNT(*) FILTER (WHERE status = 'confirmed')::bigint AS confirmed_appointments,
                COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed_appointments,
                COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS cancelled_appointments,
                COUNT(*) FILTER (WHERE status = 'rescheduled')::bigint AS rescheduled_appointments,
                COUNT(*) FILTER (WHERE scheduled_at >= $1 AND scheduled_at < $2)::bigint AS today_appointments,
                COUNT(*) FILTER (WHERE scheduled_at >= $2 AND scheduled_at < $3)::bigint AS upcoming_7_days,
                COUNT(*) FILTER (WHERE scheduled_at < $1 AND status NOT IN ('completed','cancelled'))::bigint AS overdue_appointments
            FROM appointments
        "#)
            .bind(today_start)
            .bind(today_end)
            .bind(week_end)
            .fetch_one(pool)
            .await?
    };
    Ok(row)
}

/// Search users by email/name for admin create-appointment typeahead.
/// When allowed_user_ids is Some(empty), returns []. When Some(ids), only returns users in that set.
pub async fn search_users(
    pool: &sqlx::PgPool,
    q: &str,
    limit: Option<i64>,
    allowed_user_ids: Option<&[Uuid]>,
) -> Result<Vec<UserSearchRow>, sqlx::Error> {
    if let Some(ids) = allowed_user_ids {
        if ids.is_empty() {
            return Ok(vec![]);
        }
    }
    let limit = limit.unwrap_or(SEARCH_USERS_LIMIT).min(SEARCH_USERS_LIMIT).max(1);
    let pattern = format!("%{}%", q.to_lowercase());
    let rows = if let Some(ids) = allowed_user_ids {
        sqlx::query_as::<_, UserSearchRow>(r#"
            SELECT id, email, first_name, last_name,
                   TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) AS full_name
            FROM users
            WHERE (LOWER(email) LIKE $1 OR LOWER(COALESCE(first_name,'')) LIKE $2 OR LOWER(COALESCE(last_name,'')) LIKE $2)
              AND id = ANY($4)
            ORDER BY email
            LIMIT $3
        "#)
            .bind(&pattern)
            .bind(&pattern)
            .bind(limit)
            .bind(ids)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query_as::<_, UserSearchRow>(r#"
            SELECT id, email, first_name, last_name,
                   TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) AS full_name
            FROM users
            WHERE LOWER(email) LIKE $1 OR LOWER(COALESCE(first_name,'')) LIKE $2 OR LOWER(COALESCE(last_name,'')) LIKE $2
            ORDER BY email
            LIMIT $3
        "#)
            .bind(&pattern)
            .bind(&pattern)
            .bind(limit)
            .fetch_all(pool)
            .await?
    };
    Ok(rows)
}

/// Create appointment; returns created row with joins. At least one of user_id or lead_id must be set.
pub async fn create(
    pool: &sqlx::PgPool,
    admin_id: Uuid,
    payload: &CreateAppointmentPayload,
) -> Result<AppointmentRow, sqlx::Error> {
    let appointment_type = payload.r#type.as_deref().unwrap_or("consultation");
    let status = "scheduled";
    let id = Uuid::new_v4();
    sqlx::query(r#"
        INSERT INTO appointments (id, user_id, lead_id, admin_id, title, description, scheduled_at, duration_minutes, status, type, meeting_link, location, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, $12, $13, NOW(), NOW())
    "#)
        .bind(id)
        .bind(payload.user_id)
        .bind(payload.lead_id)
        .bind(admin_id)
        .bind(&payload.title)
        .bind(&payload.description)
        .bind(&payload.scheduled_at)
        .bind(payload.duration_minutes)
        .bind(status)
        .bind(appointment_type)
        .bind(&payload.meeting_link)
        .bind(&payload.location)
        .bind(&payload.notes)
        .execute(pool)
        .await?;
    let row = get_by_id(pool, id).await?.ok_or_else(|| sqlx::Error::RowNotFound)?;
    Ok(row)
}

/// Update appointment; returns updated row with joins. Only updates fields that are Some.
pub async fn update(
    pool: &sqlx::PgPool,
    id: Uuid,
    payload: &UpdateAppointmentPayload,
) -> Result<Option<AppointmentRow>, sqlx::Error> {
    let existing = get_by_id(pool, id).await?;
    let Some(ref row) = existing else {
        return Ok(None);
    };
    let title = payload.title.as_deref().unwrap_or(&row.title);
    let description = payload.description.as_ref().or(row.description.as_ref());
    let meeting_link = payload.meeting_link.as_ref().or(row.meeting_link.as_ref());
    let location = payload.location.as_ref().or(row.location.as_ref());
    let notes = payload.notes.as_ref().or(row.notes.as_ref());
    let duration_minutes = payload.duration_minutes.unwrap_or(row.duration_minutes);
    let typ = payload.r#type.as_deref().unwrap_or(&row.appointment_type);
    let status = payload.status.as_deref().unwrap_or(&row.status);
    let default_scheduled = row.scheduled_at.to_rfc3339();
    let scheduled_at = payload
        .scheduled_at
        .as_deref()
        .unwrap_or(&default_scheduled);

    sqlx::query(r#"
        UPDATE appointments SET title = $1, description = $2, meeting_link = $3, location = $4, notes = $5, duration_minutes = $6, type = $7, status = $8, scheduled_at = $9::timestamptz, updated_at = NOW() WHERE id = $10
    "#)
        .bind(title)
        .bind(description)
        .bind(meeting_link)
        .bind(location)
        .bind(notes)
        .bind(duration_minutes)
        .bind(typ)
        .bind(status)
        .bind(scheduled_at)
        .bind(id)
        .execute(pool)
        .await?;
    get_by_id(pool, id).await
}

/// Hard delete.
pub async fn delete_by_id(pool: &sqlx::PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM appointments WHERE id = $1").bind(id).execute(pool).await?;
    Ok(r.rows_affected() > 0)
}

/// Reschedule: set scheduled_at, rescheduled_at, status = 'rescheduled'.
pub async fn reschedule(
    pool: &sqlx::PgPool,
    id: Uuid,
    payload: &ReschedulePayload,
) -> Result<Option<AppointmentRow>, sqlx::Error> {
    let r = sqlx::query(r#"
        UPDATE appointments SET scheduled_at = $1::timestamptz, rescheduled_at = NOW(), status = 'rescheduled', updated_at = NOW() WHERE id = $2
    "#)
        .bind(&payload.scheduled_at)
        .bind(id)
        .execute(pool)
        .await?;
    if r.rows_affected() == 0 {
        return Ok(None);
    }
    get_by_id(pool, id).await
}

/// Cancel: set status = 'cancelled', cancelled_at, cancelled_reason.
pub async fn cancel(
    pool: &sqlx::PgPool,
    id: Uuid,
    payload: &CancelPayload,
) -> Result<Option<AppointmentRow>, sqlx::Error> {
    let r = sqlx::query(r#"
        UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancelled_reason = $1, updated_at = NOW() WHERE id = $2
    "#)
        .bind(&payload.reason)
        .bind(id)
        .execute(pool)
        .await?;
    if r.rows_affected() == 0 {
        return Ok(None);
    }
    get_by_id(pool, id).await
}

/// Complete: set status = 'completed', completed_at, completion_notes.
pub async fn complete(
    pool: &sqlx::PgPool,
    id: Uuid,
    payload: &CompletePayload,
) -> Result<Option<AppointmentRow>, sqlx::Error> {
    let notes = payload.completion_notes.as_deref().unwrap_or("");
    let r = sqlx::query(r#"
        UPDATE appointments SET status = 'completed', completed_at = NOW(), completion_notes = $1, updated_at = NOW() WHERE id = $2
    "#)
        .bind(notes)
        .bind(id)
        .execute(pool)
        .await?;
    if r.rows_affected() == 0 {
        return Ok(None);
    }
    get_by_id(pool, id).await
}

/// Send reminder: for now just log and return Ok (no email integration yet).
pub async fn send_reminder(
    _pool: &sqlx::PgPool,
    _id: Uuid,
    payload: &SendReminderPayload,
) -> Result<(), sqlx::Error> {
    tracing::info!(
        "Appointment reminder: type={:?} subject={:?}",
        payload.reminder_type,
        payload.subject
    );
    Ok(())
}
