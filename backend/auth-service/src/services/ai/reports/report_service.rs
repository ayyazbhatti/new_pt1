//! Orchestrate AI report generation: gather data, stream from Anthropic, persist, NATS events.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use anyhow::{anyhow, Result};
use async_nats::Client as NatsClient;
use futures::stream::{self, StreamExt};
use serde_json::json;
use sqlx::PgPool;
use tokio::sync::mpsc;
use tracing::{error, warn};
use uuid::Uuid;

use crate::redis_pool::RedisPool;
use crate::services::ai::config_service::PlatformAiConfig;
use crate::services::ai::{provider_from_key, AiConfigService, AiDelta, AiMessage};
use crate::services::user_events_service::record_user_event_fail_open;

use super::data_gatherer::{gather_report_data, normalize_sections};
use super::prompt_builder::build_report_prompt;

impl From<&PlatformAiConfig> for ReportPlatformConfig {
    fn from(c: &PlatformAiConfig) -> Self {
        Self {
            enabled: c.enabled,
            reports_enabled: c.reports_enabled,
            report_model: c.report_model.clone(),
            report_max_tokens: c.report_max_tokens,
            report_daily_cap_per_admin: c.report_daily_cap_per_admin,
            report_rate_limit_per_minute: c.report_rate_limit_per_minute,
            report_bulk_max_users: c.report_bulk_max_users,
            report_bulk_concurrency: c.report_bulk_concurrency,
            report_system_prompt: c.report_system_prompt.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReportPlatformConfig {
    pub enabled: bool,
    pub reports_enabled: bool,
    pub report_model: String,
    pub report_max_tokens: i32,
    pub report_daily_cap_per_admin: i32,
    pub report_rate_limit_per_minute: i32,
    pub report_bulk_max_users: i32,
    pub report_bulk_concurrency: i32,
    pub report_system_prompt: Option<String>,
}

/// Load platform AI + report settings from DB (includes API key for provider).
pub async fn load_report_platform_config(pool: &PgPool) -> Result<(ReportPlatformConfig, String)> {
    let full = AiConfigService::get(pool).await?;
    let api_key = AiConfigService::resolve_api_key(&full)
        .ok_or_else(|| anyhow!("AI provider API key is not configured"))?;
    Ok((ReportPlatformConfig::from(&full), api_key))
}

async fn publish_report_event(nats: &NatsClient, admin_user_id: Uuid, payload: serde_json::Value) {
    let subject = format!("ai.report.admin.{}", admin_user_id);
    match serde_json::to_vec(&payload) {
        Ok(bytes) => {
            if let Err(e) = nats.publish(subject.clone(), bytes.into()).await {
                error!("Failed to publish report event to {}: {}", subject, e);
            } else if let Err(e) = nats.flush().await {
                error!("Failed to flush NATS after report publish: {}", e);
            }
        }
        Err(e) => error!("Failed to serialize report NATS payload: {}", e),
    }
}

/// Insert a pending report row and return its id.
pub async fn insert_pending_report(
    pool: &PgPool,
    subject_user_id: Uuid,
    generated_by_user_id: Uuid,
    sections: &[String],
    focus_prompt: Option<&str>,
    model: &str,
    bulk_batch_id: Option<Uuid>,
) -> Result<Uuid> {
    let sections_norm = normalize_sections(sections);
    let sections_json = serde_json::to_value(&sections_norm)?;
    let report_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO ai_reports (
          subject_user_id, generated_by_user_id, sections, focus_prompt, model,
          status, bulk_batch_id
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        RETURNING id
        "#,
    )
    .bind(subject_user_id)
    .bind(generated_by_user_id)
    .bind(sections_json)
    .bind(focus_prompt.filter(|s| !s.trim().is_empty()))
    .bind(model)
    .bind(bulk_batch_id)
    .fetch_one(pool)
    .await?;

    Ok(report_id)
}

/// Run streaming generation for an existing report row.
pub async fn run_report_generation(
    pool: PgPool,
    redis: Arc<RedisPool>,
    nats: Arc<NatsClient>,
    config: ReportPlatformConfig,
    api_key: String,
    report_id: Uuid,
    admin_user_id: Uuid,
    subject_user_id: Uuid,
    sections: Vec<String>,
    focus_prompt: Option<String>,
    bulk_batch_id: Option<Uuid>,
) -> Result<()> {
    sqlx::query("UPDATE ai_reports SET status = 'streaming' WHERE id = $1")
        .bind(report_id)
        .execute(&pool)
        .await?;

    publish_report_event(
        &nats,
        admin_user_id,
        json!({
            "type": "started",
            "reportId": report_id,
            "subjectUserId": subject_user_id,
            "bulkBatchId": bulk_batch_id,
        }),
    )
    .await;

    let sections_norm = normalize_sections(&sections);
    let data = match gather_report_data(&pool, redis.as_ref(), subject_user_id, &sections_norm).await {
        Ok(d) => d,
        Err(e) => {
            let msg = format!("Failed to gather report data: {}", e);
            return fail_report(
                &pool,
                &nats,
                report_id,
                admin_user_id,
                subject_user_id,
                bulk_batch_id,
                &msg,
            )
            .await;
        }
    };

    let focus_ref = focus_prompt.as_deref();
    let (system_prompt, user_prompt) = build_report_prompt(
        &data,
        focus_ref,
        config.report_system_prompt.as_deref(),
    );

    let provider = provider_from_key(api_key, config.report_model.clone());
    let max_tokens = config.report_max_tokens.max(256) as u32;
    let (tx, mut rx) = mpsc::channel::<AiDelta>(64);

    let stream_handle = tokio::spawn(async move {
        provider
            .stream_chat(
                system_prompt,
                vec![AiMessage {
                    role: "user".to_string(),
                    content: user_prompt,
                }],
                max_tokens,
                tx,
            )
            .await
    });

    let mut buffer = String::new();
    let mut usage_in: u32 = 0;
    let mut usage_out: u32 = 0;

    while let Some(delta) = rx.recv().await {
        match delta {
            AiDelta::Text(chunk) => {
                buffer.push_str(&chunk);
                publish_report_event(
                    &nats,
                    admin_user_id,
                    json!({
                        "type": "delta",
                        "reportId": report_id,
                        "text": chunk,
                    }),
                )
                .await;
            }
            AiDelta::Done => break,
            AiDelta::Error(msg) => {
                let _ = stream_handle.await;
                return fail_report(
                    &pool,
                    &nats,
                    report_id,
                    admin_user_id,
                    subject_user_id,
                    bulk_batch_id,
                    &msg,
                )
                .await;
            }
        }
    }

    let usage = match stream_handle.await {
        Ok(Ok(u)) => u,
        Ok(Err(e)) => {
            return fail_report(
                &pool,
                &nats,
                report_id,
                admin_user_id,
                subject_user_id,
                bulk_batch_id,
                &e.to_string(),
            )
            .await;
        }
        Err(e) => {
            return fail_report(
                &pool,
                &nats,
                report_id,
                admin_user_id,
                subject_user_id,
                bulk_batch_id,
                &e.to_string(),
            )
            .await;
        }
    };
    usage_in = usage.tokens_in;
    usage_out = usage.tokens_out;

    sqlx::query(
        r#"
        UPDATE ai_reports
        SET content = $1, tokens_in = $2, tokens_out = $3,
            status = 'completed', completed_at = NOW(), error = NULL
        WHERE id = $4
        "#,
    )
    .bind(&buffer)
    .bind(usage_in as i32)
    .bind(usage_out as i32)
    .bind(report_id)
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO ai_report_usage_daily (admin_user_id, date, reports_generated, tokens_in, tokens_out)
        VALUES ($1, CURRENT_DATE, 1, $2, $3)
        ON CONFLICT (admin_user_id, date) DO UPDATE SET
          reports_generated = ai_report_usage_daily.reports_generated + 1,
          tokens_in = ai_report_usage_daily.tokens_in + EXCLUDED.tokens_in,
          tokens_out = ai_report_usage_daily.tokens_out + EXCLUDED.tokens_out
        "#,
    )
    .bind(admin_user_id)
    .bind(usage_in as i32)
    .bind(usage_out as i32)
    .execute(&pool)
    .await?;

    publish_report_event(
        &nats,
        admin_user_id,
        json!({
            "type": "done",
            "reportId": report_id,
            "bulkBatchId": bulk_batch_id,
        }),
    )
    .await;

    record_user_event_fail_open(
        &pool,
        subject_user_id,
        Some(admin_user_id),
        "ai.report.generated",
        "ai",
        None,
        None,
        json!({
            "reportId": report_id,
            "bulkBatchId": bulk_batch_id,
            "tokensIn": usage_in,
            "tokensOut": usage_out,
        }),
    )
    .await;

    Ok(())
}

async fn fail_report(
    pool: &PgPool,
    nats: &NatsClient,
    report_id: Uuid,
    admin_user_id: Uuid,
    subject_user_id: Uuid,
    bulk_batch_id: Option<Uuid>,
    message: &str,
) -> Result<()> {
    warn!(
        report_id = %report_id,
        error = %message,
        "AI report generation failed"
    );

    sqlx::query(
        r#"
        UPDATE ai_reports
        SET status = 'failed', error = $1, completed_at = NOW()
        WHERE id = $2
        "#,
    )
    .bind(message)
    .bind(report_id)
    .execute(pool)
    .await?;

    publish_report_event(
        nats,
        admin_user_id,
        json!({
            "type": "error",
            "reportId": report_id,
            "message": message,
            "bulkBatchId": bulk_batch_id,
        }),
    )
    .await;

    record_user_event_fail_open(
        pool,
        subject_user_id,
        Some(admin_user_id),
        "ai.report.failed",
        "ai",
        None,
        None,
        json!({ "reportId": report_id, "message": message }),
    )
    .await;

    Ok(())
}

/// Generate one report: insert row then stream (blocking until complete).
pub async fn generate_single_report(
    pool: PgPool,
    redis: Arc<RedisPool>,
    nats: Arc<NatsClient>,
    config: ReportPlatformConfig,
    api_key: String,
    admin_user_id: Uuid,
    subject_user_id: Uuid,
    sections: Vec<String>,
    focus_prompt: Option<String>,
    bulk_batch_id: Option<Uuid>,
) -> Result<Uuid> {
    let report_id = insert_pending_report(
        &pool,
        subject_user_id,
        admin_user_id,
        &sections,
        focus_prompt.as_deref(),
        &config.report_model,
        bulk_batch_id,
    )
    .await?;

    run_report_generation(
        pool,
        redis,
        nats,
        config,
        api_key,
        report_id,
        admin_user_id,
        subject_user_id,
        sections,
        focus_prompt,
        bulk_batch_id,
    )
    .await?;

    Ok(report_id)
}

/// Start bulk report generation; returns batch id immediately (work runs in background).
pub async fn generate_bulk_reports(
    pool: PgPool,
    redis: Arc<RedisPool>,
    nats: Arc<NatsClient>,
    config: ReportPlatformConfig,
    api_key: String,
    admin_user_id: Uuid,
    subject_user_ids: Vec<Uuid>,
    sections: Vec<String>,
    focus_prompt: Option<String>,
) -> Result<Uuid> {
    if subject_user_ids.len() > config.report_bulk_max_users as usize {
        return Err(anyhow!(
            "Too many users: max {}",
            config.report_bulk_max_users
        ));
    }

    let bulk_batch_id = Uuid::new_v4();
    let total = subject_user_ids.len();
    let completed = Arc::new(AtomicUsize::new(0));

    record_user_event_fail_open(
        &pool,
        admin_user_id,
        Some(admin_user_id),
        "ai.report.bulk_started",
        "ai",
        None,
        None,
        json!({
            "bulkBatchId": bulk_batch_id,
            "userCount": total,
        }),
    )
    .await;

    let concurrency = config.report_bulk_concurrency.max(1) as usize;
    let sections_arc = sections.clone();
    let focus_arc = focus_prompt.clone();
    let config_clone = config.clone();
    let api_key_clone = api_key.clone();

    tokio::spawn(async move {
        stream::iter(subject_user_ids)
            .for_each_concurrent(concurrency, |subject_id| {
                let pool = pool.clone();
                let redis = redis.clone();
                let nats = nats.clone();
                let config = config_clone.clone();
                let api_key = api_key_clone.clone();
                let sections = sections_arc.clone();
                let focus = focus_arc.clone();
                let completed = Arc::clone(&completed);
                let bulk_batch_id = bulk_batch_id;

                async move {
                    let result = generate_single_report(
                        pool.clone(),
                        redis,
                        nats.clone(),
                        config,
                        api_key,
                        admin_user_id,
                        subject_id,
                        sections,
                        focus,
                        Some(bulk_batch_id),
                    )
                    .await;

                    if let Err(e) = result {
                        error!(
                            subject_user_id = %subject_id,
                            bulk_batch_id = %bulk_batch_id,
                            error = %e,
                            "bulk report item failed"
                        );
                    }

                    let n = completed.fetch_add(1, Ordering::SeqCst) + 1;
                    publish_report_event(
                        &nats,
                        admin_user_id,
                        json!({
                            "type": "batch_progress",
                            "bulkBatchId": bulk_batch_id,
                            "completed": n,
                            "total": total,
                        }),
                    )
                    .await;
                }
            })
            .await;
    });

    Ok(bulk_batch_id)
}
