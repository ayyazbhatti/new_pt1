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
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use std::str::FromStr;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::routes::admin_trading::AdminTradingState;
use crate::routes::deposits::get_price_from_redis_conn;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Serialize)]
pub struct ManagerResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_name: String,
    pub user_email: String,
    pub user_role: String,
    pub permission_profile_id: Uuid,
    pub permission_profile_name: String,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_ids: Option<Vec<Uuid>>,
    /// User who created this manager record (manager/admin/super_admin).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_user_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_email: Option<String>,
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
    #[serde(default)]
    pub role: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateManagerRequest {
    pub permission_profile_id: Option<Uuid>,
    pub notes: Option<Option<String>>,
    pub status: Option<String>,
    /// When provided and target user is already admin or super_admin: set user role to this ("admin" or "super_admin").
    pub role: Option<String>,
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

/// Resolve manager IDs the user is allowed to see: managers that share a tag with the user, plus managers the user created.
/// Super_admin should not use this (show all).
async fn resolve_allowed_manager_ids_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Uuid>, (StatusCode, Json<ErrorResponse>)> {
    use std::collections::HashSet;

    let mut allowed: HashSet<Uuid> = HashSet::new();

    // 1) Managers that share at least one tag with the user
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
        struct ManagerIdRow {
            entity_id: Uuid,
        }
        let manager_rows = sqlx::query_as::<_, ManagerIdRow>(
            "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'manager' AND tag_id = ANY($1)",
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
        for r in manager_rows {
            allowed.insert(r.entity_id);
        }
    }

    // 2) Managers created by this user (admin/manager sees their own created managers even without tag match)
    #[derive(sqlx::FromRow)]
    struct IdRow {
        id: Uuid,
    }
    let created_rows = sqlx::query_as::<_, IdRow>(
        "SELECT id FROM managers WHERE created_by_user_id = $1",
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

pub fn create_admin_managers_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_managers).post(create_manager))
        .route("/:id/statistics", get(get_manager_statistics))
        .route("/:id", get(get_manager).put(update_manager).delete(delete_manager))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

#[derive(sqlx::FromRow)]
struct ManagerRow {
    id: Uuid,
    user_id: Uuid,
    user_name: String,
    user_email: String,
    user_role: String,
    permission_profile_id: Uuid,
    permission_profile_name: String,
    status: String,
    notes: Option<String>,
    created_at: DateTime<Utc>,
    last_login_at: Option<DateTime<Utc>>,
    created_by_user_id: Option<Uuid>,
    created_by_email: Option<String>,
}

async fn list_managers(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(params): Query<ListManagersQuery>,
) -> Result<Json<Vec<ManagerResponse>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:view")
        .await
        .map_err(permission_denied_to_response)?;

    let allowed_manager_ids: Option<Vec<Uuid>> = if claims.role == "super_admin" {
        None
    } else {
        let ids = resolve_allowed_manager_ids_for_user(&pool, claims.sub).await?;
        if ids.is_empty() {
            return Ok(Json(vec![]));
        }
        Some(ids)
    };

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
               u."role" AS user_role,
               p.name AS permission_profile_name,
               u.last_login_at AS last_login_at,
               m.created_by_user_id,
               creator.email AS created_by_email
        FROM managers m
        JOIN users u ON u.id = m.user_id
        JOIN permission_profiles p ON p.id = m.permission_profile_id
        LEFT JOIN users creator ON creator.id = m.created_by_user_id
        WHERE 1=1
    "#
    .to_string();
    let mut bind_pos = 1u32;
    if allowed_manager_ids.is_some() {
        q_str.push_str(&format!(" AND m.id = ANY(${})", bind_pos));
        bind_pos += 1;
    }
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
    if let Some(ref ids) = allowed_manager_ids {
        q = q.bind(ids);
    }
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

    let manager_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let tag_map: std::collections::HashMap<Uuid, Vec<Uuid>> = if manager_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        #[derive(sqlx::FromRow)]
        struct TagRow { entity_id: Uuid, tag_id: Uuid }
        let tag_rows = sqlx::query_as::<_, TagRow>(
            "SELECT entity_id, tag_id FROM tag_assignments WHERE entity_type = 'manager' AND entity_id = ANY($1)",
        )
        .bind(&manager_ids)
        .fetch_all(&pool)
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
        let mut map: std::collections::HashMap<Uuid, Vec<Uuid>> = std::collections::HashMap::new();
        for r in tag_rows {
            map.entry(r.entity_id).or_default().push(r.tag_id);
        }
        map
    };

    let list: Vec<ManagerResponse> = rows
        .into_iter()
        .map(|r| {
            let tag_ids = tag_map.get(&r.id).cloned().unwrap_or_default();
            ManagerResponse {
                id: r.id,
                user_id: r.user_id,
                user_name: r.user_name,
                user_email: r.user_email,
                user_role: r.user_role,
                permission_profile_id: r.permission_profile_id,
                permission_profile_name: r.permission_profile_name,
                status: r.status,
                notes: r.notes,
                created_at: r.created_at,
                last_login_at: r.last_login_at,
                tag_ids: Some(tag_ids),
                created_by_user_id: r.created_by_user_id,
                created_by_email: r.created_by_email,
            }
        })
        .collect();
    Ok(Json(list))
}

