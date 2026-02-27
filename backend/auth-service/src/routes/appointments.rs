//! User appointments API: list (own), get by id (own).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::services::appointment_service::{self, ListAppointmentsParams};
use crate::utils::jwt::Claims;

#[derive(Debug, Deserialize, Default)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub status: Option<String>,
    pub r#type: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

pub fn create_appointments_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_appointments))
        .route("/:id", get(get_appointment))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn list_appointments(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let user_id = claims.sub;
    let params = ListAppointmentsParams {
        limit: q.limit,
        offset: q.offset,
        search: None,
        status: q.status,
        r#type: q.r#type,
        user_id: None,
        admin_id: None,
        start_date: q.start_date,
        end_date: q.end_date,
    };
    let (appointments, total) = appointment_service::list_for_user(&pool, user_id, &params)
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

async fn get_appointment(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let user_id = claims.sub;
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
    if row.user_id != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "Not allowed to view this appointment" })),
        ));
    }
    Ok(Json(serde_json::to_value(&row).unwrap()))
}
