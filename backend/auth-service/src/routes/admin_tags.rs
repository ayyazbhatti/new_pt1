//! Admin API for tags: list, create, update, delete.
//! Tags can later be assigned to users, managers, and other entities via tag_assignments.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;

const DEFAULT_COLOR: &str = "#8b5cf6";

#[derive(Debug, Serialize)]
pub struct TagResponse {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub color: String,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub user_count: i32,
    pub manager_count: i32,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListTagsQuery {
    pub search: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTagRequest {
    pub name: String,
    pub slug: String,
    pub color: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTagRequest {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub color: Option<String>,
    pub description: Option<Option<String>>,
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

/// Allow if role is admin or user has the given permission (from their permission profile).
async fn check_tags_permission(
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

fn valid_slug(slug: &str) -> bool {
    let s = slug.trim();
    if s.is_empty() {
        return false;
    }
    s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_color(color: &str) -> bool {
    let s = color.trim();
    s.len() == 7
        && s.starts_with('#')
        && s.chars().skip(1).all(|c| c.is_ascii_hexdigit())
}

pub fn create_admin_tags_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_tags).post(create_tag))
        .route("/:id", put(update_tag).delete(delete_tag))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

#[derive(sqlx::FromRow)]
struct TagRow {
    id: Uuid,
    name: String,
    slug: String,
    color: String,
    description: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    user_count: i32,
    manager_count: i32,
}

async fn list_tags(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(params): Query<ListTagsQuery>,
) -> Result<Json<Vec<TagResponse>>, (StatusCode, Json<ErrorResponse>)> {
    check_tags_permission(&pool, &claims, "tags:view").await?;

    let search = params
        .search
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s.to_lowercase()));

    let rows = if let Some(ref pattern) = search {
        sqlx::query_as::<_, TagRow>(
            r#"
            SELECT t.id, t.name, t.slug, t.color, t.description, t.created_at, t.updated_at,
                   COALESCE((SELECT COUNT(*)::int FROM tag_assignments a WHERE a.tag_id = t.id AND a.entity_type = 'user'), 0) AS user_count,
                   COALESCE((SELECT COUNT(*)::int FROM tag_assignments a WHERE a.tag_id = t.id AND a.entity_type = 'manager'), 0) AS manager_count
            FROM tags t
            WHERE LOWER(t.name) LIKE $1 OR LOWER(t.slug) LIKE $1
            ORDER BY t.created_at DESC
            "#,
        )
        .bind(pattern)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query_as::<_, TagRow>(
            r#"
            SELECT t.id, t.name, t.slug, t.color, t.description, t.created_at, t.updated_at,
                   COALESCE((SELECT COUNT(*)::int FROM tag_assignments a WHERE a.tag_id = t.id AND a.entity_type = 'user'), 0) AS user_count,
                   COALESCE((SELECT COUNT(*)::int FROM tag_assignments a WHERE a.tag_id = t.id AND a.entity_type = 'manager'), 0) AS manager_count
            FROM tags t
            ORDER BY t.created_at DESC
            "#,
        )
        .fetch_all(&pool)
        .await
    };

    let rows = rows.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let list: Vec<TagResponse> = rows
        .into_iter()
        .map(|r| TagResponse {
            id: r.id,
            name: r.name,
            slug: r.slug,
            color: r.color,
            description: r.description,
            created_at: r.created_at,
            updated_at: r.updated_at,
            user_count: r.user_count,
            manager_count: r.manager_count,
        })
        .collect();
    Ok(Json(list))
}

async fn create_tag(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<CreateTagRequest>,
) -> Result<(StatusCode, Json<TagResponse>), (StatusCode, Json<ErrorResponse>)> {
    check_tags_permission(&pool, &claims, "tags:create").await?;

    let name = payload.name.trim();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Name is required".to_string(),
                },
            }),
        ));
    }

    let slug = payload.slug.trim().to_lowercase();
    if slug.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Slug is required".to_string(),
                },
            }),
        ));
    }
    if !valid_slug(&slug) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Slug must contain only lowercase letters, numbers, and hyphens"
                        .to_string(),
                },
            }),
        ));
    }

    let color = payload
        .color
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| valid_color(s))
        .unwrap_or(DEFAULT_COLOR)
        .to_string();

    let description = payload.description.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()).map(String::from);

    let slug_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tags WHERE LOWER(slug) = LOWER($1))")
        .bind(&slug)
        .fetch_one(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DATABASE_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
    if slug_exists {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "SLUG_EXISTS".to_string(),
                    message: "A tag with this slug already exists".to_string(),
                },
            }),
        ));
    }

    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO tags (id, name, slug, color, description, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        "#,
    )
    .bind(id)
    .bind(name)
    .bind(&slug)
    .bind(&color)
    .bind(description.as_deref())
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INSERT_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let row: TagRow = sqlx::query_as(
        r#"
        SELECT t.id, t.name, t.slug, t.color, t.description, t.created_at, t.updated_at,
               0::int AS user_count, 0::int AS manager_count
        FROM tags t WHERE t.id = $1
        "#,
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(TagResponse {
            id: row.id,
            name: row.name,
            slug: row.slug,
            color: row.color,
            description: row.description,
            created_at: row.created_at,
            updated_at: row.updated_at,
            user_count: row.user_count,
            manager_count: row.manager_count,
        }),
    ))
}

