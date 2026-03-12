//! Admin appointments API: list, stats, search users, get, create, update, delete, reschedule, cancel, complete, send reminder.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use serde::{Deserialize, Deserializer};
use sqlx::PgPool;
use uuid::Uuid;

/// Deserialize optional UUID from query; treat missing or empty string as None to avoid 422.
fn option_uuid_from_query<'de, D>(deserializer: D) -> Result<Option<Uuid>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt: Option<String> = Option::deserialize(deserializer)?;
    match opt.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(s) => Uuid::parse_str(s).map(Some).map_err(serde::de::Error::custom),
    }
}

/// Deserialize optional i64 from query; treat missing, empty or invalid string as None.
fn option_i64_from_query<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt: Option<String> = Option::deserialize(deserializer)?;
    match opt.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(s) => s.parse::<i64>().map(Some).map_err(serde::de::Error::custom),
    }
}

use tracing::error;
use crate::middleware::auth_middleware;
use crate::routes::scoped_access;
use crate::services::appointment_service::{
    self, CancelPayload, CompletePayload, CreateAppointmentPayload, ListAppointmentsParams,
    ReschedulePayload, SendReminderPayload, UpdateAppointmentPayload,
};
use crate::utils::jwt::Claims;

/// Returns true if the caller can access this appointment (by user scope or lead scope).
fn can_access_appointment(
    row: &appointment_service::AppointmentRow,
    allowed_user_ids: Option<&[Uuid]>,
    allowed_lead_ids: Option<&[Uuid]>,
) -> bool {
    if let Some(ref lead_id) = row.lead_id {
        if allowed_lead_ids.is_none() {
            return true;
        }
        if allowed_lead_ids.unwrap().contains(lead_id) {
            return true;
        }
    }
    if let Some(ref user_id) = row.user_id {
        if allowed_user_ids.is_none() {
            return true;
        }
        if allowed_user_ids.unwrap().contains(user_id) {
            return true;
        }
    }
    false
}

/// Allow if role is admin/super_admin or user has the given permission from their permission profile.
async fn check_appointments_permission(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            error!("Failed to get permission profile for appointments check: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
            )
        })?;
    let Some(pid) = profile_id else {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "No permission profile assigned" } })),
        ));
    };
    let has: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM permission_profile_grants WHERE profile_id = $1 AND permission_key = $2)",
    )
    .bind(pid)
    .bind(permission)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        error!("Failed to check appointments permission: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
        )
    })?;
    if !has {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": format!("Missing permission: {}", permission) } })),
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize, Default)]
pub struct ListQuery {
    #[serde(default, deserialize_with = "option_i64_from_query")]
    pub limit: Option<i64>,
    #[serde(default, deserialize_with = "option_i64_from_query")]
    pub offset: Option<i64>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default, rename = "type")]
    pub r#type: Option<String>,
    #[serde(default, deserialize_with = "option_uuid_from_query")]
    pub user_id: Option<Uuid>,
    #[serde(default, deserialize_with = "option_uuid_from_query")]
    pub admin_id: Option<Uuid>,
    #[serde(default, deserialize_with = "option_uuid_from_query")]
    pub lead_id: Option<Uuid>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchUsersQuery {
    pub q: String,
    pub limit: Option<i64>,
}

pub fn create_admin_appointments_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_appointments).post(create_appointment))
        .route("/stats", get(get_stats))
        .route("/search-users", get(search_users))
        .route("/:id", get(get_appointment).put(update_appointment).delete(delete_appointment))
        .route("/:id/reminder", post(send_reminder))
        .route("/:id/reschedule", put(reschedule_appointment))
        .route("/:id/cancel", put(cancel_appointment))
        .route("/:id/complete", put(complete_appointment))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn list_appointments(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:view").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let params = ListAppointmentsParams {
        limit: q.limit,
        offset: q.offset,
        search: q.search,
        status: q.status,
        r#type: q.r#type,
        user_id: q.user_id,
        admin_id: q.admin_id,
        lead_id: q.lead_id,
        start_date: q.start_date,
        end_date: q.end_date,
    };
    let (appointments, total) = appointment_service::list_admin(
        &pool,
        &params,
        allowed_user_ids.as_deref(),
        allowed_lead_ids.as_deref(),
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    let limit = appointment_service::clamp_limit(q.limit);
    let offset = appointment_service::clamp_offset(q.offset);
    Ok(Json(serde_json::json!({
        "appointments": appointments,
        "total": total,
        "limit": limit,
        "offset": offset,
    })))
}

async fn get_stats(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:view").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let stats = appointment_service::get_stats(
        &pool,
        allowed_user_ids.as_deref(),
        allowed_lead_ids.as_deref(),
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    Ok(Json(serde_json::to_value(&stats).unwrap()))
}

async fn search_users(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(q): Query<SearchUsersQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:view").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let users = appointment_service::search_users(&pool, &q.q, q.limit, allowed_user_ids.as_deref())
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    Ok(Json(serde_json::to_value(&users).unwrap()))
}

