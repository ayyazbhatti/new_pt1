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
use std::collections::HashMap;
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
    /// User (manager/admin/super_admin) who created this scheme.
    pub created_by_user_id: Option<Uuid>,
    pub created_by_email: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub tag_ids: Vec<Uuid>,
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
    created_by_user_id: Option<Uuid>,
    created_by_email: Option<String>,
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

#[derive(Debug, Serialize)]
pub struct AffiliateSchemeTagsResponse {
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct PutAffiliateSchemeTagsRequest {
    pub tag_ids: Vec<Uuid>,
}

pub fn create_admin_affiliate_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/users", get(list_affiliate_users))
        .route("/layers", get(list_layers).post(create_layer))
        .route("/layers/:id", put(update_layer).delete(delete_layer))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

/// Router for GET/PUT affiliate scheme (layer) tags. Mount at `/api/admin/affiliate-scheme-tags` so path is `/:id`.
pub fn create_admin_affiliate_scheme_tags_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/:id", get(get_affiliate_scheme_tags).put(put_affiliate_scheme_tags))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_affiliate_scheme_tag_ids(pool: &PgPool, scheme_ids: &[Uuid]) -> HashMap<Uuid, Vec<Uuid>> {
    if scheme_ids.is_empty() {
        return HashMap::new();
    }
    #[derive(sqlx::FromRow)]
    struct Row {
        entity_id: Uuid,
        tag_id: Uuid,
    }
    let rows = match sqlx::query_as::<_, Row>(
        "SELECT entity_id, tag_id FROM tag_assignments WHERE entity_type = 'affiliate_scheme' AND entity_id = ANY($1)",
    )
    .bind(scheme_ids)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(_) => return HashMap::new(),
    };
    let mut map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for r in rows {
        map.entry(r.entity_id).or_default().push(r.tag_id);
    }
    map
}

