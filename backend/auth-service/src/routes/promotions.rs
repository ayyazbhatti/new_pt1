//! Public and admin API for terminal promotion slides (carousel in right panel).
//! Public: GET /api/promotions/slides (active only, JWT required).
//! Admin: full CRUD + reorder + toggle under /api/admin/promotions/slides.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, patch, post, put},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;

const MAX_SLIDES_PUBLIC: i64 = 10;

#[derive(Debug, Serialize)]
pub struct SlideResponse {
    pub id: Uuid,
    pub sort_order: i32,
    pub image_url: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub link_url: Option<String>,
    pub link_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSlideRequest {
    pub image_url: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub link_url: Option<String>,
    pub link_label: Option<String>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSlideRequest {
    pub image_url: Option<String>,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub link_url: Option<String>,
    pub link_label: Option<String>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderRequest {
    pub order: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ToggleRequest {
    pub is_active: bool,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

#[derive(sqlx::FromRow)]
struct SlideRow {
    id: Uuid,
    sort_order: i32,
    image_url: String,
    title: String,
    subtitle: Option<String>,
    link_url: Option<String>,
    link_label: Option<String>,
    is_active: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

fn slide_row_to_public(row: &SlideRow) -> SlideResponse {
    SlideResponse {
        id: row.id,
        sort_order: row.sort_order,
        image_url: row.image_url.clone(),
        title: row.title.clone(),
        subtitle: row.subtitle.clone(),
        link_url: row.link_url.clone(),
        link_label: row.link_label.clone(),
        is_active: None,
        created_at: None,
        updated_at: None,
    }
}

fn slide_row_to_admin(row: &SlideRow) -> SlideResponse {
    SlideResponse {
        id: row.id,
        sort_order: row.sort_order,
        image_url: row.image_url.clone(),
        title: row.title.clone(),
        subtitle: row.subtitle.clone(),
        link_url: row.link_url.clone(),
        link_label: row.link_label.clone(),
        is_active: Some(row.is_active),
        created_at: Some(row.created_at),
        updated_at: Some(row.updated_at),
    }
}

async fn check_promotions_permission(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role == "admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT permission_profile_id FROM users WHERE id = $1",
    )
    .bind(claims.sub)
    .fetch_optional(pool)
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
    let Some(pid) = profile_id else {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "No permission profile assigned".to_string(),
                },
            }),
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
    if has {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: format!("Missing permission: {}", permission),
                },
            }),
        ))
    }
}

// ---------- Public router (terminal) ----------

pub fn create_promotions_public_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/slides", get(list_public_slides))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn list_public_slides(
    State(pool): State<PgPool>,
) -> Result<Json<Vec<SlideResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let rows: Vec<SlideRow> = sqlx::query_as(
        r#"
        SELECT id, sort_order, image_url, title, subtitle, link_url, link_label, is_active, created_at, updated_at
        FROM terminal_promotion_slides
        WHERE is_active = true
        ORDER BY sort_order ASC
        LIMIT $1
        "#,
    )
    .bind(MAX_SLIDES_PUBLIC)
    .fetch_all(&pool)
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
    let out: Vec<SlideResponse> = rows.iter().map(slide_row_to_public).collect();
    Ok(Json(out))
}

// ---------- Admin router ----------

