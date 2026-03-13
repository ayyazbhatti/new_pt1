//! Admin Leads API: list, get, create, update, delete, activities, convert.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, patch, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;

#[derive(Debug, Serialize)]
pub struct LeadResponse {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub source: String,
    pub campaign: Option<String>,
    pub status: String,
    pub owner_id: Option<Uuid>,
    pub owner_name: Option<String>,
    pub created_by_id: Option<Uuid>,
    pub created_by_email: Option<String>,
    pub score: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_activity_at: Option<DateTime<Utc>>,
    pub converted_user_id: Option<Uuid>,
    pub converted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct LeadActivityResponse {
    pub id: Uuid,
    pub lead_id: Uuid,
    #[serde(rename = "type")]
    pub type_: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct ListLeadsResponse {
    pub items: Vec<LeadResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListLeadsQuery {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub search: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub owner_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLeadRequest {
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub source: String,
    pub campaign: Option<String>,
    pub status: Option<String>,
    pub owner_id: Option<Uuid>,
    pub score: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateLeadRequest {
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub source: Option<String>,
    pub campaign: Option<String>,
    pub status: Option<String>,
    pub owner_id: Option<Uuid>,
    pub owner_name: Option<String>,
    pub score: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct AddActivityRequest {
    #[serde(rename = "type")]
    pub type_: Option<String>,
    pub content: String,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct ConvertLeadRequest {
    pub user_id: Option<Uuid>,
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

async fn check_leads_permission(
    pool: &PgPool,
    claims: &Claims,
    permission: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role == "admin" || claims.role == "super_admin" {
        return Ok(());
    }
    let profile_id: Option<Uuid> = sqlx::query_scalar("SELECT permission_profile_id FROM users WHERE id = $1")
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
    let pid = match profile_id {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "FORBIDDEN".to_string(),
                        message: "No permission profile assigned".to_string(),
                    },
                }),
            ));
        }
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

const VALID_STATUSES: &[&str] = &[
    "new", "contacted", "qualified", "proposal_sent", "negotiation", "converted", "lost",
];
const VALID_SOURCES: &[&str] = &[
    "website", "landing_page", "demo_request", "chat", "google_ad", "meta_ad", "referral", "event", "other",
];
const VALID_ACTIVITY_TYPES: &[&str] = &["note", "call", "email", "status_change"];

fn valid_status(s: &str) -> bool {
    VALID_STATUSES.contains(&s)
}
fn valid_source(s: &str) -> bool {
    VALID_SOURCES.contains(&s)
}
fn valid_activity_type(s: &str) -> bool {
    VALID_ACTIVITY_TYPES.contains(&s)
}

pub fn create_admin_leads_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_leads).post(create_lead))
        .route("/owners", get(list_owners))
        .route("/:id", get(get_lead).patch(update_lead).delete(delete_lead))
        .route("/:id/activities", get(list_activities).post(add_activity))
        .route("/:id/convert", post(convert_lead))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

#[derive(sqlx::FromRow)]
struct LeadRow {
    id: Uuid,
    name: String,
    email: String,
    phone: Option<String>,
    company: Option<String>,
    source: String,
    campaign: Option<String>,
    status: String,
    owner_id: Option<Uuid>,
    owner_name: Option<String>,
    created_by_id: Option<Uuid>,
    created_by_email: Option<String>,
    score: Option<i32>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_activity_at: Option<DateTime<Utc>>,
    converted_user_id: Option<Uuid>,
    converted_at: Option<DateTime<Utc>>,
}

/// Super admin sees all leads; admin/manager see only leads they created or are assigned to.
fn lead_scope_user_id(claims: &Claims) -> Option<Uuid> {
    if claims.role == "super_admin" {
        None
    } else {
        Some(claims.sub)
    }
}

/// Returns Ok(()) if the user can access the lead (super_admin or created_by/owner), Err(404) otherwise.
async fn ensure_lead_visible(
    pool: &PgPool,
    claims: &Claims,
    lead_id: Uuid,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if lead_scope_user_id(claims).is_none() {
        return Ok(());
    }
    let row: Option<(Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        "SELECT created_by_id, owner_id FROM leads WHERE id = $1",
    )
    .bind(lead_id)
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
    let (created_by, owner_id) = row.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Lead not found".to_string(),
                },
            }),
        )
    })?;
    let uid = claims.sub;
    let can_access = created_by == Some(uid) || owner_id == Some(uid);
    if can_access {
        Ok(())
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Lead not found".to_string(),
                },
            }),
        ))
    }
}

