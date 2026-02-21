//! Email worker: consumes NATS leads.email.queued, sends email (stub or SMTP), updates DB, emits outbox events.

use crm_leads::repo::{activity, message, outbox};
use crm_leads::domain::LeadMessage;
use futures_util::StreamExt;
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

const SUBJECT: &str = "leads.email.queued";

#[derive(serde::Deserialize)]
struct QueuedPayload {
    message_id: Uuid,
}

/// Stub sender: no SMTP, just marks as sent (for dev).
fn send_stub(_msg: &LeadMessage) -> Result<(String, String), String> {
    Ok(("stub".to_string(), format!("stub-{}", Uuid::new_v4())))
}

async fn process_message(pool: &PgPool, message_id: Uuid) -> Result<(), anyhow::Error> {
    let msg = match message::get_by_id_any(pool, message_id).await? {
        Some(m) => m,
        None => {
            warn!(message_id = %message_id, "message not found or not queued");
            return Ok(());
        }
    };
    let team_id = msg.team_id;
    let lead_id = msg.lead_id;
    let actor_user_id = msg.actor_user_id;

    let result = send_stub(&msg);

    let mut tx = pool.begin().await?;
    match result {
        Ok((provider, provider_message_id)) => {
            message::mark_sent_tx(&mut tx, msg.id, team_id, &provider, &provider_message_id).await?;
            let payload = serde_json::json!({
                "message_id": msg.id,
                "lead_id": lead_id,
                "team_id": team_id,
                "provider_message_id": provider_message_id,
                "message": { "id": msg.id, "status": "sent" }
            });
            activity::insert_tx(
                &mut tx,
                team_id,
                lead_id,
                actor_user_id,
                "email_sent",
                payload.clone(),
            )
            .await?;
            outbox::insert_outbox_tx(
                &mut tx,
                "lead_message",
                msg.id,
                team_id,
                "leads.email.sent",
                payload,
            )
            .await?;
            tx.commit().await?;
            info!(message_id = %msg.id, "email sent (stub)");
        }
        Err(e) => {
            let err_msg = e.to_string();
            message::mark_failed_tx(&mut tx, msg.id, team_id, &err_msg).await?;
            let payload = serde_json::json!({
                "message_id": msg.id,
                "lead_id": lead_id,
                "team_id": team_id,
                "error": err_msg,
                "message": { "id": msg.id, "status": "failed" }
            });
            activity::insert_tx(
                &mut tx,
                team_id,
                lead_id,
                actor_user_id,
                "email_failed",
                payload.clone(),
            )
            .await?;
            outbox::insert_outbox_tx(
                &mut tx,
                "lead_message",
                msg.id,
                team_id,
                "leads.email.failed",
                payload,
            )
            .await?;
            tx.commit().await?;
            warn!(message_id = %msg.id, error = %err_msg, "email failed");
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter("email-worker=info")
        .json()
        .init();

    let config = common::config::AppConfig::from_env()
        .map_err(|e| format!("Config error: {}", e))?;

    info!("Connecting to database...");
    let pool = PgPool::connect(&config.database_url).await?;
    info!("Connected to database");

    info!("Connecting to NATS at {}", config.nats_url);
    let nats = async_nats::connect(&config.nats_url).await?;
    info!("Connected to NATS");

    let mut sub = nats.subscribe(SUBJECT.to_string()).await?;
    info!("Subscribed to {}", SUBJECT);

    while let Some(nats_msg) = sub.next().await {
        let body = nats_msg.payload.to_vec();
        let payload: QueuedPayload = match serde_json::from_slice(&body) {
            Ok(p) => p,
            Err(e) => {
                error!(error = %e, "invalid leads.email.queued payload");
                continue;
            }
        };
        if let Err(e) = process_message(&pool, payload.message_id).await {
            error!(message_id = %payload.message_id, error = %e, "process_message failed");
        }
    }

    Ok(())
}
