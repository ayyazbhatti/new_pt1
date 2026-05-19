//! Admin User Events History API.

use axum::{
    extract::{Extension, Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::routes::scoped_access::{ensure_user_in_allowed_groups, resolve_allowed_group_ids, ErrorDetail, ErrorResponse};
use crate::services::user_events_service::{ListUserEventsQuery, ListUserEventsResponse, UserEventsService};
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Deserialize)]
pub struct AdminUserEventsQuery {
    pub user_id: Option<Uuid>,
    pub category: Option<String>,
    pub event_type: Option<String>,
    pub search: Option<String>,
    pub device_class: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

fn permission_denied_to_response(e: permission_check::PermissionDenied) -> (StatusCode, Json<ErrorResponse>) {
    (
        e.status,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: e.code,
                message: e.message,
            },
        }),
    )
}

fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
        .or_else(|| {
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())
        })
}

/// End of calendar day for inclusive `to` filters (date-only inputs).
fn parse_datetime_end(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&Utc));
    }
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .map(|d| d.and_hms_opt(23, 59, 59).unwrap().and_utc())
}

pub async fn list_user_events(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<AdminUserEventsQuery>,
) -> Result<Json<ListUserEventsResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "user_events:view")
        .await
        .map_err(permission_denied_to_response)?;

    // Compliance/audit view: platform admins see all events (manager row must not scope them).
    let allowed_group_ids = if claims.role == "admin" || claims.role == "super_admin" {
        None
    } else {
        resolve_allowed_group_ids(&pool, &claims).await?
    };

    if let Some(user_id) = query.user_id {
        ensure_user_in_allowed_groups(
            &pool,
            allowed_group_ids.as_deref(),
            user_id,
        )
        .await?;
    }

    let from = query
        .from
        .as_deref()
        .and_then(parse_datetime);
    let to = query.to.as_deref().and_then(parse_datetime_end);

    let service = UserEventsService::new(pool);
    let list_query = ListUserEventsQuery {
        user_id: query.user_id,
        category: query.category,
        event_type: query.event_type,
        search: query.search,
        device_class: query.device_class,
        from,
        to,
        cursor: query.cursor,
        limit: query.limit,
    };

    let response = service
        .list(list_query, allowed_group_ids)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    Ok(Json(response))
}

pub fn create_admin_user_events_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_user_events))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
