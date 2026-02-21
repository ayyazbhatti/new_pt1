use crate::domain::{CreateStageInput, LeadStage, UpdateStageInput};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn list_by_team(pool: &PgPool, team_id: Uuid) -> Result<Vec<LeadStage>, sqlx::Error> {
    let rows = sqlx::query_as::<_, LeadStage>(
        r#"
        SELECT id, team_id, name, position, color_token, sla_minutes, require_email, require_phone, created_at
        FROM crm.lead_stages
        WHERE team_id = $1
        ORDER BY position
        "#,
    )
    .bind(team_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_by_id(pool: &PgPool, id: Uuid, team_id: Uuid) -> Result<Option<LeadStage>, sqlx::Error> {
    let row = sqlx::query_as::<_, LeadStage>(
        "SELECT id, team_id, name, position, color_token, sla_minutes, require_email, require_phone, created_at FROM crm.lead_stages WHERE id = $1 AND team_id = $2",
    )
    .bind(id)
    .bind(team_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn create(tx: &mut Transaction<'_, Postgres>, team_id: Uuid, input: &CreateStageInput) -> Result<LeadStage, sqlx::Error> {
    let id = Uuid::new_v4();
    let position = input.position.unwrap_or(0);
    let color_token = input.color_token.as_deref().unwrap_or("accent");
    let sla_minutes = input.sla_minutes.unwrap_or(0);
    let require_email = input.require_email.unwrap_or(false);
    let require_phone = input.require_phone.unwrap_or(false);

    sqlx::query(
        r#"
        INSERT INTO crm.lead_stages (id, team_id, name, position, color_token, sla_minutes, require_email, require_phone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(id)
    .bind(team_id)
    .bind(&input.name)
    .bind(position)
    .bind(color_token)
    .bind(sla_minutes)
    .bind(require_email)
    .bind(require_phone)
    .execute(&mut **tx)
    .await?;

    let now = chrono::Utc::now();
    Ok(LeadStage {
        id,
        team_id,
        name: input.name.clone(),
        position,
        color_token: color_token.to_string(),
        sla_minutes,
        require_email,
        require_phone,
        created_at: now,
    })
}

pub async fn get_by_id_tx(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    team_id: Uuid,
) -> Result<Option<LeadStage>, sqlx::Error> {
    sqlx::query_as::<_, LeadStage>(
        "SELECT id, team_id, name, position, color_token, sla_minutes, require_email, require_phone, created_at FROM crm.lead_stages WHERE id = $1 AND team_id = $2",
    )
    .bind(id)
    .bind(team_id)
    .fetch_optional(&mut **tx)
    .await
}

pub async fn update(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    team_id: Uuid,
    input: &UpdateStageInput,
) -> Result<Option<LeadStage>, sqlx::Error> {
    let mut stage = match get_by_id_tx(tx, id, team_id).await? {
        Some(s) => s,
        None => return Ok(None),
    };
    if let Some(ref v) = input.name {
        stage.name = v.clone();
    }
    if let Some(v) = input.position {
        stage.position = v;
    }
    if let Some(ref v) = input.color_token {
        stage.color_token = v.clone();
    }
    if let Some(v) = input.sla_minutes {
        stage.sla_minutes = v;
    }
    if let Some(v) = input.require_email {
        stage.require_email = v;
    }
    if let Some(v) = input.require_phone {
        stage.require_phone = v;
    }

    sqlx::query(
        r#"
        UPDATE crm.lead_stages SET name = $1, position = $2, color_token = $3, sla_minutes = $4, require_email = $5, require_phone = $6
        WHERE id = $7 AND team_id = $8
        "#,
    )
    .bind(&stage.name)
    .bind(stage.position)
    .bind(&stage.color_token)
    .bind(stage.sla_minutes)
    .bind(stage.require_email)
    .bind(stage.require_phone)
    .bind(id)
    .bind(team_id)
    .execute(&mut **tx)
    .await?;
    Ok(Some(stage))
}
