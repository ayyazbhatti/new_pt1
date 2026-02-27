//! Admin appointments API: list, stats, search users, get, create, update, delete, reschedule, cancel, complete, send reminder.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::services::appointment_service::{
    self, CancelPayload, CompletePayload, CreateAppointmentPayload, ListAppointmentsParams,
    ReschedulePayload, SendReminderPayload, UpdateAppointmentPayload,
};
use crate::utils::jwt::Claims;

#[derive(Debug, Deserialize, Default)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search: Option<String>,
    pub status: Option<String>,
    pub r#type: Option<String>,
    pub user_id: Option<Uuid>,
    pub admin_id: Option<Uuid>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchUsersQuery {
    pub q: String,
    pub limit: Option<i64>,
}

fn check_admin(claims: &Claims) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Admin access required" })),
        ));
    }
    Ok(())
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
    check_admin(&claims)?;
    let params = ListAppointmentsParams {
        limit: q.limit,
        offset: q.offset,
        search: q.search,
        status: q.status,
        r#type: q.r#type,
        user_id: q.user_id,
        admin_id: q.admin_id,
        start_date: q.start_date,
        end_date: q.end_date,
    };
    let (appointments, total) = appointment_service::list_admin(&pool, &params)
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
    check_admin(&claims)?;
    let stats = appointment_service::get_stats(&pool)
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
    check_admin(&claims)?;
    let users = appointment_service::search_users(&pool, &q.q, q.limit)
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
    check_admin(&claims)?;
    let row = appointment_service::get_by_id(&pool, id)
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

async fn create_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<CreateAppointmentPayload>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    check_admin(&claims)?;
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
    check_admin(&claims)?;
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
    check_admin(&claims)?;
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
    check_admin(&claims)?;
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
    check_admin(&claims)?;
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
    check_admin(&claims)?;
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
    check_admin(&claims)?;
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