async fn list_leads(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(q): Query<ListLeadsQuery>,
) -> Result<Json<ListLeadsResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:view").await?;

    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).min(100).max(1);
    let offset = (page - 1) * page_size;

    let scope_user = lead_scope_user_id(&claims);

    let search = q
        .search
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{}%", s.to_lowercase()));

    let status = q
        .status
        .as_deref()
        .filter(|s| *s != "all" && valid_status(s));
    let source = q
        .source
        .as_deref()
        .filter(|s| *s != "all" && valid_source(s));

    // Build count and list SQL: optional scope (admin sees only own/assigned), then filters, then LIMIT/OFFSET.
    let mut count_sql = String::from("SELECT COUNT(*)::bigint FROM leads l WHERE 1=1");
    let mut list_sql = String::from(
        "SELECT l.id, l.name, l.email, l.phone, l.company, l.source, l.campaign, l.status,
               l.owner_id, u.email AS owner_name, l.created_by_id, creator.email AS created_by_email, l.score,
               l.created_at, l.updated_at, l.last_activity_at, l.converted_user_id, l.converted_at
        FROM leads l
        LEFT JOIN users u ON u.id = l.owner_id
        LEFT JOIN users creator ON creator.id = l.created_by_id
        WHERE 1=1",
    );
    let mut param_idx = 0i32;
    if scope_user.is_some() {
        param_idx += 1;
        count_sql.push_str(&format!(" AND (l.created_by_id = ${} OR l.owner_id = ${})", param_idx, param_idx));
        list_sql.push_str(&format!(" AND (l.created_by_id = ${} OR l.owner_id = ${})", param_idx, param_idx));
    }
    if search.is_some() {
        param_idx += 1;
        let placeholder = param_idx;
        count_sql.push_str(&format!(
            " AND (LOWER(l.name) LIKE ${} OR LOWER(l.email) LIKE ${} OR LOWER(COALESCE(l.company,'')) LIKE ${})",
            placeholder, placeholder, placeholder
        ));
        list_sql.push_str(&format!(
            " AND (LOWER(l.name) LIKE ${} OR LOWER(l.email) LIKE ${} OR LOWER(COALESCE(l.company,'')) LIKE ${})",
            placeholder, placeholder, placeholder
        ));
    }
    if status.is_some() {
        param_idx += 1;
        count_sql.push_str(&format!(" AND l.status = ${}", param_idx));
        list_sql.push_str(&format!(" AND l.status = ${}", param_idx));
    }
    if source.is_some() {
        param_idx += 1;
        count_sql.push_str(&format!(" AND l.source = ${}", param_idx));
        list_sql.push_str(&format!(" AND l.source = ${}", param_idx));
    }
    if q.owner_id.is_some() {
        param_idx += 1;
        count_sql.push_str(&format!(" AND l.owner_id = ${}", param_idx));
        list_sql.push_str(&format!(" AND l.owner_id = ${}", param_idx));
    }
    let limit_param = param_idx + 1;
    let offset_param = param_idx + 2;
    list_sql.push_str(&format!(
        " ORDER BY l.created_at DESC LIMIT ${} OFFSET ${}",
        limit_param, offset_param
    ));

    let total: i64 = {
        let mut count_query = sqlx::query_scalar::<_, i64>(&count_sql);
        if let Some(uid) = scope_user {
            count_query = count_query.bind(uid);
        }
        if let Some(ref s) = search {
            count_query = count_query.bind(s);
        }
        if let Some(s) = status {
            count_query = count_query.bind(s);
        }
        if let Some(s) = source {
            count_query = count_query.bind(s);
        }
        if let Some(oid) = q.owner_id {
            count_query = count_query.bind(oid);
        }
        count_query
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
            })?
    };

    let mut list_query = sqlx::query_as::<_, LeadRow>(&list_sql);
    if let Some(uid) = scope_user {
        list_query = list_query.bind(uid);
    }
    if let Some(ref s) = search {
        list_query = list_query.bind(s);
    }
    if let Some(s) = status {
        list_query = list_query.bind(s);
    }
    if let Some(s) = source {
        list_query = list_query.bind(s);
    }
    if let Some(oid) = q.owner_id {
        list_query = list_query.bind(oid);
    }
    list_query = list_query.bind(page_size as i64).bind(offset as i64);

    let rows = list_query
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

    let items: Vec<LeadResponse> = rows
        .into_iter()
        .map(|r| LeadResponse {
            id: r.id,
            name: r.name,
            email: r.email,
            phone: r.phone,
            company: r.company,
            source: r.source,
            campaign: r.campaign,
            status: r.status,
            owner_id: r.owner_id,
            owner_name: r.owner_name,
            created_by_id: r.created_by_id,
            created_by_email: r.created_by_email,
            score: r.score,
            created_at: r.created_at,
            updated_at: r.updated_at,
            last_activity_at: r.last_activity_at,
            converted_user_id: r.converted_user_id,
            converted_at: r.converted_at,
        })
        .collect();

    Ok(Json(ListLeadsResponse { items, total }))
}