async fn get_manager(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<ManagerResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:view")
        .await
        .map_err(permission_denied_to_response)?;

    let allowed_manager_ids: Option<Vec<Uuid>> = if claims.role == "super_admin" {
        None
    } else {
        let ids = resolve_allowed_manager_ids_for_user(&pool, claims.sub).await?;
        if ids.is_empty() {
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
        Some(ids)
    };

    let q_str = if allowed_manager_ids.is_some() {
        r#"
        SELECT m.id, m.user_id, m.permission_profile_id, m.status, m.notes, m.created_at,
               CONCAT(u.first_name, ' ', u.last_name) AS user_name,
               u.email AS user_email,
               u."role" AS user_role,
               p.name AS permission_profile_name,
               u.last_login_at AS last_login_at,
               m.created_by_user_id,
               creator.email AS created_by_email
        FROM managers m
        JOIN users u ON u.id = m.user_id
        JOIN permission_profiles p ON p.id = m.permission_profile_id
        LEFT JOIN users creator ON creator.id = m.created_by_user_id
        WHERE m.id = $1 AND m.id = ANY($2)
        "#
    } else {
        r#"
        SELECT m.id, m.user_id, m.permission_profile_id, m.status, m.notes, m.created_at,
               CONCAT(u.first_name, ' ', u.last_name) AS user_name,
               u.email AS user_email,
               u."role" AS user_role,
               p.name AS permission_profile_name,
               u.last_login_at AS last_login_at,
               m.created_by_user_id,
               creator.email AS created_by_email
        FROM managers m
        JOIN users u ON u.id = m.user_id
        JOIN permission_profiles p ON p.id = m.permission_profile_id
        LEFT JOIN users creator ON creator.id = m.created_by_user_id
        WHERE m.id = $1
        "#
    };

    let mut q = sqlx::query_as::<_, ManagerRow>(q_str).bind(id);
    if let Some(ref ids) = allowed_manager_ids {
        q = q.bind(ids);
    }

    let row: Option<ManagerRow> = q
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

    let r = match row {
        Some(row) => row,
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

    #[derive(sqlx::FromRow)]
    struct TagRow {
        entity_id: Uuid,
        tag_id: Uuid,
    }
    let tag_rows = sqlx::query_as::<_, TagRow>(
        "SELECT entity_id, tag_id FROM tag_assignments WHERE entity_type = 'manager' AND entity_id = $1",
    )
    .bind(id)
    .fetch_all(&pool)
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
    let tag_ids: Vec<Uuid> = tag_rows.into_iter().map(|t| t.tag_id).collect();

    Ok(Json(ManagerResponse {
        id: r.id,
        user_id: r.user_id,
        user_name: r.user_name,
        user_email: r.user_email,
        user_role: r.user_role,
        permission_profile_id: r.permission_profile_id,
        permission_profile_name: r.permission_profile_name,
        status: r.status,
        notes: r.notes,
        created_at: r.created_at,
        last_login_at: r.last_login_at,
        tag_ids: Some(tag_ids),
        created_by_user_id: r.created_by_user_id,
        created_by_email: r.created_by_email,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatisticsResponse {
    overview: ManagerStatsOverview,
    deposits: ManagerStatsDeposits,
    withdrawals: ManagerStatsWithdrawals,
    positions: ManagerStatsPositions,
    orders: ManagerStatsOrders,
    recent_deposits: Vec<ManagerStatsRecentTx>,
    recent_withdrawals: Vec<ManagerStatsRecentTx>,
    open_positions: Vec<ManagerStatsPositionRow>,
    recent_orders: Vec<ManagerStatsOrderRow>,
    top_traders: Vec<ManagerStatsTraderRow>,
    top_losers: Vec<ManagerStatsTraderRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsOverview {
    total_users: u64,
    total_groups: u64,
    active_users: u64,
    assigned_leads: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsDeposits {
    total_count: u64,
    total_volume: f64,
    today_count: u64,
    today_volume: f64,
    pending_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsWithdrawals {
    total_count: u64,
    total_volume: f64,
    today_count: u64,
    today_volume: f64,
    pending_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsPositions {
    open_count: u64,
    total_exposure: f64,
    closed_today: u64,
    live_pnl: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsOrders {
    active_count: u64,
    filled_today: u64,
    cancelled_today: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsRecentTx {
    id: String,
    user: String,
    amount: f64,
    currency: String,
    status: String,
    time: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsPositionRow {
    id: String,
    symbol: String,
    side: String,
    size: f64,
    entry: f64,
    mark: f64,
    live_pnl: f64,
    user: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsOrderRow {
    id: String,
    user: String,
    symbol: String,
    side: String,
    #[serde(rename = "type")]
    type_: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagerStatsTraderRow {
    rank: u32,
    user: String,
    pnl: f64,
    win_rate: u32,
    volume: f64,
}

const POS_BY_ID_PREFIX: &str = "pos:by_id:";

async fn get_manager_statistics(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::extract::Extension(admin_state): axum::extract::Extension<AdminTradingState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ManagerStatisticsResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:view")
        .await
        .map_err(permission_denied_to_response)?;

    let allowed_manager_ids: Option<Vec<Uuid>> = if claims.role == "super_admin" {
        None
    } else {
        let ids = resolve_allowed_manager_ids_for_user(&pool, claims.sub).await?;
        if ids.is_empty() {
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
        Some(ids)
    };

    let exists: bool = if let Some(ref ids) = allowed_manager_ids {
        ids.contains(&id)
    } else {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM managers WHERE id = $1)")
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
            })?
    };

    if !exists {
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

    // Resolve allowed group IDs for this manager (tag-based: manager's tags -> groups with those tags)
    #[derive(sqlx::FromRow)]
    struct TagIdRow { tag_id: Uuid }
    let tag_rows = sqlx::query_as::<_, TagIdRow>(
        "SELECT tag_id FROM tag_assignments WHERE entity_type = 'manager' AND entity_id = $1",
    )
    .bind(id)
    .fetch_all(&pool)
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
    let manager_tag_ids: Vec<Uuid> = tag_rows.into_iter().map(|r| r.tag_id).collect();

    let (total_users, total_groups, active_users) = if manager_tag_ids.is_empty() {
        (0u64, 0u64, 0u64)
    } else {
        #[derive(sqlx::FromRow)]
        struct GroupIdRow { entity_id: Uuid }
        let group_rows = sqlx::query_as::<_, GroupIdRow>(
            "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY($1)",
        )
        .bind(&manager_tag_ids)
        .fetch_all(&pool)
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
        let allowed_group_ids: Vec<Uuid> = group_rows.into_iter().map(|r| r.entity_id).collect();
        let total_groups = allowed_group_ids.len() as u64;

        let (total_users, active_users) = if allowed_group_ids.is_empty() {
            (0u64, 0u64)
        } else {
            let total: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM users WHERE group_id = ANY($1) AND deleted_at IS NULL AND role NOT IN ('admin', 'super_admin')",
            )
            .bind(&allowed_group_ids)
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
            let active: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM users WHERE group_id = ANY($1) AND deleted_at IS NULL AND status = 'active' AND role NOT IN ('admin', 'super_admin')",
            )
            .bind(&allowed_group_ids)
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
            (total.max(0) as u64, active.max(0) as u64)
        };
        (total_users, total_groups, active_users)
    };

    // Assigned leads: leads where owner_id = this manager's user_id
    let manager_user_id: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM managers WHERE id = $1")
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
    let assigned_leads: u64 = match manager_user_id {
        None => 0,
        Some(uid) => {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM leads WHERE owner_id = $1")
                .bind(uid)
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
            count.max(0) as u64
        }
    };

    // Deposit and withdrawal stats: scope by users in this manager's allowed groups
    let (deposits_total_count, deposits_total_volume, deposits_today_count, deposits_today_volume, deposits_pending_count,
         withdrawals_total_count, withdrawals_total_volume, withdrawals_today_count, withdrawals_today_volume, withdrawals_pending_count) =
        if manager_tag_ids.is_empty() {
            (0u64, 0.0_f64, 0u64, 0.0_f64, 0u64, 0u64, 0.0_f64, 0u64, 0.0_f64, 0u64)
        } else {
            #[derive(sqlx::FromRow)]
            struct GroupIdRow { entity_id: Uuid }
            let group_rows = sqlx::query_as::<_, GroupIdRow>(
                "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY($1)",
            )
            .bind(&manager_tag_ids)
            .fetch_all(&pool)
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
            let allowed_group_ids: Vec<Uuid> = group_rows.into_iter().map(|r| r.entity_id).collect();
            if allowed_group_ids.is_empty() {
                (0u64, 0.0_f64, 0u64, 0.0_f64, 0u64, 0u64, 0.0_f64, 0u64, 0.0_f64, 0u64)
            } else {
                #[derive(sqlx::FromRow)]
                struct UserIdRow { id: Uuid }
                let user_rows = sqlx::query_as::<_, UserIdRow>(
                    "SELECT id FROM users WHERE group_id = ANY($1) AND deleted_at IS NULL AND role NOT IN ('admin', 'super_admin')",
                )
                .bind(&allowed_group_ids)
                .fetch_all(&pool)
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
                let allowed_user_ids: Vec<Uuid> = user_rows.into_iter().map(|r| r.id).collect();
                if allowed_user_ids.is_empty() {
                    (0u64, 0.0_f64, 0u64, 0.0_f64, 0u64, 0u64, 0.0_f64, 0u64, 0.0_f64, 0u64)
                } else {
                    let dep_count: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*)::bigint FROM transactions WHERE type = 'deposit'::transaction_type AND status = 'completed'::transaction_status AND user_id = ANY($1)",
                    )
                    .bind(&allowed_user_ids)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let dep_vol: Option<Decimal> = sqlx::query_scalar(
                        "SELECT COALESCE(SUM(net_amount), 0) FROM transactions WHERE type = 'deposit'::transaction_type AND status = 'completed'::transaction_status AND user_id = ANY($1)",
                    )
                    .bind(&allowed_user_ids)
                    .fetch_optional(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let dep_today_count: i64 = sqlx::query_scalar(
                        r#"SELECT COUNT(*)::bigint FROM transactions WHERE type = 'deposit'::transaction_type AND status = 'completed'::transaction_status AND DATE(created_at) = CURRENT_DATE AND user_id = ANY($1)"#,
                    )
                    .bind(&allowed_user_ids)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let dep_today_vol: Option<Decimal> = sqlx::query_scalar(
                        r#"SELECT COALESCE(SUM(net_amount), 0) FROM transactions WHERE type = 'deposit'::transaction_type AND status = 'completed'::transaction_status AND DATE(created_at) = CURRENT_DATE AND user_id = ANY($1)"#,
                    )
                    .bind(&allowed_user_ids)
                    .fetch_optional(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let dep_pending: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*) FROM transactions WHERE type = 'deposit'::transaction_type AND status = 'pending'::transaction_status AND user_id = ANY($1)",
                    )
                    .bind(&allowed_user_ids)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;

                    let wd_count: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*)::bigint FROM transactions WHERE type = 'withdrawal'::transaction_type AND status = 'completed'::transaction_status AND user_id = ANY($1)",
                    )
                    .bind(&allowed_user_ids)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let wd_vol: Option<Decimal> = sqlx::query_scalar(
                        "SELECT COALESCE(SUM(net_amount), 0) FROM transactions WHERE type = 'withdrawal'::transaction_type AND status = 'completed'::transaction_status AND user_id = ANY($1)",
                    )
                    .bind(&allowed_user_ids)
                    .fetch_optional(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let wd_today_count: i64 = sqlx::query_scalar(
                        r#"SELECT COUNT(*)::bigint FROM transactions WHERE type = 'withdrawal'::transaction_type AND status = 'completed'::transaction_status AND DATE(created_at) = CURRENT_DATE AND user_id = ANY($1)"#,
                    )
                    .bind(&allowed_user_ids)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let wd_today_vol: Option<Decimal> = sqlx::query_scalar(
                        r#"SELECT COALESCE(SUM(net_amount), 0) FROM transactions WHERE type = 'withdrawal'::transaction_type AND status = 'completed'::transaction_status AND DATE(created_at) = CURRENT_DATE AND user_id = ANY($1)"#,
                    )
                    .bind(&allowed_user_ids)
                    .fetch_optional(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let wd_pending: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*) FROM transactions WHERE type = 'withdrawal'::transaction_type AND status = 'pending'::transaction_status AND user_id = ANY($1)",
                    )
                    .bind(&allowed_user_ids)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;

                    fn decimal_to_f64(d: Option<Decimal>) -> f64 {
                        d.and_then(|x| x.to_string().parse::<f64>().ok()).unwrap_or(0.0)
                    }
                    (
                        dep_count.max(0) as u64,
                        decimal_to_f64(dep_vol),
                        dep_today_count.max(0) as u64,
                        decimal_to_f64(dep_today_vol),
                        dep_pending.max(0) as u64,
                        wd_count.max(0) as u64,
                        decimal_to_f64(wd_vol),
                        wd_today_count.max(0) as u64,
                        decimal_to_f64(wd_today_vol),
                        wd_pending.max(0) as u64,
                    )
                }
            }
        };

    // Position and order stats: positions from Redis (same source as /admin/trading), orders and closed_today from DB
    let (positions_open_count, positions_total_exposure, positions_closed_today, positions_live_pnl,
         orders_active_count, orders_filled_today, orders_cancelled_today, open_positions) =
        if manager_tag_ids.is_empty() {
            (0u64, 0.0_f64, 0u64, 0.0_f64, 0u64, 0u64, 0u64, vec![])
        } else {
            #[derive(sqlx::FromRow)]
            struct GroupIdRowPos { entity_id: Uuid }
            let group_rows_pos = sqlx::query_as::<_, GroupIdRowPos>(
                "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY($1)",
            )
            .bind(&manager_tag_ids)
            .fetch_all(&pool)
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
            let allowed_group_ids_pos: Vec<Uuid> = group_rows_pos.into_iter().map(|r| r.entity_id).collect();
            if allowed_group_ids_pos.is_empty() {
                (0u64, 0.0_f64, 0u64, 0.0_f64, 0u64, 0u64, 0u64, vec![])
            } else {
                #[derive(sqlx::FromRow)]
                struct UserIdRowPos { id: Uuid }
                let user_rows_pos = sqlx::query_as::<_, UserIdRowPos>(
                    "SELECT id FROM users WHERE group_id = ANY($1) AND deleted_at IS NULL AND role NOT IN ('admin', 'super_admin')",
                )
                .bind(&allowed_group_ids_pos)
                .fetch_all(&pool)
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
                let allowed_user_ids_pos: Vec<Uuid> = user_rows_pos.into_iter().map(|r| r.id).collect();
                if allowed_user_ids_pos.is_empty() {
                    (0u64, 0.0_f64, 0u64, 0.0_f64, 0u64, 0u64, 0u64, vec![])
                } else {
                    // closed_today: from DB (historical)
                    let pos_closed_today: i64 = sqlx::query_scalar(
                        r#"SELECT COUNT(*) FROM positions WHERE status IN ('closed'::position_status, 'liquidated'::position_status) AND closed_at IS NOT NULL AND DATE(closed_at) = CURRENT_DATE AND user_id = ANY($1)"#,
                    )
                    .bind(&allowed_user_ids_pos)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;

                    // orders: from DB
                    let ord_active: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*) FROM orders WHERE status = 'pending'::order_status AND user_id = ANY($1)",
                    )
                    .bind(&allowed_user_ids_pos)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let ord_filled_today: i64 = sqlx::query_scalar(
                        r#"SELECT COUNT(*) FROM orders WHERE status = 'filled'::order_status AND user_id = ANY($1) AND filled_at IS NOT NULL AND DATE(filled_at) = CURRENT_DATE"#,
                    )
                    .bind(&allowed_user_ids_pos)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;
                    let ord_cancelled_today: i64 = sqlx::query_scalar(
                        r#"SELECT COUNT(*) FROM orders WHERE status = 'cancelled'::order_status AND user_id = ANY($1) AND cancelled_at IS NOT NULL AND DATE(cancelled_at) = CURRENT_DATE"#,
                    )
                    .bind(&allowed_user_ids_pos)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| {
                        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: ErrorDetail { code: "DATABASE_ERROR".to_string(), message: e.to_string() } }))
                    })?;

                    // Open positions: from Redis (same source as /admin/trading)
                    let allowed_set: std::collections::HashSet<Uuid> = allowed_user_ids_pos.iter().copied().collect();
                    let mut conn = admin_state.redis.get().await.map_err(|_| {
                        (
                            StatusCode::SERVICE_UNAVAILABLE,
                            Json(ErrorResponse {
                                error: ErrorDetail {
                                    code: "REDIS_ERROR".to_string(),
                                    message: "Cache unavailable".to_string(),
                                },
                            }),
                        )
                    })?;
                    let keys: Vec<String> = conn.keys(format!("{}*", POS_BY_ID_PREFIX)).await.map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(ErrorResponse {
                                error: ErrorDetail {
                                    code: "REDIS_ERROR".to_string(),
                                    message: e.to_string(),
                                },
                            }),
                        )
                    })?;
                    let mut redis_positions: Vec<(String, HashMap<String, String>)> = Vec::new();
                    for key in keys {
                        if !key.starts_with(POS_BY_ID_PREFIX) {
                            continue;
                        }
                        let position_id = key.trim_start_matches(POS_BY_ID_PREFIX).to_string();
                        let pos_data: HashMap<String, String> = match conn.hgetall(&key).await {
                            Ok(m) => m,
                            Err(_) => continue,
                        };
                        let status = pos_data.get("status").map(|s| s.as_str()).unwrap_or("");
                        if !status.eq_ignore_ascii_case("OPEN") {
                            continue;
                        }
                        let pos_user_id = match pos_data.get("user_id").and_then(|s| Uuid::parse_str(s).ok()) {
                            Some(u) => u,
                            None => continue,
                        };
                        if !allowed_set.contains(&pos_user_id) {
                            continue;
                        }
                        redis_positions.push((position_id, pos_data));
                    }

                    let pos_open_count = redis_positions.len() as u64;
                    let pos_total_exposure: f64 = redis_positions.iter().filter_map(|(_, m)| m.get("margin").and_then(|s| s.parse::<f64>().ok())).sum();

                    let user_ids: Vec<Uuid> = redis_positions
                        .iter()
                        .filter_map(|(_, m)| m.get("user_id").and_then(|s| Uuid::parse_str(s).ok()))
                        .collect::<std::collections::HashSet<_>>()
                        .into_iter()
                        .collect();
                    let user_map: HashMap<Uuid, String> = if user_ids.is_empty() {
                        HashMap::new()
                    } else {
                        let rows = sqlx::query_as::<_, (Uuid, String)>(
                            r#"SELECT id, COALESCE(TRIM(first_name || ' ' || last_name), '') as name FROM users WHERE id = ANY($1)"#,
                        )
                        .bind(&user_ids)
                        .fetch_all(&pool)
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
                        rows.into_iter().collect()
                    };

                    let mut open_positions: Vec<ManagerStatsPositionRow> = Vec::new();
                    for (pos_id, m) in redis_positions {
                        let user_id = match m.get("user_id").and_then(|s| Uuid::parse_str(s).ok()) {
                            Some(u) => u,
                            None => continue,
                        };
                        let user_name = user_map.get(&user_id).cloned().unwrap_or_else(|| "—".to_string());
                        let symbol = m.get("symbol").cloned().unwrap_or_else(|| "—".to_string());
                        let group_id = m.get("group_id").cloned().unwrap_or_default();
                        let side = m.get("side").cloned().unwrap_or_else(|| "LONG".to_string());
                        let size: f64 = m.get("size").and_then(|s| s.parse().ok()).unwrap_or(0.0);
                        let entry: f64 = m.get("entry_price").and_then(|s| s.parse().ok()).unwrap_or(0.0);
                        let avg_price: f64 = m.get("avg_price").and_then(|s| s.parse().ok()).or_else(|| m.get("entry_price").and_then(|s| s.parse().ok())).unwrap_or(entry);
                        let mark = avg_price;
                        let live_pnl: f64 = if !symbol.is_empty() && symbol != "—" && size > 0.0 && avg_price > 0.0 {
                            if let Some((bid, ask)) = get_price_from_redis_conn(&mut conn, &symbol, &group_id).await {
                                let size_d = Decimal::from_str(&size.to_string()).unwrap_or(Decimal::ZERO);
                                let avg_d = Decimal::from_str(&avg_price.to_string()).unwrap_or(Decimal::ZERO);
                                let pnl = match side.as_str() {
                                    "LONG" => (bid - avg_d) * size_d,
                                    "SHORT" => (avg_d - ask) * size_d,
                                    _ => Decimal::ZERO,
                                };
                                pnl.to_string().parse::<f64>().unwrap_or(0.0)
                            } else {
                                m.get("unrealized_pnl").and_then(|s| s.parse().ok()).unwrap_or(0.0)
                            }
                        } else {
                            m.get("unrealized_pnl").and_then(|s| s.parse().ok()).unwrap_or(0.0)
                        };
                        open_positions.push(ManagerStatsPositionRow {
                            id: pos_id,
                            symbol,
                            side,
                            size,
                            entry,
                            mark,
                            live_pnl,
                            user: user_name,
                        });
                    }
                    let pos_live_pnl_computed: f64 = open_positions.iter().map(|p| p.live_pnl).sum();

                    (
                        pos_open_count,
                        pos_total_exposure,
                        pos_closed_today.max(0) as u64,
                        pos_live_pnl_computed,
                        ord_active.max(0) as u64,
                        ord_filled_today.max(0) as u64,
                        ord_cancelled_today.max(0) as u64,
                        open_positions,
                    )
                }
            }
        };

    // Recent deposits, withdrawals, and orders: same user scope, latest 10 each
    const RECENT_TX_LIMIT: i64 = 10;
    let (recent_deposits, recent_withdrawals, recent_orders) = if manager_tag_ids.is_empty() {
        (vec![], vec![], vec![])
    } else {
        #[derive(sqlx::FromRow)]
        struct GroupIdRowRecent { entity_id: Uuid }
        let group_rows_recent = sqlx::query_as::<_, GroupIdRowRecent>(
            "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY($1)",
        )
        .bind(&manager_tag_ids)
        .fetch_all(&pool)
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
        let allowed_group_ids_recent: Vec<Uuid> = group_rows_recent.into_iter().map(|r| r.entity_id).collect();
            if allowed_group_ids_recent.is_empty() {
                (vec![], vec![], vec![])
            } else {
            #[derive(sqlx::FromRow)]
            struct UserIdRowRecent { id: Uuid }
            let user_rows_recent = sqlx::query_as::<_, UserIdRowRecent>(
                "SELECT id FROM users WHERE group_id = ANY($1) AND deleted_at IS NULL AND role NOT IN ('admin', 'super_admin')",
            )
            .bind(&allowed_group_ids_recent)
            .fetch_all(&pool)
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
            let allowed_user_ids_recent: Vec<Uuid> = user_rows_recent.into_iter().map(|r| r.id).collect();
            if allowed_user_ids_recent.is_empty() {
                (vec![], vec![], vec![])
            } else {
                #[derive(sqlx::FromRow)]
                struct RecentTxRow {
                    id: Uuid,
                    user_name: String,
                    net_amount: Option<Decimal>,
                    currency: Option<String>,
                    status: String,
                    created_at: DateTime<Utc>,
                }
                let dep_rows = sqlx::query_as::<_, RecentTxRow>(
                    r#"
                    SELECT t.id, COALESCE(TRIM(u.first_name || ' ' || u.last_name), u.email, '') as user_name,
                           t.net_amount, t.currency, t.status::text as status, t.created_at
                    FROM transactions t
                    JOIN users u ON t.user_id = u.id
                    WHERE t.type = 'deposit'::transaction_type AND t.user_id = ANY($1)
                    ORDER BY t.created_at DESC
                    LIMIT $2
                    "#,
                )
                .bind(&allowed_user_ids_recent)
                .bind(RECENT_TX_LIMIT)
                .fetch_all(&pool)
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
                let wd_rows = sqlx::query_as::<_, RecentTxRow>(
                    r#"
                    SELECT t.id, COALESCE(TRIM(u.first_name || ' ' || u.last_name), u.email, '') as user_name,
                           t.net_amount, t.currency, t.status::text as status, t.created_at
                    FROM transactions t
                    JOIN users u ON t.user_id = u.id
                    WHERE t.type = 'withdrawal'::transaction_type AND t.user_id = ANY($1)
                    ORDER BY t.created_at DESC
                    LIMIT $2
                    "#,
                )
                .bind(&allowed_user_ids_recent)
                .bind(RECENT_TX_LIMIT)
                .fetch_all(&pool)
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
                fn recent_tx_to_stats(r: RecentTxRow) -> ManagerStatsRecentTx {
                    ManagerStatsRecentTx {
                        id: r.id.to_string(),
                        user: r.user_name,
                        amount: r.net_amount.and_then(|d| d.to_string().parse::<f64>().ok()).unwrap_or(0.0),
                        currency: r.currency.unwrap_or_else(|| "USD".to_string()),
                        status: r.status,
                        time: r.created_at.to_rfc3339(),
                    }
                }
                #[derive(sqlx::FromRow)]
                struct RecentOrderRow {
                    id: Uuid,
                    user_name: String,
                    symbol: String,
                    side: String,
                    order_type: String,
                    status: String,
                }
                let order_rows = sqlx::query_as::<_, RecentOrderRow>(
                    r#"
                    SELECT o.id,
                           COALESCE(TRIM(u.first_name || ' ' || u.last_name), u.email, '') as user_name,
                           COALESCE(s.code, '') as symbol,
                           o.side::text as side,
                           o.type::text as order_type,
                           o.status::text as status
                    FROM orders o
                    JOIN users u ON o.user_id = u.id
                    LEFT JOIN symbols s ON o.symbol_id = s.id
                    WHERE o.user_id = ANY($1)
                    ORDER BY o.created_at DESC
                    LIMIT $2
                    "#,
                )
                .bind(&allowed_user_ids_recent)
                .bind(RECENT_TX_LIMIT)
                .fetch_all(&pool)
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
                let recent_orders: Vec<ManagerStatsOrderRow> = order_rows
                    .into_iter()
                    .map(|r| ManagerStatsOrderRow {
                        id: r.id.to_string(),
                        user: r.user_name,
                        symbol: r.symbol,
                        side: r.side,
                        type_: r.order_type,
                        status: r.status,
                    })
                    .collect();
                (
                    dep_rows.into_iter().map(recent_tx_to_stats).collect(),
                    wd_rows.into_iter().map(recent_tx_to_stats).collect(),
                    recent_orders,
                )
            }
        }
    };

    // Top traders (best PnL) and top losers (worst PnL): from closed/liquidated positions, same user scope
    const TOP_TRADERS_LIMIT: usize = 10;
    let (top_traders, top_losers) = if manager_tag_ids.is_empty() {
        (vec![], vec![])
    } else {
        #[derive(sqlx::FromRow)]
        struct GroupIdRowTop { entity_id: Uuid }
        let group_rows_top = sqlx::query_as::<_, GroupIdRowTop>(
            "SELECT DISTINCT entity_id FROM tag_assignments WHERE entity_type = 'group' AND tag_id = ANY($1)",
        )
        .bind(&manager_tag_ids)
        .fetch_all(&pool)
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
        let allowed_group_ids_top: Vec<Uuid> = group_rows_top.into_iter().map(|r| r.entity_id).collect();
        if allowed_group_ids_top.is_empty() {
            (vec![], vec![])
        } else {
            #[derive(sqlx::FromRow)]
            struct UserIdRowTop { id: Uuid }
            let user_rows_top = sqlx::query_as::<_, UserIdRowTop>(
                "SELECT id FROM users WHERE group_id = ANY($1) AND deleted_at IS NULL AND role NOT IN ('admin', 'super_admin')",
            )
            .bind(&allowed_group_ids_top)
            .fetch_all(&pool)
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
            let allowed_user_ids_top: Vec<Uuid> = user_rows_top.into_iter().map(|r| r.id).collect();
            if allowed_user_ids_top.is_empty() {
                (vec![], vec![])
            } else {
                #[derive(sqlx::FromRow)]
                struct UserPnlRow {
                    user_id: Uuid,
                    total_pnl: Option<Decimal>,
                    volume: Option<Decimal>,
                    trades: i64,
                    wins: i64,
                }
                let pnl_rows = sqlx::query_as::<_, UserPnlRow>(
                    r#"
                    SELECT user_id,
                           SUM(pnl) as total_pnl,
                           SUM(size * entry_price) as volume,
                           COUNT(*)::bigint as trades,
                           COUNT(*) FILTER (WHERE pnl > 0)::bigint as wins
                    FROM positions
                    WHERE status IN ('closed'::position_status, 'liquidated'::position_status)
                      AND user_id = ANY($1)
                    GROUP BY user_id
                    "#,
                )
                .bind(&allowed_user_ids_top)
                .fetch_all(&pool)
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
                let user_ids_pnl: Vec<Uuid> = pnl_rows.iter().map(|r| r.user_id).collect();
                let user_names: HashMap<Uuid, String> = if user_ids_pnl.is_empty() {
                    HashMap::new()
                } else {
                    let rows = sqlx::query_as::<_, (Uuid, String)>(
                        r#"SELECT id, COALESCE(TRIM(first_name || ' ' || last_name), '') as name FROM users WHERE id = ANY($1)"#,
                    )
                    .bind(&user_ids_pnl)
                    .fetch_all(&pool)
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
                    rows.into_iter().collect()
                };
                fn pnl_to_f64(d: Option<Decimal>) -> f64 {
                    d.and_then(|x| x.to_string().parse::<f64>().ok()).unwrap_or(0.0)
                }
                fn win_rate_pct(wins: i64, trades: i64) -> u32 {
                    if trades <= 0 {
                        0
                    } else {
                        ((wins as f64 / trades as f64) * 100.0).round().min(100.0).max(0.0) as u32
                    }
                }
                let mut with_meta: Vec<(Uuid, f64, f64, u32)> = pnl_rows
                    .into_iter()
                    .map(|r| {
                        let pnl = pnl_to_f64(r.total_pnl);
                        let vol = pnl_to_f64(r.volume);
                        let wr = win_rate_pct(r.wins, r.trades);
                        (r.user_id, pnl, vol, wr)
                    })
                    .collect();
                // Top traders: by PnL descending
                with_meta.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                let top_traders: Vec<ManagerStatsTraderRow> = with_meta
                    .iter()
                    .take(TOP_TRADERS_LIMIT)
                    .enumerate()
                    .map(|(i, (uid, pnl, vol, wr))| ManagerStatsTraderRow {
                        rank: (i + 1) as u32,
                        user: user_names.get(uid).cloned().unwrap_or_else(|| "—".to_string()),
                        pnl: *pnl,
                        win_rate: *wr,
                        volume: *vol,
                    })
                    .collect();
                // Top losers: by PnL ascending (most negative first)
                with_meta.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                let top_losers: Vec<ManagerStatsTraderRow> = with_meta
                    .iter()
                    .take(TOP_TRADERS_LIMIT)
                    .enumerate()
                    .map(|(i, (uid, pnl, vol, wr))| ManagerStatsTraderRow {
                        rank: (i + 1) as u32,
                        user: user_names.get(uid).cloned().unwrap_or_else(|| "—".to_string()),
                        pnl: *pnl,
                        win_rate: *wr,
                        volume: *vol,
                    })
                    .collect();
                (top_traders, top_losers)
            }
        }
    };

    Ok(Json(ManagerStatisticsResponse {
        overview: ManagerStatsOverview {
            total_users,
            total_groups,
            active_users,
            assigned_leads,
        },
        deposits: ManagerStatsDeposits {
            total_count: deposits_total_count,
            total_volume: deposits_total_volume,
            today_count: deposits_today_count,
            today_volume: deposits_today_volume,
            pending_count: deposits_pending_count,
        },
        withdrawals: ManagerStatsWithdrawals {
            total_count: withdrawals_total_count,
            total_volume: withdrawals_total_volume,
            today_count: withdrawals_today_count,
            today_volume: withdrawals_today_volume,
            pending_count: withdrawals_pending_count,
        },
        positions: ManagerStatsPositions {
            open_count: positions_open_count,
            total_exposure: positions_total_exposure,
            closed_today: positions_closed_today,
            live_pnl: positions_live_pnl,
        },
        orders: ManagerStatsOrders {
            active_count: orders_active_count,
            filled_today: orders_filled_today,
            cancelled_today: orders_cancelled_today,
        },
        recent_deposits,
        recent_withdrawals,
        open_positions,
        recent_orders,
        top_traders,
        top_losers,
    }))
}