async fn get_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:view").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let row = appointment_service::get_by_id(&pool, id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    let Some(ref row) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Appointment not found" })),
        ));
    };
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    if !can_access_appointment(row, allowed_user_ids.as_deref(), allowed_lead_ids.as_deref()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to this appointment" } })),
        ));
    }
    Ok(Json(serde_json::to_value(row).unwrap()))
}

async fn create_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<CreateAppointmentPayload>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:create").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let has_user = payload.user_id.is_some();
    let has_lead = payload.lead_id.is_some();
    if !has_user && !has_lead {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": { "code": "VALIDATION", "message": "Either user_id or lead_id is required" } })),
        ));
    }
    if let Some(uid) = payload.user_id {
        if let Some(ref ids) = allowed_user_ids {
            if !ids.contains(&uid) {
                return Err((
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to create appointment for this user" } })),
                ));
            }
        }
    }
    if let Some(lid) = payload.lead_id {
        if let Some(ref ids) = allowed_lead_ids {
            if !ids.contains(&lid) {
                return Err((
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to create appointment for this lead" } })),
                ));
            }
        }
    }
    let admin_id = claims.sub;
    let row = appointment_service::create(&pool, admin_id, &payload)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::to_value(&row).unwrap()),
    ))
}

async fn update_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<UpdateAppointmentPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:edit").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let existing = appointment_service::get_by_id(&pool, id).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
    })?;
    let Some(ref row) = existing else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Appointment not found" }))));
    };
    if !can_access_appointment(row, allowed_user_ids.as_deref(), allowed_lead_ids.as_deref()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to this appointment" } })),
        ));
    }
    let row = appointment_service::update(&pool, id, &payload)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    let Some(row) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Appointment not found" })),
        ));
    };
    Ok(Json(serde_json::to_value(&row).unwrap()))
}

async fn delete_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:delete").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let existing = appointment_service::get_by_id(&pool, id).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
    })?;
    let Some(ref row) = existing else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Appointment not found" }))));
    };
    if !can_access_appointment(row, allowed_user_ids.as_deref(), allowed_lead_ids.as_deref()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to this appointment" } })),
        ));
    }
    let deleted = appointment_service::delete_by_id(&pool, id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    if !deleted {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Appointment not found" })),
        ));
    }
    Ok((
        StatusCode::NO_CONTENT,
        Json(serde_json::json!({ "message": "Deleted" })),
    ))
}

async fn send_reminder(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<SendReminderPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:send_reminder").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let existing = appointment_service::get_by_id(&pool, id).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
    })?;
    let Some(ref row) = existing else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Appointment not found" }))));
    };
    if !can_access_appointment(row, allowed_user_ids.as_deref(), allowed_lead_ids.as_deref()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to this appointment" } })),
        ));
    }
    appointment_service::send_reminder(&pool, id, &payload)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    Ok(Json(serde_json::json!({ "message": "Reminder sent" })))
}

async fn reschedule_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<ReschedulePayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:reschedule").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let existing = appointment_service::get_by_id(&pool, id).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
    })?;
    let Some(ref row) = existing else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Appointment not found" }))));
    };
    if !can_access_appointment(row, allowed_user_ids.as_deref(), allowed_lead_ids.as_deref()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to this appointment" } })),
        ));
    }
    let row = appointment_service::reschedule(&pool, id, &payload)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    let Some(row) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Appointment not found" })),
        ));
    };
    Ok(Json(serde_json::to_value(&row).unwrap()))
}

async fn cancel_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<CancelPayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:cancel").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let existing = appointment_service::get_by_id(&pool, id).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
    })?;
    let Some(ref row) = existing else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Appointment not found" }))));
    };
    if !can_access_appointment(row, allowed_user_ids.as_deref(), allowed_lead_ids.as_deref()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to this appointment" } })),
        ));
    }
    let row = appointment_service::cancel(&pool, id, &payload)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    let Some(row) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Appointment not found" })),
        ));
    };
    Ok(Json(serde_json::to_value(&row).unwrap()))
}

async fn complete_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<CompletePayload>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    check_appointments_permission(&pool, &claims, "appointments:complete").await?;
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve scope" } }))))?;
    let allowed_lead_ids = scoped_access::resolve_allowed_lead_ids(&pool, &claims)
        .await
        .map_err(|(status, _)| (status, Json(serde_json::json!({ "error": { "code": "SCOPE_FAILED", "message": "Failed to resolve lead scope" } }))))?;
    let existing = appointment_service::get_by_id(&pool, id).await.map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() })))
    })?;
    let Some(ref row) = existing else {
        return Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Appointment not found" }))));
    };
    if !can_access_appointment(row, allowed_user_ids.as_deref(), allowed_lead_ids.as_deref()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Access denied to this appointment" } })),
        ));
    }
    let row = appointment_service::complete(&pool, id, &payload)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
        })?;
    let Some(row) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Appointment not found" })),
        ));
    };
    Ok(Json(serde_json::to_value(&row).unwrap()))
}
