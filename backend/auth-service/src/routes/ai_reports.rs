//! Admin AI user reports: generate, list, get, delete.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Extension, Router,
};
use chrono::{DateTime, Utc};
use futures::stream::{self, StreamExt};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::error;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::redis_pool::RedisPool;
use crate::routes::scoped_access::{ensure_user_in_allowed_groups, resolve_allowed_group_ids, ErrorDetail, ErrorResponse};
use crate::services::ai::config_service::AiConfigService;
use crate::services::ai::reports::{
    data_gatherer::{
        normalize_sections, SECTION_ADMIN_ACTIVITY, SECTION_AFFILIATE, SECTION_CLOSED_TRADES,
        SECTION_ENGAGEMENT, SECTION_FINANCIAL_ACTIVITY, SECTION_KYC, SECTION_OPEN_POSITIONS,
        SECTION_PROFILE, SECTION_RISK_PROFILE, SECTION_TRADING_PERFORMANCE,
    },
    insert_pending_report, run_report_generation, ReportPlatformConfig,
};
use crate::services::user_events_service::record_user_event_fail_open;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

const ALLOWED_SECTIONS: &[&str] = &[
    SECTION_PROFILE,
    SECTION_TRADING_PERFORMANCE,
    SECTION_OPEN_POSITIONS,
    SECTION_CLOSED_TRADES,
    SECTION_FINANCIAL_ACTIVITY,
    SECTION_RISK_PROFILE,
    SECTION_KYC,
    SECTION_ENGAGEMENT,
    SECTION_AFFILIATE,
    SECTION_ADMIN_ACTIVITY,
];

#[derive(Clone)]
pub struct AiReportsState {
    pub redis: Arc<RedisPool>,
    pub nats: Arc<async_nats::Client>,
}

fn permission_denied(e: permission_check::PermissionDenied) -> (StatusCode, Json<serde_json::Value>) {
    (
        e.status,
        Json(serde_json::json!({ "error": { "code": e.code, "message": e.message } })),
    )
}

fn db_err(e: sqlx::Error) -> (StatusCode, Json<serde_json::Value>) {
    error!("AI reports DB error: {}", e);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
    )
}