async fn set_affiliate_scheme_tags(pool: &PgPool, scheme_id: Uuid, tag_ids: &[Uuid]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM tag_assignments WHERE entity_type = 'affiliate_scheme' AND entity_id = $1")
        .bind(scheme_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for tag_id in tag_ids {
        sqlx::query(
            "INSERT INTO tag_assignments (tag_id, entity_type, entity_id, created_at) VALUES ($1, 'affiliate_scheme', $2, NOW())",
        )
        .bind(tag_id)
        .bind(scheme_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn list_affiliate_users(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<AffiliateUserResponse>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:view")
        .await
        .map_err(permission_denied_to_response)?;

    // Single pass: aggregate referral counts once, then join. Avoids N correlated subqueries.
    let rows = sqlx::query_as::<_, AffiliateUserRow>(
        r#"
        SELECT u.id, u.email,
               COALESCE(u.first_name, '') AS first_name,
               COALESCE(u.last_name, '') AS last_name,
               u.referral_code,
               COALESCE(rc.referred_count, 0)::bigint AS referred_count,
               COALESCE(
                 (SELECT acl.commission_percent FROM affiliate_commission_layers acl WHERE acl.level = 1 LIMIT 1),
                 0
               ) AS commission_percent
        FROM users u
        LEFT JOIN (
          SELECT referred_by_user_id, COUNT(*)::bigint AS referred_count
          FROM users
          WHERE referred_by_user_id IS NOT NULL
          GROUP BY referred_by_user_id
        ) rc ON rc.referred_by_user_id = u.id
        WHERE u.referral_code IS NOT NULL
        ORDER BY COALESCE(rc.referred_count, 0) DESC, u.email ASC
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

/// Resolve affiliate scheme (layer) IDs the user is allowed to see: schemes that share a tag with the user, plus schemes the user created.
/// Super_admin should not use this (pass None to list_layers).
async fn resolve_allowed_affiliate_scheme_ids_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Uuid>, (StatusCode, Json<ErrorResponse>)> {
    use std::collections::HashSet;

    let mut allowed: HashSet<Uuid> = HashSet::new();

    // 1) Schemes that share at least one tag with the user
    #[derive(sqlx::FromRow)]
    struct TagRow {
        tag_id: Uuid,
    }
    let tag_rows = sqlx::query_as::<_, TagRow>(
        "SELECT tag_id FROM tag_assignments WHERE entity_type = 'user' AND entity_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
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
    let user_tag_ids: Vec<Uuid> = tag_rows.into_iter().map(|r| r.tag_id).collect();
    if !user_tag_ids.is_empty() {
        #[derive(sqlx::FromRow)]
        struct SchemeRow {
            entity_id: Uuid,
        }
        let scheme_rows = sqlx::query_as::<_, SchemeRow>(
            "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'affiliate_scheme' AND tag_id = ANY($1)",
        )
        .bind(&user_tag_ids)
        .fetch_all(pool)
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
        for r in scheme_rows {
            allowed.insert(r.entity_id);
        }
    }

    // 2) Schemes created by this user (admin sees their own created affiliate schemes even without tag match)
    #[derive(sqlx::FromRow)]
    struct IdRow {
        id: Uuid,
    }
    let created_rows = sqlx::query_as::<_, IdRow>(
        "SELECT id FROM affiliate_commission_layers WHERE created_by_user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
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
    for r in created_rows {
        allowed.insert(r.id);
    }

    Ok(allowed.into_iter().collect())
}

async fn list_layers(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<LayerResponse>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:view")
        .await
        .map_err(permission_denied_to_response)?;

    let allowed_scheme_ids: Option<Vec<Uuid>> = if claims.role == "super_admin" {
        None
    } else {
        let ids = resolve_allowed_affiliate_scheme_ids_for_user(&pool, claims.sub).await?;
        Some(ids)
    };

    let rows: Vec<LayerRow> = if let Some(ids) = &allowed_scheme_ids {
        if ids.is_empty() {
            vec![]
        } else {
            sqlx::query_as::<_, LayerRow>(
                r#"
                SELECT acl.id, acl.level, acl.name, acl.commission_percent, acl.created_at, acl.updated_at,
                       acl.created_by_user_id, creator.email AS created_by_email
                FROM affiliate_commission_layers acl
                LEFT JOIN users creator ON creator.id = acl.created_by_user_id
                WHERE acl.id = ANY($1)
                ORDER BY acl.level ASC
                "#,
            )
            .bind(ids)
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
            })?
        }
    } else {
        sqlx::query_as::<_, LayerRow>(
            r#"
            SELECT acl.id, acl.level, acl.name, acl.commission_percent, acl.created_at, acl.updated_at,
                   acl.created_by_user_id, creator.email AS created_by_email
            FROM affiliate_commission_layers acl
            LEFT JOIN users creator ON creator.id = acl.created_by_user_id
            ORDER BY acl.level ASC
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
        })?
    };

    let layer_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let tag_map = get_affiliate_scheme_tag_ids(&pool, &layer_ids).await;

    let list: Vec<LayerResponse> = rows
        .into_iter()
        .map(|r| LayerResponse {
            id: r.id,
            level: r.level,
            name: r.name,
            commission_percent: r.commission_percent,
            created_at: r.created_at,
            updated_at: r.updated_at,
            created_by_user_id: r.created_by_user_id,
            created_by_email: r.created_by_email,
            tag_ids: tag_map.get(&r.id).cloned().unwrap_or_default(),
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
    let created_by_user_id = claims.sub;
    sqlx::query(
        r#"
        INSERT INTO affiliate_commission_layers (id, level, name, commission_percent, created_at, updated_at, created_by_user_id)
        VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
        "#,
    )
    .bind(id)
    .bind(level)
    .bind(name)
    .bind(commission_decimal)
    .bind(created_by_user_id)
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
        r#"
        SELECT acl.id, acl.level, acl.name, acl.commission_percent, acl.created_at, acl.updated_at,
               acl.created_by_user_id, creator.email AS created_by_email
        FROM affiliate_commission_layers acl
        LEFT JOIN users creator ON creator.id = acl.created_by_user_id
        WHERE acl.id = $1
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
        Json(LayerResponse {
            id: row.id,
            level: row.level,
            name: row.name,
            commission_percent: row.commission_percent,
            created_at: row.created_at,
            updated_at: row.updated_at,
            created_by_user_id: row.created_by_user_id,
            created_by_email: row.created_by_email,
            tag_ids: vec![],
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
        r#"
        SELECT acl.id, acl.level, acl.name, acl.commission_percent, acl.created_at, acl.updated_at,
               acl.created_by_user_id, creator.email AS created_by_email
        FROM affiliate_commission_layers acl
        LEFT JOIN users creator ON creator.id = acl.created_by_user_id
        WHERE acl.id = $1
        "#,
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
        created_by_user_id: row.created_by_user_id,
        created_by_email: row.created_by_email,
        tag_ids: vec![],
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

async fn get_affiliate_scheme_tags(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<AffiliateSchemeTagsResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:view")
        .await
        .map_err(permission_denied_to_response)?;
    let ids = vec![id];
    let map = get_affiliate_scheme_tag_ids(&pool, &ids).await;
    let tag_ids = map.get(&id).cloned().unwrap_or_default();
    Ok(Json(AffiliateSchemeTagsResponse { tag_ids }))
}

async fn put_affiliate_scheme_tags(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<PutAffiliateSchemeTagsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "affiliate:edit")
        .await
        .map_err(permission_denied_to_response)?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM affiliate_commission_layers WHERE id = $1)")
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
    if !exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Affiliate scheme not found".to_string(),
                },
            }),
        ));
    }
    set_affiliate_scheme_tags(&pool, id, &payload.tag_ids)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_SCHEME_TAGS_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
    Ok(Json(serde_json::json!({ "success": true })))
}