async fn create_manager(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<CreateManagerRequest>,
) -> Result<(StatusCode, Json<ManagerResponse>), (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:create")
        .await
        .map_err(permission_denied_to_response)?;

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
        INSERT INTO managers (id, user_id, permission_profile_id, status, notes, created_at, updated_at, created_by_user_id)
        VALUES ($1, $2, $3, 'active', $4, NOW(), NOW(), $5)
        "#,
    )
    .bind(id)
    .bind(payload.user_id)
    .bind(payload.permission_profile_id)
    .bind(payload.notes.as_deref())
    .bind(claims.sub)
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

    // Set role so the user can access the admin panel (AdminGuard allows admin, manager, agent).
    // Use payload.role if it is manager|agent|admin, else default to 'manager'.
    let new_role = payload
        .role
        .as_deref()
        .filter(|r| *r == "manager" || *r == "agent" || *r == "admin")
        .unwrap_or("manager");
    sqlx::query(
        "UPDATE users SET role = $1, permission_profile_id = $2, updated_at = NOW() WHERE id = $3",
    )
    .bind(new_role)
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

    let user_row: (String, String, Option<DateTime<Utc>>, String) = sqlx::query_as(
        "SELECT CONCAT(first_name, ' ', last_name), email, last_login_at, \"role\" FROM users WHERE id = $1",
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

    let creator_email: Option<String> = sqlx::query_scalar::<_, String>("SELECT email FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();

    Ok((
        StatusCode::CREATED,
        Json(ManagerResponse {
            id,
            user_id: payload.user_id,
            user_name: user_row.0,
            user_email: user_row.1,
            user_role: user_row.3,
            permission_profile_id: payload.permission_profile_id,
            permission_profile_name: profile_name,
            status: "active".to_string(),
            notes: payload.notes,
            created_at: Utc::now(),
            last_login_at: user_row.2,
            tag_ids: Some(vec![]),
            created_by_user_id: Some(claims.sub),
            created_by_email: creator_email,
        }),
    ))
}

async fn update_manager(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<UpdateManagerRequest>,
) -> Result<Json<ManagerResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:edit")
        .await
        .map_err(permission_denied_to_response)?;

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

    let current_user_role: String = sqlx::query_scalar("SELECT role FROM users WHERE id = $1")
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

    let is_admin_or_super = current_user_role == "admin" || current_user_role == "super_admin";
    let new_role: String = if let Some(ref r) = payload.role {
        let r = r.trim().to_lowercase();
        if (r == "admin" || r == "super_admin") && is_admin_or_super {
            r
        } else {
            current_user_role.clone()
        }
    } else if new_status == "active" {
        if is_admin_or_super {
            current_user_role
        } else {
            "manager".to_string()
        }
    } else {
        if is_admin_or_super {
            current_user_role
        } else {
            "user".to_string()
        }
    };

    let user_profile_value = if new_status == "active" {
        Some(new_profile_id)
    } else {
        None
    };

    sqlx::query("UPDATE users SET role = $1, permission_profile_id = $2, updated_at = NOW() WHERE id = $3")
        .bind(&new_role)
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

    let (user_name, user_email, last_login_at, user_role): (String, String, Option<DateTime<Utc>>, String) =
        sqlx::query_as(
            "SELECT CONCAT(first_name, ' ', last_name), email, last_login_at, \"role\" FROM users WHERE id = $1",
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

    let (created_at, created_by_user_id, created_by_email): (DateTime<Utc>, Option<Uuid>, Option<String>) =
        sqlx::query_as(
            "SELECT m.created_at, m.created_by_user_id, creator.email FROM managers m \
             LEFT JOIN users creator ON creator.id = m.created_by_user_id WHERE m.id = $1",
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

    Ok(Json(ManagerResponse {
        id,
        user_id,
        user_name,
        user_email,
        user_role,
        permission_profile_id: new_profile_id,
        permission_profile_name: profile_name,
        status: new_status.to_string(),
        notes: new_notes,
        created_at,
        last_login_at,
        tag_ids: None,
        created_by_user_id,
        created_by_email,
    }))
}

async fn delete_manager(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:delete")
        .await
        .map_err(permission_denied_to_response)?;

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
    sqlx::query("UPDATE users SET role = CASE WHEN role IN ('admin', 'super_admin') THEN role ELSE 'user' END, permission_profile_id = NULL, updated_at = NOW() WHERE id = $1")
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

// ---------- Manager tags (GET/PUT /api/admin/manager-tags/:id) ----------

#[derive(Debug, Serialize)]
pub struct ManagerTagsResponse {
    pub tag_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct PutManagerTagsRequest {
    pub tag_ids: Vec<Uuid>,
}

pub fn create_admin_manager_tags_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/:id", get(get_manager_tags).put(put_manager_tags))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_manager_tags(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<ManagerTagsResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:view")
        .await
        .map_err(permission_denied_to_response)?;
    let manager_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM managers WHERE id = $1)")
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
    if !manager_exists {
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
    #[derive(sqlx::FromRow)]
    struct Row { tag_id: Uuid }
    let rows = sqlx::query_as::<_, Row>(
        "SELECT tag_id FROM tag_assignments WHERE entity_type = 'manager' AND entity_id = $1",
    )
    .bind(id)
    .fetch_all(&pool)
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
    let tag_ids = rows.into_iter().map(|r| r.tag_id).collect();
    Ok(Json(ManagerTagsResponse { tag_ids }))
}

async fn put_manager_tags(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<PutManagerTagsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "managers:edit")
        .await
        .map_err(permission_denied_to_response)?;
    let manager_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM managers WHERE id = $1)")
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
    if !manager_exists {
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
    let mut tx = pool.begin().await.map_err(|e| {
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
    sqlx::query("DELETE FROM tag_assignments WHERE entity_type = 'manager' AND entity_id = $1")
        .bind(id)
        .execute(&mut *tx)
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
    for tag_id in &payload.tag_ids {
        sqlx::query(
            "INSERT INTO tag_assignments (tag_id, entity_type, entity_id, created_at) VALUES ($1, 'manager', $2, NOW())",
        )
        .bind(tag_id)
        .bind(id)
        .execute(&mut *tx)
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
    }
    tx.commit().await.map_err(|e| {
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
    Ok(Json(serde_json::json!({ "success": true })))
}
