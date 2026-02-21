use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LeadsSettings {
    pub team_id: Uuid,
    pub auto_assign_enabled: bool,
    pub strategy: String,
    pub rr_agent_ids: Vec<Uuid>,
}

pub async fn get(pool: &PgPool, team_id: Uuid) -> Result<Option<LeadsSettings>, sqlx::Error> {
    let row = sqlx::query_as::<_, (Uuid, bool, String, Vec<Uuid>)>(
        "SELECT team_id, auto_assign_enabled, strategy, COALESCE(rr_agent_ids, '{}') FROM crm.leads_settings WHERE team_id = $1",
    )
    .bind(team_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(team_id, auto_assign_enabled, strategy, rr_agent_ids)| LeadsSettings {
        team_id,
        auto_assign_enabled,
        strategy,
        rr_agent_ids,
    }))
}

pub async fn upsert(
    tx: &mut Transaction<'_, Postgres>,
    team_id: Uuid,
    auto_assign_enabled: bool,
    strategy: &str,
    rr_agent_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO crm.leads_settings (team_id, auto_assign_enabled, strategy, rr_agent_ids)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (team_id) DO UPDATE SET auto_assign_enabled = $2, strategy = $3, rr_agent_ids = $4, updated_at = now()
        "#,
    )
    .bind(team_id)
    .bind(auto_assign_enabled)
    .bind(strategy)
    .bind(rr_agent_ids)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
