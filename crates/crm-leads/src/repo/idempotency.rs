use sqlx::PgPool;
use uuid::Uuid;

pub async fn get_response(pool: &PgPool, team_id: Uuid, user_id: Uuid, key: &str) -> Result<Option<serde_json::Value>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, Option<serde_json::Value>>(
        "SELECT response FROM crm.idempotency_keys WHERE team_id = $1 AND user_id = $2 AND key = $3",
    )
    .bind(team_id)
    .bind(user_id)
    .bind(key)
    .fetch_optional(pool)
    .await?;
    Ok(row.flatten())
}

pub async fn insert(
    tx: &mut sqlx::PgConnection,
    team_id: Uuid,
    user_id: Uuid,
    key: &str,
    request_hash: &str,
    response: serde_json::Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO crm.idempotency_keys (team_id, user_id, key, request_hash, response) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (team_id, user_id, key) DO NOTHING"#,
    )
    .bind(team_id)
    .bind(user_id)
    .bind(key)
    .bind(request_hash)
    .bind(response)
    .execute(tx)
    .await?;
    Ok(())
}
