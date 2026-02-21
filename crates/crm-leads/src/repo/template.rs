use crate::domain::{CreateTemplateInput, EmailTemplate, UpdateTemplateInput};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn list_by_team(pool: &PgPool, team_id: Uuid) -> Result<Vec<EmailTemplate>, sqlx::Error> {
    sqlx::query_as::<_, EmailTemplate>(
        r#"
        SELECT id, team_id, name, subject, body, COALESCE(tags, '{}') as tags, created_at
        FROM crm.email_templates WHERE team_id = $1 ORDER BY name
        "#,
    )
    .bind(team_id)
    .fetch_all(pool)
    .await
}

pub async fn get_by_id(pool: &PgPool, id: Uuid, team_id: Uuid) -> Result<Option<EmailTemplate>, sqlx::Error> {
    sqlx::query_as::<_, EmailTemplate>(
        r#"SELECT id, team_id, name, subject, body, COALESCE(tags, '{}') as tags, created_at FROM crm.email_templates WHERE id = $1 AND team_id = $2"#,
    )
    .bind(id)
    .bind(team_id)
    .fetch_optional(pool)
    .await
}

pub async fn create(tx: &mut Transaction<'_, Postgres>, team_id: Uuid, input: &CreateTemplateInput) -> Result<EmailTemplate, sqlx::Error> {
    let id = Uuid::new_v4();
    let tags = input.tags.clone().unwrap_or_default();
    let now = chrono::Utc::now();
    sqlx::query(
        r#"INSERT INTO crm.email_templates (id, team_id, name, subject, body, tags) VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(id)
    .bind(team_id)
    .bind(&input.name)
    .bind(&input.subject)
    .bind(&input.body)
    .bind(&tags)
    .execute(&mut **tx)
    .await?;
    Ok(EmailTemplate {
        id,
        team_id,
        name: input.name.clone(),
        subject: input.subject.clone(),
        body: input.body.clone(),
        tags,
        created_at: now,
    })
}

pub async fn get_by_id_tx(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    team_id: Uuid,
) -> Result<Option<EmailTemplate>, sqlx::Error> {
    sqlx::query_as::<_, EmailTemplate>(
        r#"SELECT id, team_id, name, subject, body, COALESCE(tags, '{}') as tags, created_at FROM crm.email_templates WHERE id = $1 AND team_id = $2"#,
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
    input: &UpdateTemplateInput,
) -> Result<Option<EmailTemplate>, sqlx::Error> {
    let mut t = match get_by_id_tx(tx, id, team_id).await? {
        Some(x) => x,
        None => return Ok(None),
    };
    if let Some(ref v) = input.name {
        t.name = v.clone();
    }
    if let Some(ref v) = input.subject {
        t.subject = v.clone();
    }
    if let Some(ref v) = input.body {
        t.body = v.clone();
    }
    if let Some(ref v) = input.tags {
        t.tags = v.clone();
    }
    sqlx::query("UPDATE crm.email_templates SET name = $1, subject = $2, body = $3, tags = $4 WHERE id = $5 AND team_id = $6")
        .bind(&t.name)
        .bind(&t.subject)
        .bind(&t.body)
        .bind(&t.tags)
        .bind(id)
        .bind(team_id)
        .execute(&mut **tx)
        .await?;
    Ok(Some(t))
}