async fn get_lead(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<LeadResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:view").await?;

    let row: Option<LeadRow> = sqlx::query_as(
        r#"
        SELECT l.id, l.name, l.email, l.phone, l.company, l.source, l.campaign, l.status,
               l.owner_id, u.email AS owner_name, l.created_by_id, creator.email AS created_by_email, l.score,
               l.created_at, l.updated_at, l.last_activity_at, l.converted_user_id, l.converted_at
        FROM leads l
        LEFT JOIN users u ON u.id = l.owner_id
        LEFT JOIN users creator ON creator.id = l.created_by_id
        WHERE l.id = $1
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
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let r = row.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Lead not found".to_string(),
                },
            }),
        )
    })?;

    // Admin/manager: only allow if they created the lead or are assigned as owner
    if let Some(uid) = lead_scope_user_id(&claims) {
        let scope: (Option<Uuid>, Option<Uuid>) = sqlx::query_as(
            "SELECT created_by_id, owner_id FROM leads WHERE id = $1",
        )
        .bind(id)
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
        let can_access = scope.0 == Some(uid) || scope.1 == Some(uid);
        if !can_access {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NOT_FOUND".to_string(),
                        message: "Lead not found".to_string(),
                    },
                }),
            ));
        }
    }

    Ok(Json(LeadResponse {
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        company: r.company,
        source: r.source,
        campaign: r.campaign,
        status: r.status,
        owner_id: r.owner_id,
        owner_name: r.owner_name,
        created_by_id: r.created_by_id,
        created_by_email: r.created_by_email,
        score: r.score,
        created_at: r.created_at,
        updated_at: r.updated_at,
        last_activity_at: r.last_activity_at,
        converted_user_id: r.converted_user_id,
        converted_at: r.converted_at,
    }))
}