fn scoped_err(e: (StatusCode, Json<ErrorResponse>)) -> (StatusCode, Json<serde_json::Value>) {
    let (status, body) = e;
    (
        status,
        Json(serde_json::json!({ "error": { "code": body.error.code, "message": body.error.message } })),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportDto {
    id: String,
    subject_user_id: String,
    generated_by_user_id: Option<String>,
    sections: serde_json::Value,
    focus_prompt: Option<String>,
    content: String,
    model: String,
    tokens_in: Option<i32>,
    tokens_out: Option<i32>,
    status: String,
    error: Option<String>,
    bulk_batch_id: Option<String>,
    created_at: String,
    completed_at: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct ReportRow {
    id: Uuid,
    subject_user_id: Uuid,
    generated_by_user_id: Option<Uuid>,
    sections: serde_json::Value,
    focus_prompt: Option<String>,
    content: String,
    model: String,
    tokens_in: Option<i32>,
    tokens_out: Option<i32>,
    status: String,
    error: Option<String>,
    bulk_batch_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

impl From<ReportRow> for ReportDto {
    fn from(r: ReportRow) -> Self {
        Self {
            id: r.id.to_string(),
            subject_user_id: r.subject_user_id.to_string(),
            generated_by_user_id: r.generated_by_user_id.map(|u| u.to_string()),
            sections: r.sections,
            focus_prompt: r.focus_prompt,
            content: r.content,
            model: r.model,
            tokens_in: r.tokens_in,
            tokens_out: r.tokens_out,
            status: r.status,
            error: r.error,
            bulk_batch_id: r.bulk_batch_id.map(|u| u.to_string()),
            created_at: r.created_at.to_rfc3339(),
            completed_at: r.completed_at.map(|t| t.to_rfc3339()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostGenerateBody {
    subject_user_ids: Vec<String>,
    sections: Vec<String>,
    #[serde(default)]
    focus_prompt: Option<String>,
    idempotency_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostGenerateResponse {
    bulk_batch_id: Option<String>,
    report_ids: Vec<String>,
    started_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListReportsQuery {
    subject_user_id: Option<Uuid>,
    bulk_batch_id: Option<Uuid>,
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ListReportsResponse {
    items: Vec<ReportDto>,
    next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct IdempotencyCache {
    bulk_batch_id: Option<Uuid>,
    report_ids: Vec<Uuid>,
    started_at: String,
}

fn validate_sections(sections: &[String]) -> Result<Vec<String>, (StatusCode, Json<serde_json::Value>)> {
    let normalized = normalize_sections(sections);
    for s in &normalized {
        if s == SECTION_PROFILE {
            continue;
        }
        if !ALLOWED_SECTIONS.contains(&s.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": { "code": "VALIDATION", "message": format!("Unknown section: {}", s) }
                })),
            ));
        }
    }
    if normalized.len() <= 1 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": { "code": "VALIDATION", "message": "Select at least one section besides profile" }
            })),
        ));
    }
    Ok(normalized)
}

async fn ensure_reports_enabled(
    pool: &PgPool,
) -> Result<crate::services::ai::config_service::PlatformAiConfig, (StatusCode, Json<serde_json::Value>)> {
    let config = AiConfigService::get(pool).await.map_err(db_err)?;
    if !config.enabled {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": {
                    "code": "AI_DISABLED",
                    "message": "AI Assistant is disabled. Enable it in Settings → AI."
                }
            })),
        ));
    }
    if !config.reports_enabled {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": {
                    "code": "REPORTS_DISABLED",
                    "message": "AI reports are disabled. Enable them in Settings → AI → Enable AI reports."
                }
            })),
        ));
    }
    Ok(config)
}

async fn check_report_rate_limit(
    redis: &Arc<RedisPool>,
    admin_user_id: Uuid,
    limit: i32,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let epoch_minute = Utc::now().timestamp() / 60;
    let key = format!("ai:report:rate:{}:{}", admin_user_id, epoch_minute);
    let mut conn = redis.get().await.map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": { "code": "REDIS_UNAVAILABLE", "message": "Rate limit check failed" } })),
        )
    })?;
    let count: i32 = redis::cmd("INCR")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": { "code": "RATE_LIMIT_ERROR", "message": "Rate limit check failed" } })),
            )
        })?;
    if count == 1 {
        let _: () = conn.expire(&key, 70).await.map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": { "code": "RATE_LIMIT_ERROR", "message": "Rate limit check failed" } })),
            )
        })?;
    }
    if count > limit {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": { "code": "RATE_LIMITED", "message": "Too many report requests. Please wait." } })),
        ));
    }
    Ok(())
}

async fn check_report_daily_cap(
    pool: &PgPool,
    admin_user_id: Uuid,
    cap: i32,
    additional: usize,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let used: i32 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(reports_generated, 0)
        FROM ai_report_usage_daily
        WHERE admin_user_id = $1 AND date = CURRENT_DATE
        "#,
    )
    .bind(admin_user_id)
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    .unwrap_or(0);

    if used + additional as i32 > cap {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": { "code": "DAILY_CAP_EXCEEDED", "message": "Daily AI report limit reached." } })),
        ));
    }
    Ok(())
}

