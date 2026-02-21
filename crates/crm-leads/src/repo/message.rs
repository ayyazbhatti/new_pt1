use crate::domain::{LeadMessage, MessageStatus, MessageType};
use chrono::Utc;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn list_by_lead(pool: &PgPool, lead_id: Uuid, team_id: Uuid) -> Result<Vec<LeadMessage>, sqlx::Error> {
    sqlx::query_as::<_, LeadMessage>(
        r#"
        SELECT id, team_id, lead_id, actor_user_id, message_type, to_email, COALESCE(cc,'{}') as cc, COALESCE(bcc,'{}') as bcc,
               subject, body, status, provider, provider_message_id, error, created_at, updated_at
        FROM crm.lead_messages
        WHERE lead_id = $1 AND team_id = $2
        ORDER BY created_at DESC
        "#,
    )
    .bind(lead_id)
    .bind(team_id)
    .fetch_all(pool)
    .await
}

pub async fn create_queued(
    tx: &mut Transaction<'_, Postgres>,
    team_id: Uuid,
    lead_id: Uuid,
    actor_user_id: Uuid,
    to_email: &str,
    subject: &str,
    body: &str,
    cc: &[String],
    bcc: &[String],
) -> Result<LeadMessage, sqlx::Error> {
    let id = Uuid::new_v4();
    let now = Utc::now();
    sqlx::query(
        r#"
        INSERT INTO crm.lead_messages (id, team_id, lead_id, actor_user_id, message_type, to_email, cc, bcc, subject, body, status)
        VALUES ($1, $2, $3, $4, 'email', $5, $6, $7, $8, $9, 'queued')
        "#,
    )
    .bind(id)
    .bind(team_id)
    .bind(lead_id)
    .bind(actor_user_id)
    .bind(to_email)
    .bind(cc)
    .bind(bcc)
    .bind(subject)
    .bind(body)
    .execute(&mut **tx)
    .await?;
    Ok(LeadMessage {
        id,
        team_id,
        lead_id,
        actor_user_id,
        message_type: MessageType::Email,
        to_email: Some(to_email.to_string()),
        cc: cc.to_vec(),
        bcc: bcc.to_vec(),
        subject: Some(subject.to_string()),
        body: body.to_string(),
        status: MessageStatus::Queued,
        provider: None,
        provider_message_id: None,
        error: None,
        created_at: now,
        updated_at: now,
    })
}

pub async fn get_by_id(pool: &PgPool, id: Uuid, team_id: Uuid) -> Result<Option<LeadMessage>, sqlx::Error> {
    sqlx::query_as::<_, LeadMessage>(
        r#"
        SELECT id, team_id, lead_id, actor_user_id, message_type, to_email, COALESCE(cc,'{}') as cc, COALESCE(bcc,'{}') as bcc,
               subject, body, status, provider, provider_message_id, error, created_at, updated_at
        FROM crm.lead_messages WHERE id = $1 AND team_id = $2
        "#,
    )
    .bind(id)
    .bind(team_id)
    .fetch_optional(pool)
    .await
}

/// Load message by id only (for workers that receive only message_id from queue).
pub async fn get_by_id_any(pool: &PgPool, id: Uuid) -> Result<Option<LeadMessage>, sqlx::Error> {
    sqlx::query_as::<_, LeadMessage>(
        r#"
        SELECT id, team_id, lead_id, actor_user_id, message_type, to_email, COALESCE(cc,'{}') as cc, COALESCE(bcc,'{}') as bcc,
               subject, body, status, provider, provider_message_id, error, created_at, updated_at
        FROM crm.lead_messages WHERE id = $1 AND status = 'queued'
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn mark_sent(pool: &PgPool, id: Uuid, team_id: Uuid, provider: &str, provider_message_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE crm.lead_messages SET status = 'sent', provider = $1, provider_message_id = $2, updated_at = now() WHERE id = $3 AND team_id = $4",
    )
    .bind(provider)
    .bind(provider_message_id)
    .bind(id)
    .bind(team_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_sent_tx(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    team_id: Uuid,
    provider: &str,
    provider_message_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE crm.lead_messages SET status = 'sent', provider = $1, provider_message_id = $2, updated_at = now() WHERE id = $3 AND team_id = $4",
    )
    .bind(provider)
    .bind(provider_message_id)
    .bind(id)
    .bind(team_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn mark_failed(pool: &PgPool, id: Uuid, team_id: Uuid, error: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE crm.lead_messages SET status = 'failed', error = $1, updated_at = now() WHERE id = $2 AND team_id = $3")
        .bind(error)
        .bind(id)
        .bind(team_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_failed_tx(tx: &mut Transaction<'_, Postgres>, id: Uuid, team_id: Uuid, error: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE crm.lead_messages SET status = 'failed', error = $1, updated_at = now() WHERE id = $2 AND team_id = $3")
        .bind(error)
        .bind(id)
        .bind(team_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
