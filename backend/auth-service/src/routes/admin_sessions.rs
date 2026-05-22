use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Extension,
    Router,
};
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::models::market_session::{MarketHolidayDto, MarketSessionTemplateDto, SessionTemplateWindowDto};
use crate::services::admin_sessions_service::AdminSessionsService;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplateRequest {
    pub name: String,
    pub timezone: String,
    pub description: Option<String>,
    /// JSON uses `is24_7` (not serde default `is247` from `rename_all = "camelCase"` on `is_24_7`).
    #[serde(rename = "is24_7")]
    pub is_24_7: bool,
    pub is_default_for_market: Option<String>,
    pub windows: Vec<SessionTemplateWindowDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTemplateRequest {
    pub name: String,
    pub timezone: String,
    pub description: Option<String>,
    #[serde(rename = "is24_7")]
    pub is_24_7: bool,
    pub is_default_for_market: Option<String>,
    pub windows: Vec<SessionTemplateWindowDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertHolidayBody {
    pub holiday_date: NaiveDate,
    pub name: String,
    #[serde(rename = "type")]
    pub holiday_type: String,
    pub half_day_close_time: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListHolidaysQuery {
    pub year: Option<i32>,
}

#[derive(Debug, serde::Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, serde::Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

pub fn create_admin_sessions_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/templates", get(list_templates).post(create_template))
        .route(
            "/templates/:template_id/holidays",
            get(list_holidays).post(create_holiday),
        )
        .route("/holidays/:holiday_id", put(update_holiday).delete(delete_holiday))
        .route(
            "/templates/:id",
            get(get_template).put(update_template).delete(delete_template),
        )
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
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

async fn list_templates(
    State(pool): State<PgPool>,
    claims: Extension<Claims>,
) -> Result<Json<Vec<MarketSessionTemplateDto>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:view")
        .await
        .map_err(permission_denied_to_response)?;

    let svc = AdminSessionsService::new(pool);
    let items = svc.list_templates().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_SESSION_TEMPLATES_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    Ok(Json(items))
}

async fn get_template(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: Extension<Claims>,
) -> Result<Json<MarketSessionTemplateDto>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:view")
        .await
        .map_err(permission_denied_to_response)?;

    let svc = AdminSessionsService::new(pool);
    let t = svc.get_template(id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_SESSION_TEMPLATE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    match t {
        Some(t) => Ok(Json(t)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Template not found".to_string(),
                },
            }),
        )),
    }
}

async fn create_template(
    State(pool): State<PgPool>,
    claims: Extension<Claims>,
    Json(body): Json<CreateTemplateRequest>,
) -> Result<Json<MarketSessionTemplateDto>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let svc = AdminSessionsService::new(pool);
    let updated_by = Some(claims.email.as_str());
    let t = svc
        .create_template(
            &body.name,
            &body.timezone,
            body.description.as_deref(),
            body.is_24_7,
            body.is_default_for_market.as_deref(),
            &body.windows,
            updated_by,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "CREATE_SESSION_TEMPLATE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
    Ok(Json(t))
}

async fn update_template(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: Extension<Claims>,
    Json(body): Json<UpdateTemplateRequest>,
) -> Result<Json<MarketSessionTemplateDto>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let svc = AdminSessionsService::new(pool);
    let updated_by = Some(claims.email.as_str());
    let t = svc
        .update_template(
            id,
            &body.name,
            &body.timezone,
            body.description.as_deref(),
            body.is_24_7,
            body.is_default_for_market.as_deref(),
            &body.windows,
            updated_by,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_SESSION_TEMPLATE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
    Ok(Json(t))
}

async fn delete_template(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let svc = AdminSessionsService::new(pool);
    svc.delete_template(id).await.map_err(|e| {
        let status = if e.to_string().contains("not found") {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::BAD_REQUEST
        };
        (
            status,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DELETE_SESSION_TEMPLATE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    Ok(StatusCode::NO_CONTENT)
}

fn parse_holiday_time(s: &str) -> Result<chrono::NaiveTime, String> {
    let t = s.trim();
    chrono::NaiveTime::parse_from_str(t, "%H:%M:%S")
        .or_else(|_| chrono::NaiveTime::parse_from_str(t, "%H:%M"))
        .map_err(|_| format!("Invalid time '{}'", s))
}

fn bad_request(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: "BAD_REQUEST".to_string(),
                message: msg.into(),
            },
        }),
    )
}

async fn list_holidays(
    State(pool): State<PgPool>,
    Path(template_id): Path<Uuid>,
    Query(q): Query<ListHolidaysQuery>,
    claims: Extension<Claims>,
) -> Result<Json<Vec<MarketHolidayDto>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:view")
        .await
        .map_err(permission_denied_to_response)?;

    let svc = AdminSessionsService::new(pool.clone());
    let exists = svc.get_template(template_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_HOLIDAYS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    if exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Template not found".to_string(),
                },
            }),
        ));
    }

    let items = AdminSessionsService::new(pool)
        .list_holidays(template_id, q.year)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "LIST_HOLIDAYS_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
    Ok(Json(items))
}

async fn create_holiday(
    State(pool): State<PgPool>,
    Path(template_id): Path<Uuid>,
    claims: Extension<Claims>,
    Json(body): Json<UpsertHolidayBody>,
) -> Result<Json<MarketHolidayDto>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let half_nt = match body.half_day_close_time.as_deref() {
        Some(s) if !s.trim().is_empty() => match parse_holiday_time(s) {
            Ok(t) => Some(t),
            Err(msg) => return Err(bad_request(msg)),
        },
        _ => None,
    };

    let svc = AdminSessionsService::new(pool);
    let exists = svc.get_template(template_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "CREATE_HOLIDAY_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    if exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Template not found".to_string(),
                },
            }),
        ));
    }

    let h = svc
        .create_holiday(
            template_id,
            body.holiday_date,
            body.name.trim(),
            body.holiday_type.trim(),
            half_nt,
            body.notes.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        )
        .await
        .map_err(|e| bad_request(e.to_string()))?;
    Ok(Json(h))
}

async fn update_holiday(
    State(pool): State<PgPool>,
    Path(holiday_id): Path<Uuid>,
    claims: Extension<Claims>,
    Json(body): Json<UpsertHolidayBody>,
) -> Result<Json<MarketHolidayDto>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let half_nt = match body.half_day_close_time.as_deref() {
        Some(s) if !s.trim().is_empty() => match parse_holiday_time(s) {
            Ok(t) => Some(t),
            Err(msg) => return Err(bad_request(msg)),
        },
        _ => None,
    };

    let svc = AdminSessionsService::new(pool);
    let h = svc
        .update_holiday(
            holiday_id,
            body.holiday_date,
            body.name.trim(),
            body.holiday_type.trim(),
            half_nt,
            body.notes.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()),
        )
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("not found") {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "NOT_FOUND".to_string(),
                            message: msg,
                        },
                    }),
                )
            } else {
                bad_request(msg)
            }
        })?;
    Ok(Json(h))
}

async fn delete_holiday(
    State(pool): State<PgPool>,
    Path(holiday_id): Path<Uuid>,
    claims: Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "sessions:edit")
        .await
        .map_err(permission_denied_to_response)?;

    AdminSessionsService::new(pool)
        .delete_holiday(holiday_id)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("not found") {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: ErrorDetail {
                            code: "NOT_FOUND".to_string(),
                            message: msg,
                        },
                    }),
                )
            } else {
                bad_request(msg)
            }
        })?;
    Ok(StatusCode::NO_CONTENT)
}