async fn post_generate(
    State(pool): State<PgPool>,
    Extension(state): Extension<AiReportsState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PostGenerateBody>,
) -> Result<(StatusCode, Json<PostGenerateResponse>), (StatusCode, Json<serde_json::Value>)> {
    let platform_config = ensure_reports_enabled(&pool).await?;
    let report_config = ReportPlatformConfig::from(&platform_config);

    let idempotency_key = body.idempotency_key.trim();
    if idempotency_key.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": { "code": "VALIDATION", "message": "idempotency_key is required" } })),
        ));
    }

    let mut subject_ids: Vec<Uuid> = Vec::new();
    for s in &body.subject_user_ids {
        let id = Uuid::parse_str(s.trim()).map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": { "code": "VALIDATION", "message": format!("Invalid user id: {}", s) } })),
            )
        })?;
        subject_ids.push(id);
    }
    if subject_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": { "code": "VALIDATION", "message": "subject_user_ids is required" } })),
        ));
    }

    let is_bulk = subject_ids.len() > 1;
    if is_bulk {
        permission_check::check_permission(&pool, &claims, "ai_reports:bulk_generate")
            .await
            .map_err(permission_denied)?;
        if subject_ids.len() > report_config.report_bulk_max_users as usize {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": { "code": "VALIDATION", "message": format!("Max {} users per batch", report_config.report_bulk_max_users) }
                })),
            ));
        }
    } else {
        permission_check::check_permission(&pool, &claims, "ai_reports:generate")
            .await
            .map_err(permission_denied)?;
    }

    let sections = validate_sections(&body.sections)?;

    let allowed_group_ids = if claims.role == "admin" || claims.role == "super_admin" {
        None
    } else {
        resolve_allowed_group_ids(&pool, &claims).await.map_err(scoped_err)?
    };

    for uid in &subject_ids {
        ensure_user_in_allowed_groups(&pool, allowed_group_ids.as_deref(), *uid)
            .await
            .map_err(scoped_err)?;
    }

    let redis_key = format!("ai:report:idempo:{}:{}", claims.sub, idempotency_key);
    let mut conn = state.redis.get().await.map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": { "code": "REDIS_UNAVAILABLE", "message": "Idempotency check failed" } })),
        )
    })?;
    if let Ok(Some(cached)) = conn.get::<_, Option<String>>(&redis_key).await {
        if let Ok(parsed) = serde_json::from_str::<IdempotencyCache>(&cached) {
            return Ok((
                StatusCode::ACCEPTED,
                Json(PostGenerateResponse {
                    bulk_batch_id: parsed.bulk_batch_id.map(|u| u.to_string()),
                    report_ids: parsed.report_ids.iter().map(|u| u.to_string()).collect(),
                    started_at: parsed.started_at,
                }),
            ));
        }
    }

    check_report_rate_limit(
        &state.redis,
        claims.sub,
        report_config.report_rate_limit_per_minute,
    )
    .await?;
    check_report_daily_cap(
        &pool,
        claims.sub,
        report_config.report_daily_cap_per_admin,
        subject_ids.len(),
    )
    .await?;

    let api_key = AiConfigService::resolve_api_key(&platform_config).ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": { "code": "AI_NOT_CONFIGURED", "message": "AI provider API key is not configured" } })),
        )
    })?;

    let bulk_batch_id = if is_bulk {
        Some(Uuid::new_v4())
    } else {
        None
    };
    let started_at = Utc::now().to_rfc3339();
    let focus = body
        .focus_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let mut report_ids: Vec<Uuid> = Vec::new();
    for subject_id in &subject_ids {
        let rid = insert_pending_report(
            &pool,
            *subject_id,
            claims.sub,
            &sections,
            focus.as_deref(),
            &report_config.report_model,
            bulk_batch_id,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": { "code": "DB_ERROR", "message": e.to_string() } })),
            )
        })?;
        report_ids.push(rid);
    }

    let cache = IdempotencyCache {
        bulk_batch_id,
        report_ids: report_ids.clone(),
        started_at: started_at.clone(),
    };
    if let Ok(json) = serde_json::to_string(&cache) {
        let _: Result<(), _> = conn.set_ex(&redis_key, json, 3600).await;
    }

    let pool_spawn = pool.clone();
    let redis_spawn = state.redis.clone();
    let nats_spawn = state.nats.clone();
    let config_spawn = report_config.clone();
    let admin_id = claims.sub;
    let sections_spawn = sections.clone();
    let focus_spawn = focus.clone();
    let pairs: Vec<(Uuid, Uuid)> = subject_ids.into_iter().zip(report_ids.iter().copied()).collect();
    let total = pairs.len();
    let batch_id = bulk_batch_id;

    if is_bulk {
        record_user_event_fail_open(
            &pool,
            admin_id,
            Some(admin_id),
            "ai.report.bulk_started",
            "ai",
            None,
            None,
            serde_json::json!({ "bulkBatchId": batch_id, "userCount": total }),
        )
        .await;
    }

    tokio::spawn(async move {
        let completed = Arc::new(AtomicUsize::new(0));
        let concurrency = config_spawn.report_bulk_concurrency.max(1) as usize;

        stream::iter(pairs)
            .for_each_concurrent(concurrency, |(subject_id, report_id)| {
                let pool = pool_spawn.clone();
                let redis = redis_spawn.clone();
                let nats = nats_spawn.clone();
                let config = config_spawn.clone();
                let api_key = api_key.clone();
                let sections = sections_spawn.clone();
                let focus = focus_spawn.clone();
                let completed = Arc::clone(&completed);

                async move {
                    let _ = run_report_generation(
                        pool,
                        redis,
                        nats.clone(),
                        config,
                        api_key,
                        report_id,
                        admin_id,
                        subject_id,
                        sections,
                        focus,
                        batch_id,
                    )
                    .await;

                    if batch_id.is_some() {
                        let n = completed.fetch_add(1, Ordering::SeqCst) + 1;
                        let subject = format!("ai.report.admin.{}", admin_id);
                        if let Ok(bytes) = serde_json::to_vec(&serde_json::json!({
                            "type": "batch_progress",
                            "bulkBatchId": batch_id,
                            "completed": n,
                            "total": total,
                        })) {
                            let _ = nats.publish(subject, bytes.into()).await;
                            let _ = nats.flush().await;
                        }
                    }
                }
            })
            .await;
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(PostGenerateResponse {
            bulk_batch_id: bulk_batch_id.map(|u| u.to_string()),
            report_ids: report_ids.iter().map(|u| u.to_string()).collect(),
            started_at,
        }),
    ))
}