async fn create_lead(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::Json(payload): axum::Json<CreateLeadRequest>,
) -> Result<(StatusCode, Json<LeadResponse>), (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:create").await?;

    let email = payload.email.trim();
    if email.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Email is required".to_string(),
                },
            }),
        ));
    }
    let source = payload.source.trim();
    let source = if source.is_empty() || !valid_source(source) {
        "other"
    } else {
        source
    };
    let status = payload
        .status
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| valid_status(s))
        .unwrap_or("new");

    let now = Utc::now();
    let name = payload.name.trim().to_string();
    let name = if name.is_empty() { email.to_string() } else { name };

    let row: LeadRow = sqlx::query_as(
        r#"
        INSERT INTO leads (name, email, phone, company, source, campaign, status, owner_id, score, created_by_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        RETURNING id, name, email, phone, company, source, campaign, status, owner_id, NULL::text AS owner_name, created_by_id, NULL::text AS created_by_email, score, created_at, updated_at, last_activity_at, converted_user_id, converted_at
        "#,
    )
    .bind(&name)
    .bind(email)
    .bind(payload.phone.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(payload.company.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(source)
    .bind(payload.campaign.as_deref().filter(|s| !s.trim().is_empty()))
    .bind(status)
    .bind(payload.owner_id)
    .bind(payload.score)
    .bind(claims.sub)
    .bind(now)
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

    if let Some(notes) = payload.notes.as_deref().filter(|s| !s.trim().is_empty()) {
        let _ = sqlx::query(
            "INSERT INTO lead_activities (lead_id, type, content, created_by, created_at) VALUES ($1, 'note', $2, $3, $4)",
        )
        .bind(row.id)
        .bind(notes)
        .bind(&claims.email)
        .bind(now)
        .execute(&pool)
        .await;
        let _ = sqlx::query("UPDATE leads SET last_activity_at = $1, updated_at = $1 WHERE id = $2")
            .bind(now)
            .bind(row.id)
            .execute(&pool)
            .await;
    }

    // Fetch full row with owner_name and created_by_email (join users) for response
    let full: LeadRow = sqlx::query_as(
        r#"
        SELECT l.id, l.name, l.email, l.phone, l.company, l.source, l.campaign, l.status,
               l.owner_id, u.email AS owner_name, l.created_by_id, creator.email AS created_by_email, l.score,
               l.created_at, l.updated_at, l.last_activity_at, l.converted_user_id, l.converted_at
        FROM leads l
        LEFT JOIN users u ON u.id = l.owner_id
        LEFT JOIN users creator ON creator.id = l.created_by_id
        WHERE l.id = $1
        "#,
    )
    .bind(row.id)
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
    Ok((
        StatusCode::CREATED,
        Json(LeadResponse {
            id: full.id,
            name: full.name,
            email: full.email,
            phone: full.phone,
            company: full.company,
            source: full.source,
            campaign: full.campaign,
            status: full.status,
            owner_id: full.owner_id,
            owner_name: full.owner_name,
            created_by_id: full.created_by_id,
            created_by_email: full.created_by_email,
            score: full.score,
            created_at: full.created_at,
            updated_at: full.updated_at,
            last_activity_at: full.last_activity_at,
            converted_user_id: full.converted_user_id,
            converted_at: full.converted_at,
        }),
    ))
}

async fn update_lead(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<UpdateLeadRequest>,
) -> Result<Json<LeadResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:edit").await?;
    ensure_lead_visible(&pool, &claims, id).await?;

    let existing: Option<(String,)> = sqlx::query_as("SELECT id::text FROM leads WHERE id = $1")
        .bind(id)
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
    if existing.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Lead not found".to_string(),
                },
            }),
        ));
    }

    let now = Utc::now();
    if let Some(ref s) = payload.status {
        if !valid_status(s) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "VALIDATION".to_string(),
                        message: "Invalid status".to_string(),
                    },
                }),
            ));
        }
    }
    if let Some(ref s) = payload.source {
        if !valid_source(s) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "VALIDATION".to_string(),
                        message: "Invalid source".to_string(),
                    },
                }),
            ));
        }
    }

    if payload.name.is_some() {
        sqlx::query("UPDATE leads SET name = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.name.as_deref())
            .bind(now)
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
    if payload.email.is_some() {
        sqlx::query("UPDATE leads SET email = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.email.as_deref())
            .bind(now)
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
    if payload.phone.is_some() {
        sqlx::query("UPDATE leads SET phone = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.phone.as_deref())
            .bind(now)
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
    if payload.company.is_some() {
        sqlx::query("UPDATE leads SET company = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.company.as_deref())
            .bind(now)
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
    if payload.source.is_some() {
        sqlx::query("UPDATE leads SET source = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.source.as_deref())
            .bind(now)
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
    if payload.campaign.is_some() {
        sqlx::query("UPDATE leads SET campaign = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.campaign.as_deref())
            .bind(now)
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
    if payload.status.is_some() {
        sqlx::query("UPDATE leads SET status = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.status.as_deref())
            .bind(now)
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
    if payload.owner_id.is_some() || payload.owner_name.is_some() {
        sqlx::query("UPDATE leads SET owner_id = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.owner_id)
            .bind(now)
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
    if payload.score.is_some() {
        sqlx::query("UPDATE leads SET score = $1, updated_at = $2 WHERE id = $3")
            .bind(payload.score)
            .bind(now)
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

    let row: LeadRow = sqlx::query_as(
        r#"
        SELECT l.id, l.name, l.email, l.phone, l.company, l.source, l.campaign, l.status,
               l.owner_id, u.email AS owner_name, l.created_by_id, creator.email AS created_by_email, l.score,
               l.created_at, l.updated_at, l.last_activity_at, l.converted_user_id, l.converted_at
        FROM leads l
        LEFT JOIN users u ON u.id = l.owner_id
        LEFT JOIN users creator ON creator.id = l.created_by_id
        WHERE l.id = $1
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
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(Json(LeadResponse {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        company: row.company,
        source: row.source,
        campaign: row.campaign,
        status: row.status,
        owner_id: row.owner_id,
        owner_name: row.owner_name,
        created_by_id: row.created_by_id,
        created_by_email: row.created_by_email,
        score: row.score,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_activity_at: row.last_activity_at,
        converted_user_id: row.converted_user_id,
        converted_at: row.converted_at,
    }))
}

async fn delete_lead(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:delete").await?;
    ensure_lead_visible(&pool, &claims, id).await?;

    let result = sqlx::query("DELETE FROM leads WHERE id = $1")
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
                    message: "Lead not found".to_string(),
                },
            }),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(sqlx::FromRow)]
struct ActivityRow {
    id: Uuid,
    lead_id: Uuid,
    type_: String,
    content: String,
    created_at: DateTime<Utc>,
    created_by: String,
    meta: Option<serde_json::Value>,
}

async fn list_activities(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:view").await?;
    ensure_lead_visible(&pool, &claims, id).await?;

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM leads WHERE id = $1)")
        .bind(id)
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
    if !exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Lead not found".to_string(),
                },
            }),
        ));
    }

    let rows: Vec<ActivityRow> = sqlx::query_as(
        r#"SELECT id, lead_id, type AS "type_", content, created_at, created_by, meta FROM lead_activities WHERE lead_id = $1 ORDER BY created_at DESC"#,
    )
    .bind(id)
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

    let items: Vec<LeadActivityResponse> = rows
        .into_iter()
        .map(|r| LeadActivityResponse {
            id: r.id,
            lead_id: r.lead_id,
            type_: r.type_,
            content: r.content,
            created_at: r.created_at,
            created_by: r.created_by,
            meta: r.meta,
        })
        .collect();

    Ok(Json(serde_json::json!({ "items": items })))
}

async fn add_activity(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<AddActivityRequest>,
) -> Result<(StatusCode, Json<LeadActivityResponse>), (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:edit").await?;
    ensure_lead_visible(&pool, &claims, id).await?;

    let content = payload.content.trim();
    if content.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "Content is required".to_string(),
                },
            }),
        ));
    }
    let type_ = payload
        .type_
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| valid_activity_type(s))
        .unwrap_or("note");

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM leads WHERE id = $1)")
        .bind(id)
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
    if !exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Lead not found".to_string(),
                },
            }),
        ));
    }

    let now = Utc::now();
    let meta = payload.meta.unwrap_or(serde_json::json!({}));

    let row: ActivityRow = sqlx::query_as(
        r#"INSERT INTO lead_activities (lead_id, type, content, created_by, created_at, meta) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, lead_id, type AS "type_", content, created_at, created_by, meta"#,
    )
    .bind(id)
    .bind(type_)
    .bind(content)
    .bind(&claims.email)
    .bind(now)
    .bind(&meta)
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

    let _ = sqlx::query("UPDATE leads SET last_activity_at = $1, updated_at = $1 WHERE id = $2")
        .bind(now)
        .bind(id)
        .execute(&pool)
        .await;

    Ok((
        StatusCode::CREATED,
        Json(LeadActivityResponse {
            id: row.id,
            lead_id: row.lead_id,
            type_: row.type_,
            content: row.content,
            created_at: row.created_at,
            created_by: row.created_by,
            meta: row.meta,
        }),
    ))
}

