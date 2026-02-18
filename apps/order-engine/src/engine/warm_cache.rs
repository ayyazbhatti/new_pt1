//! Loads pending orders from Redis into the in-memory cache on startup
//! so that ticks can fill orders that were placed before the engine was (re)started.

use anyhow::{Context, Result};
use redis::cmd;
use tracing::info;

use crate::models::Order;
use crate::redis::RedisClient;
use contracts::enums::OrderStatus;

use super::OrderCache;

const PENDING_PREFIX: &str = "orders:pending:";
const ORDER_PREFIX: &str = "order:";

pub async fn warm_order_cache(cache: &OrderCache, redis: &RedisClient) -> Result<()> {
    info!("Warming cache...");
    let mut conn = redis.get_connection().await;

    let keys: Vec<String> = cmd("KEYS")
        .arg(format!("{}*", PENDING_PREFIX))
        .query_async(&mut conn)
        .await
        .context("Redis KEYS orders:pending:*")?;

    let mut loaded = 0u32;
    for key in keys {
        let symbol = key
            .strip_prefix(PENDING_PREFIX)
            .unwrap_or(&key)
            .to_string();
        let order_ids: Vec<String> = cmd("ZRANGE")
            .arg(&key)
            .arg(0)
            .arg(-1)
            .query_async(&mut conn)
            .await
            .unwrap_or_default();
        for order_id_str in order_ids {
            let order_key = format!("{}{}", ORDER_PREFIX, order_id_str);
            let order_json: Option<String> = cmd("GET")
                .arg(&order_key)
                .query_async(&mut conn)
                .await
                .unwrap_or(None);
            if let Some(ref json) = order_json {
                if let Ok(order) = serde_json::from_str::<Order>(json) {
                    if order.status == OrderStatus::Pending {
                        if let Ok(uuid) = uuid::Uuid::parse_str(&order_id_str) {
                            cache.add_pending_order(&symbol, uuid, order);
                            loaded += 1;
                        }
                    }
                }
            }
        }
    }
    info!(
        "Cache warmed: loaded {} pending orders for tick-driven fill",
        loaded
    );
    Ok(())
}
