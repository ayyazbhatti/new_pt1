//! Admin API for managers: list, create, update, delete.
//! Managers table links a user to a permission profile; users.permission_profile_id is synced when status = 'active'.

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

#[derive(Debug, Serialize)]
pub struct ManagerResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_name: String,
    pub user_email: String,
    pub permission_profile_id: Uuid,
    pub permission_profile_name: String,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListManagersQuery {
    pub status: Option<String>,
    pub permission_profile_id: Option<Uuid>,
    pub search: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateManagerRequest {
    pub user_id: Uuid,
    pub permission_profile_id: Uuid,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateManagerRequest {
    pub permission_profile_id: Option<Uuid>,
    pub notes: Option<Option<String>>,
    pub status: Option<String>,
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

fn check_admin(claims: &Claims) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can access managers".to_string(),
                },
            }),
        ));
    }
    Ok(())
}

pub fn create_admin_managers_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_managers).post(create_manager))
        .route("/:id", put(update_manager).delete(delete_manager))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

#[derive(sqlx::FromRow)]
struct ManagerRow {
    id: Uuid,
    user_id: Uuid,
    user_name: String,
    user_email: String,
    permission_profile_id: Uuid,
    permission_profile_name: String,
    status: String,
    notes: Option<String>,
    created_at: DateTime<Utc>,
    last_login_at: Option<DateTime<Utc>>,
}

async fn list_managers(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(params): Query<ListManagersQuery>,
) -> Result<Json<Vec<ManagerResponse>>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let search = params
        .search
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let status = params
        .status
        .as_deref()
        .filter(|s| *s == "active" || *s == "disabled");
    let profile_id = params.permission_profile_id;

    let mut q_str = r#"
        SELECT m.id, m.user_id, m.permission_profile_id, m.status, m.notes, m.created_at,
               CONCAT(u.first_name, ' ', u.last_name) AS user_name,
               u.email AS user_email,
               p.name AS permission_profile_name,
               u.last_login_at AS last_login_at
        FROM managers m
        JOIN users u ON u.id = m.user_id
        JOIN permission_profiles p ON p.id = m.permission_profile_id
        WHERE 1=1
    "#
    .to_string();
    let mut bind_pos = 1u32;
    if status.is_some() {
        q_str.push_str(&format!(" AND m.status = ${}", bind_pos));
        bind_pos += 1;
    }
    if profile_id.is_some() {
        q_str.push_str(&format!(" AND m.permission_profile_id = ${}", bind_pos));
        bind_pos += 1;
    }
    if search.is_some() {
        q_str.push_str(&format!(
            " AND (LOWER(u.first_name) LIKE ${} OR LOWER(u.last_name) LIKE ${} OR LOWER(u.email) LIKE ${})",
            bind_pos,
            bind_pos + 1,
            bind_pos + 2
        ));
    }
    q_str.push_str(" ORDER BY m.created_at DESC");

    let mut q = sqlx::query_as::<_, ManagerRow>(&q_str);
    if let Some(s) = status {
        q = q.bind(s);
    }
    if let Some(pid) = profile_id {
        q = q.bind(pid);
    }
    if let Some(s) = search {
        let pattern = format!("%{}%", s.to_lowercase());
        q = q.bind(pattern.clone()).bind(pattern.clone()).bind(pattern);
    }

    let rows = q.fetch_all(&pool).await.map_err(|e| {
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

    let list: Vec<ManagerResponse> = rows
        .into_iter()
        .map(|r| ManagerResponse {
            id: r.id,
            user_id: r.user_id,
            user_name: r.user_name,
            user_email: r.user_email,
            permission_profile_id: r.permission_profile_id,
            permission_profile_name: r.permission_profile_name,
            status: r.status,
            notes: r.notes,
            created_at: r.created_at,
            last_login_at: r.last_login_at,
        })
        .collect();
    Ok(Json(list))
}

async fn create_manager(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<CreateManagerRequest>,
) -> Result<(StatusCode, Json<ManagerResponse>), (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let user_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(payload.user_id)
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
    if !user_exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "USER_NOT_FOUND".to_string(),
                    message: "User not found".to_string(),
                },
            }),
        ));
    }

    let already_manager: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM managers WHERE user_id = $1)")
            .bind(payload.user_id)
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
    if already_manager {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "ALREADY_MANAGER".to_string(),
                    message: "User is already a manager".to_string(),
                },
            }),
        ));
    }

    let profile_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM permission_profiles WHERE id = $1)")
            .bind(payload.permission_profile_id)
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
    if !profile_exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "PROFILE_NOT_FOUND".to_string(),
                    message: "Permission profile not found".to_string(),
                },
            }),
        ));
    }

    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO managers (id, user_id, permission_profile_id, status, notes, created_at, updated_at)
        VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())
        "#,
    )
    .bind(id)
    .bind(payload.user_id)
    .bind(payload.permission_profile_id)
    .bind(payload.notes.as_deref())
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

    // Set role to 'manager' so the user can access the admin panel (AdminGuard allows admin, manager, agent).
    // Do not overwrite role if user is already 'admin'.
    sqlx::query(
        "UPDATE users SET role = CASE WHEN role = 'admin' THEN role ELSE 'manager' END, permission_profile_id = $1, updated_at = NOW() WHERE id = $2",
    )
    .bind(payload.permission_profile_id)
    .bind(payload.user_id)
    .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_USER_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let profile_name: String = sqlx::query_scalar("SELECT name FROM permission_profiles WHERE id = $1")
        .bind(payload.permission_profile_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| "".to_string());

    let user_row: (String, String, Option<DateTime<Utc>>) = sqlx::query_as(
        "SELECT CONCAT(first_name, ' ', last_name), email, last_login_at FROM users WHERE id = $1",
    )
    .bind(payload.user_id)
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
        Json(ManagerResponse {
            id,
            user_id: payload.user_id,
            user_name: user_row.0,
            user_email: user_row.1,
            permission_profile_id: payload.permission_profile_id,
            permission_profile_name: profile_name,
            status: "active".to_string(),
            notes: payload.notes,
            created_at: Utc::now(),
            last_login_at: user_row.2,
        }),
    ))
}