async fn get_report(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<ReportDto>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "ai_reports:view")
        .await
        .map_err(permission_denied)?;

    let row = sqlx::query_as::<_, ReportRow>(
        r#"
        SELECT id, subject_user_id, generated_by_user_id, sections, focus_prompt, content, model,
               tokens_in, tokens_out, status, error, bulk_batch_id, created_at, completed_at
        FROM ai_reports WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(db_err)?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": { "code": "NOT_FOUND", "message": "Report not found" } })),
        )
    })?;

    if claims.role != "admin" && claims.role != "super_admin" {
        let allowed = resolve_allowed_group_ids(&pool, &claims).await.map_err(scoped_err)?;
        ensure_user_in_allowed_groups(&pool, allowed.as_deref(), row.subject_user_id)
            .await
            .map_err(scoped_err)?;
    }

    Ok(Json(row.into()))
}

async fn list_reports(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<ListReportsQuery>,
) -> Result<Json<ListReportsResponse>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "ai_reports:view")
        .await
        .map_err(permission_denied)?;

    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let cursor = query
        .cursor
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));

    let allowed_group_ids = if claims.role == "admin" || claims.role == "super_admin" {
        None
    } else {
        resolve_allowed_group_ids(&pool, &claims).await.map_err(scoped_err)?
    };

    let rows = if let Some(ref ids) = allowed_group_ids {
        if ids.is_empty() {
            vec![]
        } else {
            sqlx::query_as::<_, ReportRow>(
                r#"
                SELECT r.id, r.subject_user_id, r.generated_by_user_id, r.sections, r.focus_prompt,
                       r.content, r.model, r.tokens_in, r.tokens_out, r.status, r.error,
                       r.bulk_batch_id, r.created_at, r.completed_at
                FROM ai_reports r
                JOIN users u ON u.id = r.subject_user_id
                WHERE ($1::uuid IS NULL OR r.subject_user_id = $1)
                  AND ($2::uuid IS NULL OR r.bulk_batch_id = $2)
                  AND ($3::timestamptz IS NULL OR r.created_at < $3)
                  AND u.group_id = ANY($4)
                ORDER BY r.created_at DESC
                LIMIT $5
                "#,
            )
            .bind(query.subject_user_id)
            .bind(query.bulk_batch_id)
            .bind(cursor)
            .bind(ids)
            .bind(limit + 1)
            .fetch_all(&pool)
            .await
            .map_err(db_err)?
        }
    } else {
        sqlx::query_as::<_, ReportRow>(
            r#"
            SELECT id, subject_user_id, generated_by_user_id, sections, focus_prompt, content, model,
                   tokens_in, tokens_out, status, error, bulk_batch_id, created_at, completed_at
            FROM ai_reports
            WHERE ($1::uuid IS NULL OR subject_user_id = $1)
              AND ($2::uuid IS NULL OR bulk_batch_id = $2)
              AND ($3::timestamptz IS NULL OR created_at < $3)
            ORDER BY created_at DESC
            LIMIT $4
            "#,
        )
        .bind(query.subject_user_id)
        .bind(query.bulk_batch_id)
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(&pool)
        .await
        .map_err(db_err)?
    };

    let mut items: Vec<ReportDto> = rows.into_iter().map(ReportDto::from).collect();
    let next_cursor = if items.len() > limit as usize {
        items.pop();
        items.last().map(|r| r.created_at.clone())
    } else {
        None
    };

    Ok(Json(ListReportsResponse { items, next_cursor }))
}

