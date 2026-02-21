use crate::domain::LeadActivity;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn list_by_lead(pool: &PgPool, lead_id: Uuid, team_id: Uuid) -> Result<Vec<LeadActivity>, sqlx::Error> {
    sqlx::query_as::<_, LeadActivity>(
        r#"
        SELECT id, team_id, lead_id, actor_user_id, activity_type, COALESCE(payload, '{}'::jsonb) as payload, created_at
        FROM crm.lead_activities
        WHERE lead_id = $1 AND team_id = $2
        ORDER BY created_at DESC
        "#,
    )
    .bind(lead_id)
    .bind(team_id)
    .fetch_all(pool)
    .await
}

pub async fn insert(
    tx: &mut sqlx::PgConnection,
    team_id: Uuid,
    lead_id: Uuid,
    actor_user_id: Uuid,
    activity_type: &str,
    payload: serde_json::Value,
) -> Result<LeadActivity, sqlx::Error> {
    let id = Uuid::new_v4();
    let now = chrono::Utc::now();
    sqlx::query(
        r#"
        INSERT INTO crm.lead_activities (id, team_id, lead_id, actor_user_id, activity_type, payload)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(id)
    .bind(team_id)
    .bind(lead_id)
    .bind(actor_user_id)
    .bind(activity_type)
    .bind(&payload)
    .execute(tx)
    .await?;
    Ok(LeadActivity {
        id,
        team_id,
        lead_id,
        actor_user_id,
        activity_type: activity_type.to_string(),
        payload,
        created_at: now,
    })
}

pub async fn insert_tx(
    tx: &mut Transaction<'_, Postgres>,
    team_id: Uuid,
    lead_id: Uuid,
    actor_user_id: Uuid,
    activity_type: &str,
    payload: serde_json::Value,
) -> Result<LeadActivity, sqlx::Error> {
    let id = Uuid::new_v4();
    let now = chrono::Utc::now();
    sqlx::query(
        r#"
        INSERT INTO crm.lead_activities (id, team_id, lead_id, actor_user_id, activity_type, payload)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(id)
    .bind(team_id)
    .bind(lead_id)
    .bind(actor_user_id)
    .bind(activity_type)
    .bind(&payload)
    .execute(&mut **tx)
    .await?;
    Ok(LeadActivity {
        id,
        team_id,
        lead_id,
        actor_user_id,
        activity_type: activity_type.to_string(),
        payload,
        created_at: now,
    })
}