async fn update_tag(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<UpdateTagRequest>,
) -> Result<Json<TagResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_tags_permission(&pool, &claims, "tags:edit").await?;

    let current: Option<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT name, slug, color, description FROM tags WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let (current_name, current_slug, current_color, current_description) = match current {
        Some(r) => r,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "TAG_NOT_FOUND".to_string(),
                        message: "Tag not found".to_string(),
                    },
                }),
            ));
        }
    };

    let name = payload
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&current_name)
        .to_string();
    let slug = payload
        .slug
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| current_slug.clone());
    if !valid_slug(&slug) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Slug must contain only lowercase letters, numbers, and hyphens"
                        .to_string(),
                },
            }),
        ));
    }
    let color = payload
        .color
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| valid_color(s))
        .unwrap_or(&current_color)
        .to_string();
    let description: Option<String> = match &payload.description {
        None => current_description,
        Some(inner) => inner
            .as_deref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };

    if slug != current_slug {
        let slug_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tags WHERE LOWER(slug) = LOWER($1) AND id != $2)")
                .bind(&slug)
                .bind(id)
                .fetch_one(&pool)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: ErrorDetail {
                                code: "DATABASE_ERROR".to_string(),
                                message: e.to_string(),
                            },
                        }),
                    )
                })?;
        if slug_exists {
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "SLUG_EXISTS".to_string(),
                        message: "A tag with this slug already exists".to_string(),
                    },
                }),
            ));
        }
    }

    sqlx::query(
        r#"
        UPDATE tags SET name = $1, slug = $2, color = $3, description = $4, updated_at = NOW() WHERE id = $5
        "#,
    )
    .bind(&name)
    .bind(&slug)
    .bind(&color)
    .bind(description.as_deref())
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "UPDATE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let row: TagRow = sqlx::query_as(
        r#"
        SELECT t.id, t.name, t.slug, t.color, t.description, t.created_at, t.updated_at,
               COALESCE((SELECT COUNT(*)::int FROM tag_assignments a WHERE a.tag_id = t.id AND a.entity_type = 'user'), 0) AS user_count,
               COALESCE((SELECT COUNT(*)::int FROM tag_assignments a WHERE a.tag_id = t.id AND a.entity_type = 'manager'), 0) AS manager_count
        FROM tags t WHERE t.id = $1
        "#,
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DATABASE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(Json(TagResponse {
        id: row.id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        description: row.description,
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_count: row.user_count,
        manager_count: row.manager_count,
    }))
}

async fn delete_tag(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    check_tags_permission(&pool, &claims, "tags:delete").await?;

    let deleted = sqlx::query("DELETE FROM tags WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DELETE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    if deleted.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "TAG_NOT_FOUND".to_string(),
                    message: "Tag not found".to_string(),
                },
            }),
        ));
    }

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "success": true })),
    ))
}
