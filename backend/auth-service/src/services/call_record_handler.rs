//! Handles NATS messages on "admin_call.events" and writes to admin_call_records table.

use anyhow::Result;
use async_nats::Subscriber;
use chrono::Utc;
use futures::StreamExt;
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

#[derive(serde::Deserialize)]
struct CallEventPayload {
    call_id: String,
    admin_user_id: String,
    user_id: String,
    event: String,
    #[serde(default)]
    admin_display_name: Option<String>,
    #[serde(default)]
    ended_by: Option<String>,
    #[serde(default)]
    answered_at_iso: Option<String>,
    #[serde(default)]
    ended_at_iso: Option<String>,
    #[serde(default)]
    duration_seconds: Option<i32>,
}

pub struct CallRecordHandler {
    pool: Arc<PgPool>,
}

impl CallRecordHandler {
    pub fn new(pool: Arc<PgPool>) -> Self {
        Self { pool }
    }

    pub async fn start_listener(&self, mut subscriber: Subscriber) -> Result<()> {
        info!("📡 Subscribed to admin_call.events for call records");

        while let Some(msg) = subscriber.next().await {
            if let Err(e) = self.handle_message(msg.payload.to_vec()).await {
                error!("Failed to handle admin_call.events: {}", e);
            }
        }

        Ok(())
    }

    async fn handle_message(&self, payload: Vec<u8>) -> Result<()> {
        let ev: CallEventPayload = serde_json::from_slice(&payload)?;
        let call_id = Uuid::parse_str(&ev.call_id).map_err(|_| anyhow::anyhow!("invalid call_id"))?;
        let admin_user_id =
            Uuid::parse_str(&ev.admin_user_id).map_err(|_| anyhow::anyhow!("invalid admin_user_id"))?;
        let user_id =
            Uuid::parse_str(&ev.user_id).map_err(|_| anyhow::anyhow!("invalid user_id"))?;

        match ev.event.as_str() {
            "initiated" => {
                sqlx::query(
                    r#"
                    INSERT INTO admin_call_records (call_id, admin_user_id, user_id, status, admin_display_name, updated_at)
                    VALUES ($1, $2, $3, 'ringing', $4, $5)
                    ON CONFLICT (call_id) DO NOTHING
                    "#,
                )
                .bind(call_id)
                .bind(admin_user_id)
                .bind(user_id)
                .bind(ev.admin_display_name.as_deref())
                .bind(Utc::now())
                .execute(self.pool.as_ref())
                .await?;
                info!("Call record initiated: call_id={}", ev.call_id);
            }
            "answered" => {
                let now = Utc::now();
                sqlx::query(
                    r#"
                    UPDATE admin_call_records
                    SET status = 'answered', answered_at = $2, updated_at = $3
                    WHERE call_id = $1
                    "#,
                )
                .bind(call_id)
                .bind(now)
                .bind(now)
                .execute(self.pool.as_ref())
                .await?;
            }
            "rejected" | "ended" | "timeout" => {
                let now = Utc::now();
                let ended_by = ev.ended_by.unwrap_or_else(|| ev.event.clone());
                sqlx::query(
                    r#"
                    UPDATE admin_call_records
                    SET status = $2, ended_at = $3, ended_by = $4, updated_at = $5,
                        duration_seconds = EXTRACT(EPOCH FROM ($3::timestamptz - COALESCE(answered_at, initiated_at)))::integer
                    WHERE call_id = $1
                    "#,
                )
                .bind(call_id)
                .bind(ev.event.as_str())
                .bind(now)
                .bind(ended_by.as_str())
                .bind(now)
                .execute(self.pool.as_ref())
                .await?;
            }
            _ => {}
        }

        Ok(())
    }
}