async fn update_manager(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<UpdateManagerRequest>,
) -> Result<Json<ManagerResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let manager: Option<(Uuid, Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT user_id, permission_profile_id, status, notes FROM managers WHERE id = $1",
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

    let (user_id, current_profile_id, current_status, _) = match manager {
        Some(r) => r,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "MANAGER_NOT_FOUND".to_string(),
                        message: "Manager not found".to_string(),
                    },
                }),
            ));
        }
    };

    let new_profile_id = payload.permission_profile_id.unwrap_or(current_profile_id);
    let new_status = payload
        .status
        .as_deref()
        .filter(|s| *s == "active" || *s == "disabled")
        .unwrap_or(&current_status);
    let new_notes = payload.notes.unwrap_or_default();

    if let Some(pid) = payload.permission_profile_id {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM permission_profiles WHERE id = $1)")
            .bind(pid)
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
        if !exists {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "PROFILE_NOT_FOUND".to_string(),
                        message: "Permission profile not found".to_string(),
                    },
                }),
            ));
        }
    }

    sqlx::query(
        r#"
        UPDATE managers SET permission_profile_id = $1, status = $2, notes = $3, updated_at = NOW() WHERE id = $4
        "#,
    )
    .bind(new_profile_id)
    .bind(new_status)
    .bind(new_notes.as_deref())
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

    // When active: set role to 'manager' and permission_profile_id so they can access admin panel (never overwrite 'admin').
    // When disabled: set role to 'user' and clear permission_profile_id (never overwrite 'admin').
    let (role_sql, user_profile_value) = if new_status == "active" {
        ("CASE WHEN role = 'admin' THEN role ELSE 'manager' END", Some(new_profile_id))
    } else {
        ("CASE WHEN role = 'admin' THEN role ELSE 'user' END", None)
    };
    let update_sql = format!(
        "UPDATE users SET role = {}, permission_profile_id = $1, updated_at = NOW() WHERE id = $2",
        role_sql
    );
    sqlx::query(&update_sql)
        .bind(user_profile_value)
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_USER_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let profile_name: String = sqlx::query_scalar("SELECT name FROM permission_profiles WHERE id = $1")
        .bind(new_profile_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| "".to_string());

    let (user_name, user_email, last_login_at): (String, String, Option<DateTime<Utc>>) =
        sqlx::query_as(
            "SELECT CONCAT(first_name, ' ', last_name), email, last_login_at FROM users WHERE id = $1",
        )
        .bind(user_id)
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

    let created_at: DateTime<Utc> = sqlx::query_scalar("SELECT created_at FROM managers WHERE id = $1")
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

    Ok(Json(ManagerResponse {
        id,
        user_id,
        user_name,
        user_email,
        permission_profile_id: new_profile_id,
        permission_profile_name: profile_name,
        status: new_status.to_string(),
        notes: new_notes,
        created_at,
        last_login_at,
    }))
}

async fn delete_manager(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let user_id: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM managers WHERE id = $1")
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

    let user_id = match user_id {
        Some(u) => u,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "MANAGER_NOT_FOUND".to_string(),
                        message: "Manager not found".to_string(),
                    },
                }),
            ));
        }
    };

    sqlx::query("DELETE FROM managers WHERE id = $1")
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

    // Revoke manager admin access: set role to 'user' and clear permission_profile_id (never overwrite 'admin')
    sqlx::query("UPDATE users SET role = CASE WHEN role = 'admin' THEN role ELSE 'user' END, permission_profile_id = NULL, updated_at = NOW() WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_USER_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({ "success": true })),
    ))
}
