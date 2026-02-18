//! Warms Redis account summary cache (pos:summary:{user_id}) for all users on startup
//! so every user's data is in Redis, not only users who have logged in or loaded summary.

use crate::routes::deposits::compute_and_cache_account_summary;
use sqlx::PgPool;
use std::time::Duration;
use tracing::{info, warn};

const BATCH_SIZE: usize = 50;
const DELAY_BETWEEN_BATCHES_MS: u64 = 100;

/// Fetches all user IDs from the database and computes + caches account summary for each.
/// Runs in background so it does not block server startup.
pub async fn warm_all_users(pool: PgPool, redis: redis::Client) {
    info!("🔥 Starting account summary cache warm-up for all users...");

    let user_ids: Vec<uuid::Uuid> = match sqlx::query_scalar::<_, uuid::Uuid>("SELECT id FROM users")
        .fetch_all(&pool)
        .await
    {
        Ok(ids) => ids,
        Err(e) => {
            warn!("Failed to fetch user IDs for cache warm-up: {}", e);
            return;
        }
    };

    let total = user_ids.len();
    if total == 0 {
        info!("🔥 No users to warm");
        return;
    }

    info!("🔥 Warming account summary cache for {} user(s)", total);

    for (i, chunk) in user_ids.chunks(BATCH_SIZE).enumerate() {
        for &user_id in chunk {
            compute_and_cache_account_summary(&pool, &redis, user_id).await;
        }
        let done = ((i + 1) * BATCH_SIZE).min(total);
        if done % 100 == 0 || done == total {
            info!("🔥 Account summary warm-up: {}/{} users", done, total);
        }
        if (i + 1) * BATCH_SIZE < total {
            tokio::time::sleep(Duration::from_millis(DELAY_BETWEEN_BATCHES_MS)).await;
        }
    }

    info!("✅ Account summary cache warm-up complete for {} user(s)", total);
}
