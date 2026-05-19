//! Backfill device_class / device_os / device_browser from user_agent on existing user_events rows.
//! Run after migration 055: cargo run --bin backfill_user_events_device

use auth_service::utils::device_from_ua::{device_from_user_agent, merge_device_into_meta};
use sqlx::Row;
use std::env;
use uuid::Uuid;

const BATCH: i64 = 500;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv::dotenv().ok();
    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = sqlx::PgPool::connect(&database_url).await?;

    let mut total_updated = 0u64;
    loop {
        let rows = sqlx::query(
            r#"
            SELECT id, user_agent, meta
            FROM user_events
            WHERE user_agent IS NOT NULL
              AND TRIM(user_agent) <> ''
              AND NOT (meta ? 'device')
            ORDER BY created_at ASC
            LIMIT $1
            "#,
        )
        .bind(BATCH)
        .fetch_all(&pool)
        .await?;

        if rows.is_empty() {
            break;
        }

        for row in &rows {
            let id: Uuid = row.get("id");
            let ua: String = row.get("user_agent");
            let meta: serde_json::Value = row.get("meta");
            let device = device_from_user_agent(&ua);
            let meta = merge_device_into_meta(meta, &device);

            sqlx::query(
                r#"
                UPDATE user_events
                SET device_class = $2,
                    device_os = $3,
                    device_browser = $4,
                    meta = $5
                WHERE id = $1
                "#,
            )
            .bind(id)
            .bind(device.class)
            .bind(device.os.as_deref())
            .bind(device.browser.as_deref())
            .bind(meta)
            .execute(&pool)
            .await?;
            total_updated += 1;
        }

        println!("device backfill: updated {} rows (batch)", rows.len());
    }

    let by_class: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT device_class, COUNT(*)::bigint AS c
        FROM user_events
        GROUP BY device_class
        ORDER BY c DESC
        "#,
    )
    .fetch_all(&pool)
    .await?;

    println!("device backfill complete: {} rows updated", total_updated);
    for (class, count) in by_class {
        println!("  {}: {}", class, count);
    }

    Ok(())
}
