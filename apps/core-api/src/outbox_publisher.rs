//! Outbox publisher: reads crm.outbox_events, publishes to NATS, marks published/failed.
//! Runs as a background task; no polling from API handlers.

use crm_leads::repo::outbox;
use sqlx::PgPool;
use std::time::Duration;
use tracing::{error, info, warn};

const POLL_INTERVAL_MS: u64 = 100;

pub async fn run(db: PgPool, nats: async_nats::Client) {
    let mut interval = tokio::time::interval(Duration::from_millis(POLL_INTERVAL_MS));
    loop {
        interval.tick().await;
        if let Err(e) = tick(&db, &nats).await {
            error!(error = %e, "outbox publisher tick failed");
        }
    }
}

async fn tick(pool: &PgPool, nats: &async_nats::Client) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let rows = outbox::select_pending_outbox(pool).await?;
    for row in rows {
        let subject = row.event_type.clone();
        let payload = row.payload.clone();
        let id = row.id;
        match nats.publish(subject.clone(), payload.to_string().into()).await {
            Ok(()) => {
                if let Err(e) = outbox::mark_published(pool, id).await {
                    error!(outbox_id = id, error = %e, "failed to mark outbox as published");
                } else {
                    info!(outbox_id = id, subject = %subject, "outbox event published");
                }
            }
            Err(e) => {
                let err_msg = e.to_string();
                if let Err(upd) = outbox::mark_failed(pool, id, &err_msg).await {
                    error!(outbox_id = id, error = %upd, "failed to mark outbox as failed");
                } else {
                    warn!(outbox_id = id, subject = %subject, error = %err_msg, "outbox publish failed, marked failed");
                }
            }
        }
    }
    Ok(())
}
