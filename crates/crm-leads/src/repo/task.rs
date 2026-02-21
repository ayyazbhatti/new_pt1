use crate::domain::{CreateTaskInput, LeadTask};
use chrono::Utc;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub async fn list_by_lead(pool: &PgPool, lead_id: Uuid, team_id: Uuid) -> Result<Vec<LeadTask>, sqlx::Error> {
    sqlx::query_as::<_, LeadTask>(
        r#"
        SELECT id, team_id, lead_id, assigned_to_user_id, task_type, due_at, completed_at, status, priority, notes, created_at
        FROM crm.lead_tasks
        WHERE lead_id = $1 AND team_id = $2
        ORDER BY due_at
        "#,
    )
    .bind(lead_id)
    .bind(team_id)
    .fetch_all(pool)
    .await
}

pub async fn create(tx: &mut Transaction<'_, Postgres>, team_id: Uuid, lead_id: Uuid, input: &CreateTaskInput) -> Result<LeadTask, sqlx::Error> {
    let id = Uuid::new_v4();
    let priority = input.priority.as_ref().map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|| "normal".to_string());
    sqlx::query(
        r#"
        INSERT INTO crm.lead_tasks (id, team_id, lead_id, assigned_to_user_id, task_type, due_at, status, priority, notes)
        VALUES ($1, $2, $3, $4, $5::text, $6, 'pending', $7, $8)
        "#,
    )
    .bind(id)
    .bind(team_id)
    .bind(lead_id)
    .bind(input.assigned_to_user_id)
    .bind(format!("{:?}", input.task_type).to_lowercase())
    .bind(input.due_at)
    .bind(priority)
    .bind(&input.notes)
    .execute(&mut **tx)
    .await?;
    let now = Utc::now();
    Ok(LeadTask {
        id,
        team_id,
        lead_id,
        assigned_to_user_id: input.assigned_to_user_id,
        task_type: input.task_type,
        due_at: input.due_at,
        completed_at: None,
        status: crate::domain::TaskStatus::Pending,
        priority: input.priority.unwrap_or(crate::domain::LeadPriority::Normal),
        notes: input.notes.clone(),
        created_at: now,
    })
}

pub async fn complete(pool: &PgPool, task_id: Uuid, team_id: Uuid) -> Result<Option<LeadTask>, sqlx::Error> {
    let now = Utc::now();
    sqlx::query("UPDATE crm.lead_tasks SET status = 'completed', completed_at = $1 WHERE id = $2 AND team_id = $3")
        .bind(now)
        .bind(task_id)
        .bind(team_id)
        .execute(pool)
        .await?;
    sqlx::query_as::<_, LeadTask>(
        "SELECT id, team_id, lead_id, assigned_to_user_id, task_type, due_at, completed_at, status, priority, notes, created_at FROM crm.lead_tasks WHERE id = $1 AND team_id = $2",
    )
    .bind(task_id)
    .bind(team_id)
    .fetch_optional(pool)
    .await
}
