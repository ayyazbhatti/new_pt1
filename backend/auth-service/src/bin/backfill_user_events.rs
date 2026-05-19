//! Backfill user_events from audit_logs and user_sessions.
//! Run: cargo run --bin backfill_user_events

use std::env;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = sqlx::PgPool::connect(&database_url).await?;

    let audit = sqlx::query(
        r#"
        INSERT INTO user_events (
          subject_user_id, actor_user_id, event_type, category, ip, user_agent, meta, created_at
        )
        SELECT
          al.actor_user_id,
          al.actor_user_id,
          al.action,
          'auth',
          NULLIF(TRIM(al.meta->>'ip'), ''),
          NULLIF(TRIM(al.meta->>'user_agent'), ''),
          COALESCE(al.meta, '{}'::jsonb),
          al.created_at
        FROM audit_logs al
        WHERE al.actor_user_id IS NOT NULL
          AND al.action IN ('auth.register', 'auth.login', 'auth.logout')
          AND NOT EXISTS (
            SELECT 1 FROM user_events ue
            WHERE ue.subject_user_id = al.actor_user_id
              AND ue.event_type = al.action
              AND ue.created_at = al.created_at
          )
        "#,
    )
    .execute(&pool)
    .await?;
    println!("audit_logs backfill: {} rows inserted", audit.rows_affected());

    let sessions = sqlx::query(
        r#"
        INSERT INTO user_events (
          subject_user_id, actor_user_id, event_type, category, ip, user_agent, meta, created_at
        )
        SELECT
          us.user_id,
          us.user_id,
          'auth.session_created',
          'auth',
          us.ip,
          us.user_agent,
          jsonb_build_object('session_id', us.id::text),
          us.created_at
        FROM user_sessions us
        WHERE NOT EXISTS (
          SELECT 1 FROM user_events ue
          WHERE ue.subject_user_id = us.user_id
            AND ue.event_type = 'auth.session_created'
            AND ue.created_at = us.created_at
        )
        "#,
    )
    .execute(&pool)
    .await?;
    println!("user_sessions backfill: {} rows inserted", sessions.rows_affected());

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM user_events")
        .fetch_one(&pool)
        .await?;
    println!("user_events total rows: {}", count);
    Ok(())
}
