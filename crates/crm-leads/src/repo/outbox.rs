use chrono::Utc;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use uuid::Uuid;

const BATCH_SIZE: i64 = 50;

#[derive(Debug, FromRow)]
pub struct OutboxRow {
    pub id: i64,
    pub aggregate_type: String,
    pub aggregate_id: Uuid,
    pub team_id: Uuid,
    pub event_type: String,
    pub payload: serde_json::Value,
}

/// Select pending outbox rows for publishing. Uses FOR UPDATE SKIP LOCKED.
pub async fn select_pending_outbox(pool: &PgPool) -> Result<Vec<OutboxRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, OutboxRow>(
        r#"
        SELECT id, aggregate_type, aggregate_id, team_id, event_type, payload
        FROM crm.outbox_events
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .bind(BATCH_SIZE)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Mark outbox row as published.
pub async fn mark_published(pool: &PgPool, id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE crm.outbox_events SET published_at = $1 WHERE id = $2")
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Increment publish attempts and set last_error on failure.
pub async fn mark_failed(pool: &PgPool, id: i64, err: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE crm.outbox_events SET publish_attempts = publish_attempts + 1, last_error = $1 WHERE id = $2",
    )
    .bind(err)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert outbox event (call within same transaction as the business write).
pub async fn insert_outbox(
    tx: &mut sqlx::PgConnection,
    aggregate_type: &str,
    aggregate_id: Uuid,
    team_id: Uuid,
    event_type: &str,
    payload: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO crm.outbox_events (aggregate_type, aggregate_id, team_id, event_type, payload)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(aggregate_type)
    .bind(aggregate_id)
    .bind(team_id)
    .bind(event_type)
    .bind(payload)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

/// Insert outbox event within a transaction (e.g. from email-worker).
pub async fn insert_outbox_tx(
    tx: &mut Transaction<'_, Postgres>,
    aggregate_type: &str,
    aggregate_id: Uuid,
    team_id: Uuid,
    event_type: &str,
    payload: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO crm.outbox_events (aggregate_type, aggregate_id, team_id, event_type, payload)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(aggregate_type)
    .bind(aggregate_id)
    .bind(team_id)
    .bind(event_type)
    .bind(payload)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