async fn get_batch(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(batch_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "ai_reports:view")
        .await
        .map_err(permission_denied)?;

    let rows = sqlx::query_as::<_, ReportRow>(
        r#"
        SELECT id, subject_user_id, generated_by_user_id, sections, focus_prompt, content, model,
               tokens_in, tokens_out, status, error, bulk_batch_id, created_at, completed_at
        FROM ai_reports
        WHERE bulk_batch_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(batch_id)
    .fetch_all(&pool)
    .await
    .map_err(db_err)?;

    if claims.role != "admin" && claims.role != "super_admin" {
        let allowed = resolve_allowed_group_ids(&pool, &claims).await.map_err(scoped_err)?;
        for row in &rows {
            ensure_user_in_allowed_groups(&pool, allowed.as_deref(), row.subject_user_id)
                .await
                .map_err(scoped_err)?;
        }
    }

    let items: Vec<ReportDto> = rows.into_iter().map(Into::into).collect();
    Ok(Json(serde_json::json!({ "items": items })))
}

async fn delete_report(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "ai_reports:delete")
        .await
        .map_err(permission_denied)?;

    let row = sqlx::query_as::<_, (Uuid,)>("SELECT subject_user_id FROM ai_reports WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": { "code": "NOT_FOUND", "message": "Report not found" } })),
            )
        })?;

    if claims.role != "admin" && claims.role != "super_admin" {
        let allowed = resolve_allowed_group_ids(&pool, &claims).await.map_err(scoped_err)?;
        ensure_user_in_allowed_groups(&pool, allowed.as_deref(), row.0)
            .await
            .map_err(scoped_err)?;
    }

    sqlx::query("DELETE FROM ai_reports WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(db_err)?;

    record_user_event_fail_open(
        &pool,
        row.0,
        Some(claims.sub),
        "ai.report.deleted",
        "ai",
        None,
        None,
        serde_json::json!({ "reportId": id }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

pub fn create_ai_reports_router(
    pool: PgPool,
    redis: Arc<RedisPool>,
    nats: Arc<async_nats::Client>,
) -> Router<PgPool> {
    let state = AiReportsState { redis, nats };
    Router::new()
        .route("/", get(list_reports).post(post_generate))
        .route("/batch/:batch_id", get(get_batch))
        .route("/:id", get(get_report).delete(delete_report))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(Extension(state))
        .with_state(pool)
}