pub fn create_admin_promotions_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/slides", get(admin_list_slides).post(admin_create_slide))
        .route("/slides/reorder", patch(admin_reorder_slides))
        .route("/slides/:id/toggle", patch(admin_toggle_slide))
        .route("/slides/:id", put(admin_update_slide).delete(admin_delete_slide))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn admin_list_slides(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<SlideResponse>>, (StatusCode, Json<ErrorResponse>)> {
    check_promotions_permission(&pool, &claims, "promotions:view").await?;
    let rows: Vec<SlideRow> = sqlx::query_as(
        r#"
        SELECT id, sort_order, image_url, title, subtitle, link_url, link_label, is_active, created_at, updated_at
        FROM terminal_promotion_slides
        ORDER BY sort_order ASC
        "#,
    )
    .fetch_all(&pool)
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
    let out: Vec<SlideResponse> = rows.iter().map(slide_row_to_admin).collect();
    Ok(Json(out))
}

async fn admin_create_slide(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<CreateSlideRequest>,
) -> Result<Json<SlideResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_promotions_permission(&pool, &claims, "promotions:edit").await?;
    let image_url = body.image_url.trim();
    let title = body.title.trim();
    if image_url.is_empty() || title.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "BAD_REQUEST".to_string(),
                    message: "image_url and title are required and must be non-empty".to_string(),
                },
            }),
        ));
    }
    let is_active = body.is_active.unwrap_or(true);
    let sort_order: i32 = if let Some(so) = body.sort_order {
        so
    } else {
        let max: Option<i32> = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM terminal_promotion_slides",
        )
        .fetch_one(&pool)
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
        max.unwrap_or(0)
    };
    let row: SlideRow = sqlx::query_as(
        r#"
        INSERT INTO terminal_promotion_slides (sort_order, image_url, title, subtitle, link_url, link_label, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, sort_order, image_url, title, subtitle, link_url, link_label, is_active, created_at, updated_at
        "#,
    )
    .bind(sort_order)
    .bind(image_url)
    .bind(title)
    .bind(body.subtitle.as_deref())
    .bind(body.link_url.as_deref())
    .bind(body.link_label.as_deref())
    .bind(is_active)
    .fetch_one(&pool)
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
    Ok(Json(slide_row_to_admin(&row)))
}

async fn admin_update_slide(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<UpdateSlideRequest>,
) -> Result<Json<SlideResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_promotions_permission(&pool, &claims, "promotions:edit").await?;
    if let Some(ref u) = body.image_url {
        if u.trim().is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "BAD_REQUEST".to_string(),
                        message: "image_url cannot be empty".to_string(),
                    },
                }),
            ));
        }
    }
    if let Some(ref t) = body.title {
        if t.trim().is_empty() {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "BAD_REQUEST".to_string(),
                        message: "title cannot be empty".to_string(),
                    },
                }),
            ));
        }
    }
    let row: Option<SlideRow> = sqlx::query_as(
        r#"
        UPDATE terminal_promotion_slides
        SET
            sort_order = COALESCE($2, sort_order),
            image_url = COALESCE(NULLIF(TRIM($3), ''), image_url),
            title = COALESCE(NULLIF(TRIM($4), ''), title),
            subtitle = COALESCE($5, subtitle),
            link_url = COALESCE($6, link_url),
            link_label = COALESCE($7, link_label),
            is_active = COALESCE($8, is_active),
            updated_at = now()
        WHERE id = $1
        RETURNING id, sort_order, image_url, title, subtitle, link_url, link_label, is_active, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(body.sort_order)
    .bind(body.image_url.as_deref())
    .bind(body.title.as_deref())
    .bind(body.subtitle.as_deref())
    .bind(body.link_url.as_deref())
    .bind(body.link_label.as_deref())
    .bind(body.is_active)
    .fetch_optional(&pool)
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
    match row {
        Some(r) => Ok(Json(slide_row_to_admin(&r))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Slide not found".to_string(),
                },
            }),
        )),
    }
}

async fn admin_delete_slide(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_promotions_permission(&pool, &claims, "promotions:edit").await?;
    let result = sqlx::query("DELETE FROM terminal_promotion_slides WHERE id = $1")
        .bind(id)
        .execute(&pool)
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
    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Slide not found".to_string(),
                },
            }),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn admin_reorder_slides(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<ReorderRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_promotions_permission(&pool, &claims, "promotions:edit").await?;
    for (idx, id) in body.order.iter().enumerate() {
        let so = idx as i32;
        sqlx::query("UPDATE terminal_promotion_slides SET sort_order = $1, updated_at = now() WHERE id = $2")
            .bind(so)
            .bind(id)
            .execute(&pool)
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
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn admin_toggle_slide(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(body): axum::Json<ToggleRequest>,
) -> Result<Json<SlideResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_promotions_permission(&pool, &claims, "promotions:edit").await?;
    let row: Option<SlideRow> = sqlx::query_as(
        r#"
        UPDATE terminal_promotion_slides
        SET is_active = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, sort_order, image_url, title, subtitle, link_url, link_label, is_active, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(body.is_active)
    .fetch_optional(&pool)
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
    match row {
        Some(r) => Ok(Json(slide_row_to_admin(&r))),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Slide not found".to_string(),
                },
            }),
        )),
    }
}
