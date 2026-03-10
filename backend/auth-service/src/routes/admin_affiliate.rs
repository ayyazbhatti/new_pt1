//! Admin API for affiliate commission layers: list, create, update, delete.
//! Used by admin affiliate page; commission calculation job reads these layers.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Serialize)]
pub struct LayerResponse {
    pub id: Uuid,
    pub level: i32,
    pub name: String,
    #[serde(serialize_with = "serialize_decimal")]
    pub commission_percent: Decimal,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

fn serialize_decimal<S>(d: &Decimal, s: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    use serde::Serializer;
    s.serialize_f64(d.to_string().parse::<f64>().unwrap_or(0.0))
}

#[derive(Debug, Deserialize)]
pub struct CreateLayerRequest {
    pub level: Option<i32>,
    pub name: String,
    pub commission_percent: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLayerRequest {
    pub name: Option<String>,
    pub commission_percent: Option<f64>,
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

#[derive(Debug, Serialize)]
pub struct AffiliateUserResponse {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub referral_code: Option<String>,
    pub referred_count: i64,
    /// Level at which this user earns commission (1 = direct referrer).
    pub level: i32,
    #[serde(serialize_with = "serialize_decimal")]
    pub commission_percent: Decimal,
}

#[derive(sqlx::FromRow)]
struct LayerRow {
    id: Uuid,
    level: i32,
    name: String,
    commission_percent: Decimal,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct AffiliateUserRow {
    id: Uuid,
    email: String,
    first_name: String,
    last_name: String,
    referral_code: Option<String>,
    referred_count: i64,
    commission_percent: Decimal,
}

pub fn create_admin_affiliate_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/users", get(list_affiliate_users))
        .route("/layers", get(list_layers).post(create_layer))
        .route("/layers/:id", put(update_layer).delete(delete_layer))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn list_affiliate_users(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<AffiliateUserResponse>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:view")
        .await
        .map_err(permission_denied_to_response)?;

    let rows = sqlx::query_as::<_, AffiliateUserRow>(
        r#"
        SELECT u.id, u.email,
               COALESCE(u.first_name, '') AS first_name,
               COALESCE(u.last_name, '') AS last_name,
               u.referral_code,
               (SELECT COUNT(*)::bigint FROM users r WHERE r.referred_by_user_id = u.id) AS referred_count,
               COALESCE(
                 (SELECT acl.commission_percent FROM affiliate_commission_layers acl WHERE acl.level = 1 LIMIT 1),
                 0
               ) AS commission_percent
        FROM users u
        WHERE u.referral_code IS NOT NULL
        ORDER BY referred_count DESC, u.email ASC
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
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

    let list: Vec<AffiliateUserResponse> = rows
        .into_iter()
        .map(|r| AffiliateUserResponse {
            id: r.id,
            email: r.email,
            first_name: r.first_name,
            last_name: r.last_name,
            referral_code: r.referral_code,
            referred_count: r.referred_count,
            level: 1,
            commission_percent: r.commission_percent,
        })
        .collect();
    Ok(Json(list))
}

async fn list_layers(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<LayerResponse>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:view")
        .await
        .map_err(permission_denied_to_response)?;

    let rows = sqlx::query_as::<_, LayerRow>(
        r#"
        SELECT id, level, name, commission_percent, created_at, updated_at
        FROM affiliate_commission_layers
        ORDER BY level ASC
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
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

    let list: Vec<LayerResponse> = rows
        .into_iter()
        .map(|r| LayerResponse {
            id: r.id,
            level: r.level,
            name: r.name,
            commission_percent: r.commission_percent,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect();
    Ok(Json(list))
}

async fn create_layer(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<CreateLayerRequest>,
) -> Result<(StatusCode, Json<LayerResponse>), (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:create")
        .await
        .map_err(permission_denied_to_response)?;

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

    let commission_percent = payload
        .commission_percent
        .unwrap_or(0.0)
        .clamp(0.0, 100.0);
    let commission_decimal = Decimal::from_f64_retain(commission_percent).unwrap_or(Decimal::ZERO);

    let level: i32 = if let Some(l) = payload.level {
        if l < 1 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "VALIDATION".to_string(),
                        message: "Level must be at least 1".to_string(),
                    },
                }),
            ));
        }
        l
    } else {
        let next: Option<i32> = sqlx::query_scalar(
            "SELECT COALESCE(MAX(level), 0) + 1 FROM affiliate_commission_layers",
        )
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
        next.unwrap_or(1)
    };

    let level_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM affiliate_commission_layers WHERE level = $1)",
    )
    .bind(level)
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
    if level_exists {
        return Err((
            StatusCode::CONFLICT,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LEVEL_EXISTS".to_string(),
                    message: "A layer with this level already exists".to_string(),
                },
            }),
        ));
    }

    let id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO affiliate_commission_layers (id, level, name, commission_percent, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        "#,
    )
    .bind(id)
    .bind(level)
    .bind(name)
    .bind(commission_decimal)
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

    let row: LayerRow = sqlx::query_as(
        "SELECT id, level, name, commission_percent, created_at, updated_at FROM affiliate_commission_layers WHERE id = $1",
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
        Json(LayerResponse {
            id: row.id,
            level: row.level,
            name: row.name,
            commission_percent: row.commission_percent,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }),
    ))
}

async fn update_layer(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<UpdateLayerRequest>,
) -> Result<Json<LayerResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let name = payload.name.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    let commission_percent = payload.commission_percent.map(|c| c.clamp(0.0, 100.0));

    if name.is_none() && commission_percent.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Provide at least one of name or commission_percent".to_string(),
                },
            }),
        ));
    }

    if let Some(ref n) = name {
        sqlx::query("UPDATE affiliate_commission_layers SET name = $1, updated_at = NOW() WHERE id = $2")
            .bind(n)
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
    }
    if let Some(c) = commission_percent {
        let d = Decimal::from_f64_retain(c).unwrap_or(Decimal::ZERO);
        sqlx::query("UPDATE affiliate_commission_layers SET commission_percent = $1, updated_at = NOW() WHERE id = $2")
            .bind(d)
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
    }

    let opt: Option<LayerRow> = sqlx::query_as(
        "SELECT id, level, name, commission_percent, created_at, updated_at FROM affiliate_commission_layers WHERE id = $1",
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
    let row = opt.ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: "NOT_FOUND".to_string(),
                message: "Layer not found".to_string(),
            },
        }),
    ))?;

    Ok(Json(LayerResponse {
        id: row.id,
        level: row.level,
        name: row.name,
        commission_percent: row.commission_percent,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }))
}

async fn delete_layer(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:delete")
        .await
        .map_err(permission_denied_to_response)?;

    let result = sqlx::query("DELETE FROM affiliate_commission_layers WHERE id = $1")
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

    if result.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Layer not found".to_string(),
                },
            }),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}