async fn convert_lead(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Path(id): Path<Uuid>,
    axum::Json(payload): axum::Json<ConvertLeadRequest>,
) -> Result<Json<LeadResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:convert").await?;
    ensure_lead_visible(&pool, &claims, id).await?;

    let now = Utc::now();
    let result = sqlx::query(
        "UPDATE leads SET status = 'converted', converted_user_id = $1, converted_at = $2, updated_at = $2 WHERE id = $3",
    )
    .bind(payload.user_id)
    .bind(now)
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
                    message: "Lead not found".to_string(),
                },
            }),
        ));
    }

    let _ = sqlx::query(
        "INSERT INTO lead_activities (lead_id, type, content, created_by, created_at) VALUES ($1, 'status_change', 'Lead converted to customer.', $2, $3)",
    )
    .bind(id)
    .bind(&claims.email)
    .bind(now)
    .execute(&pool)
    .await;

    let row: LeadRow = sqlx::query_as(
        r#"
        SELECT l.id, l.name, l.email, l.phone, l.company, l.source, l.campaign, l.status,
               l.owner_id, u.email AS owner_name, l.created_by_id, creator.email AS created_by_email, l.score,
               l.created_at, l.updated_at, l.last_activity_at, l.converted_user_id, l.converted_at
        FROM leads l
        LEFT JOIN users u ON u.id = l.owner_id
        LEFT JOIN users creator ON creator.id = l.created_by_id
        WHERE l.id = $1
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
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(Json(LeadResponse {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        company: row.company,
        source: row.source,
        campaign: row.campaign,
        status: row.status,
        owner_id: row.owner_id,
        owner_name: row.owner_name,
        created_by_id: row.created_by_id,
        created_by_email: row.created_by_email,
        score: row.score,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_activity_at: row.last_activity_at,
        converted_user_id: row.converted_user_id,
        converted_at: row.converted_at,
    }))
}

#[derive(Serialize)]
struct OwnerItem {
    id: Uuid,
    name: String,
    email: String,
}

async fn list_owners(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<Vec<OwnerItem>>, (StatusCode, Json<ErrorResponse>)> {
    check_leads_permission(&pool, &claims, "leads:view").await?;

    let rows = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT id, COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email) AS name, email FROM users WHERE role IN ('admin', 'super_admin', 'manager') AND status = 'active' AND deleted_at IS NULL ORDER BY email LIMIT 200",
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

    let items: Vec<OwnerItem> = rows
        .into_iter()
        .map(|(id, name, email)| OwnerItem { id, name, email })
        .collect();
    Ok(Json(items))
}
