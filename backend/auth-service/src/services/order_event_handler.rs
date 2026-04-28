use anyhow::{Context, Result};
use async_nats::Message;
use contracts::events::OrderUpdatedEvent;
use crate::routes::deposits::compute_and_cache_account_summary;
use contracts::enums::OrderStatus;
use contracts::messages::VersionedMessage;
use futures::StreamExt;
use redis::AsyncCommands;
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

pub struct OrderEventHandler {
    pool: Arc<PgPool>,
    redis: Arc<crate::redis_pool::RedisPool>,
}

impl OrderEventHandler {
    pub fn new(pool: Arc<PgPool>, redis: Arc<crate::redis_pool::RedisPool>) -> Self {
        Self { pool, redis }
    }

    pub async fn start_listener(&self, mut subscriber: async_nats::Subscriber) -> Result<()> {
        info!("📡 Starting order event listener for evt.order.updated");

        while let Some(msg) = subscriber.next().await {
            match self.handle_order_update(msg.payload.to_vec()).await {
                Ok(_) => {
                    // Message is auto-acked for basic subscriptions
                    // For JetStream, you'd need to ack explicitly
                }
                Err(e) => {
                    error!("Failed to handle order update event: {}", e);
                }
            }
        }

        Ok(())
    }

    async fn handle_order_update(&self, payload: Vec<u8>) -> Result<()> {
        // Log raw payload for debugging
        let payload_str = String::from_utf8_lossy(&payload);
        debug!("📥 Raw order update payload: {}", payload_str);
        
        // Try to deserialize as VersionedMessage first
        let versioned: VersionedMessage = match serde_json::from_slice(&payload) {
            Ok(v) => v,
            Err(e) => {
                // If VersionedMessage fails, try direct deserialization
                warn!("Failed to deserialize as VersionedMessage: {}. Trying direct deserialization...", e);
                let event: OrderUpdatedEvent = serde_json::from_slice(&payload)
                    .context("Failed to deserialize OrderUpdatedEvent directly")?;
                
                info!(
                    "📦 Received order update event (direct): order_id={}, status={:?}, filled_size={}, avg_fill_price={:?}",
                    event.order_id, event.status, event.filled_size, event.avg_fill_price
                );
                
        // Only update database for terminal states
        if matches!(event.status, OrderStatus::Filled) {
            if self.update_order_in_database(&event).await? {
                self.publish_order_update_to_redis(&event).await;
                let pool = Arc::clone(&self.pool);
                let redis = Arc::clone(&self.redis);
                let user_id = event.user_id;
                tokio::spawn(async move {
                    compute_and_cache_account_summary(&*pool, &redis, user_id).await;
                });
            }
        } else if matches!(event.status, OrderStatus::Cancelled) {
            if self.update_order_cancelled_in_database(&event).await? {
                self.publish_order_update_to_redis(&event).await;
                let pool = Arc::clone(&self.pool);
                let redis = Arc::clone(&self.redis);
                let user_id = event.user_id;
                tokio::spawn(async move {
                    compute_and_cache_account_summary(&*pool, &redis, user_id).await;
                });
            }
        } else if matches!(event.status, OrderStatus::Rejected) {
            if self.update_order_rejected_in_database(&event).await? {
                self.publish_order_update_to_redis(&event).await;
                let pool = Arc::clone(&self.pool);
                let redis = Arc::clone(&self.redis);
                let user_id = event.user_id;
                tokio::spawn(async move {
                    compute_and_cache_account_summary(&*pool, &redis, user_id).await;
                });
            }
        } else {
            info!("Order status is {:?}, skipping database update", event.status);
        }
        
                return Ok(());
            }
        };

        let event: OrderUpdatedEvent = versioned
            .deserialize_payload()
            .context("Failed to deserialize OrderUpdatedEvent")?;

        info!(
            "📦 Received order update event: order_id={}, status={:?}, filled_size={}, avg_fill_price={:?}",
            event.order_id, event.status, event.filled_size, event.avg_fill_price
        );

        // Only update database for terminal states
        if matches!(event.status, OrderStatus::Filled) {
            if self.update_order_in_database(&event).await? {
                self.publish_order_update_to_redis(&event).await;
                let pool = Arc::clone(&self.pool);
                let redis = Arc::clone(&self.redis);
                let user_id = event.user_id;
                tokio::spawn(async move {
                    compute_and_cache_account_summary(&*pool, &redis, user_id).await;
                });
            }
        } else if matches!(event.status, OrderStatus::Cancelled) {
            if self.update_order_cancelled_in_database(&event).await? {
                self.publish_order_update_to_redis(&event).await;
                let pool = Arc::clone(&self.pool);
                let redis = Arc::clone(&self.redis);
                let user_id = event.user_id;
                tokio::spawn(async move {
                    compute_and_cache_account_summary(&*pool, &redis, user_id).await;
                });
            }
        } else if matches!(event.status, OrderStatus::Rejected) {
            if self.update_order_rejected_in_database(&event).await? {
                self.publish_order_update_to_redis(&event).await;
                let pool = Arc::clone(&self.pool);
                let redis = Arc::clone(&self.redis);
                let user_id = event.user_id;
                tokio::spawn(async move {
                    compute_and_cache_account_summary(&*pool, &redis, user_id).await;
                });
            }
        } else {
            info!("Order status is {:?}, skipping database update", event.status);
        }

        Ok(())
    }

    async fn update_order_in_database(&self, event: &OrderUpdatedEvent) -> Result<bool> {
        let order_id = event.order_id;
        let filled_size = event.filled_size;
        let avg_fill_price = event.avg_fill_price;
        let filled_at = event.ts;

        // Convert filled_at timestamp to PostgreSQL timestamp
        let filled_at_ts = filled_at;

        // First, try to update existing order
        let rows_affected = sqlx::query(
            r#"
            UPDATE orders
            SET 
                status = 'filled'::order_status,
                filled_size = $1,
                average_price = $2,
                filled_at = $3,
                updated_at = $3
            WHERE id = $4 AND status <> 'filled'::order_status
            "#
        )
        .bind(filled_size)
        .bind(avg_fill_price)
        .bind(filled_at_ts)
        .bind(order_id)
        .execute(&*self.pool)
        .await
        .context("Failed to update order in database")?;

        if rows_affected.rows_affected() > 0 {
            info!(
                "✅ Updated order {} in database: status=filled, filled_size={}, avg_price={:?}",
                order_id, filled_size, avg_fill_price
            );
            return Ok(true);
        }

        // Order doesn't exist, try to create it from Redis data
        warn!(
            "⚠️  Order {} not found in database, attempting to create from Redis data",
            order_id
        );

        self.create_order_from_redis(order_id, filled_size, avg_fill_price, filled_at_ts).await?;

        Ok(true)
    }

    async fn create_order_from_redis(
        &self,
        order_id: Uuid,
        filled_size: rust_decimal::Decimal,
        avg_fill_price: Option<rust_decimal::Decimal>,
        filled_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        // Get order data from Redis
        let mut conn = self.redis.get().await
            .map_err(|_| anyhow::anyhow!("Redis unavailable (circuit open)"))?;
        
        let order_key = format!("order:{}", order_id);
        let order_json: Option<String> = conn.get(&order_key).await
            .context("Failed to get order from Redis")?;

        if order_json.is_none() {
            return Err(anyhow::anyhow!("Order {} not found in Redis", order_id));
        }

        let order_data: serde_json::Value = serde_json::from_str(&order_json.unwrap())
            .context("Failed to parse order JSON from Redis")?;

        let user_id_str = order_data.get("user_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing user_id in order data"))?;
        let user_id = Uuid::parse_str(user_id_str)
            .context("Invalid user_id format")?;

        let symbol = order_data.get("symbol")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing symbol in order data"))?;

        let side_str = order_data.get("side")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing side in order data"))?;

        let order_type_str = order_data.get("order_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing order_type in order data"))?;

        let size = order_data.get("size")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| anyhow::anyhow!("Missing size in order data"))?;

        let limit_price = order_data.get("limit_price")
            .and_then(|v| v.as_f64());

        let stop_price = order_data.get("stop_loss")
            .and_then(|v| v.as_f64());

        let created_at_str = order_data.get("created_at")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Get symbol_id from database
        let symbol_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM symbols WHERE code = $1"
        )
        .bind(symbol)
        .fetch_optional(&*self.pool)
        .await
        .context("Failed to query symbol")?;

        let symbol_id = symbol_id.ok_or_else(|| {
            anyhow::anyhow!("Symbol {} not found in database", symbol)
        })?;

        // Parse created_at or use filled_at
        let created_at = if !created_at_str.is_empty() {
            chrono::DateTime::parse_from_rfc3339(created_at_str)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| filled_at)
        } else {
            filled_at
        };

        // Convert side and type to lowercase for database enum
        let side_lower = side_str.to_lowercase();
        let type_lower = order_type_str.to_lowercase();

        // Insert order into database
        sqlx::query(
            r#"
            INSERT INTO orders (
                id, user_id, symbol_id, side, type, size, price, stop_price,
                filled_size, average_price, status,
                created_at, updated_at, filled_at
            )
            VALUES (
                $1, $2, $3, $4::order_side, $5::order_type, $6, $7, $8,
                $9, $10, 'filled'::order_status,
                $11, $12, $12
            )
            ON CONFLICT (id) DO UPDATE SET
                status = 'filled'::order_status,
                filled_size = $9,
                average_price = $10,
                filled_at = $12,
                updated_at = $12
            "#
        )
        .bind(order_id)
        .bind(user_id)
        .bind(symbol_id)
        .bind(side_lower)
        .bind(type_lower)
        .bind(rust_decimal::Decimal::from_f64_retain(size).unwrap_or(rust_decimal::Decimal::ZERO))
        .bind(limit_price.map(|p| rust_decimal::Decimal::from_f64_retain(p).unwrap_or(rust_decimal::Decimal::ZERO)))
        .bind(stop_price.map(|p| rust_decimal::Decimal::from_f64_retain(p).unwrap_or(rust_decimal::Decimal::ZERO)))
        .bind(filled_size)
        .bind(avg_fill_price)
        .bind(created_at)
        .bind(filled_at)
        .execute(&*self.pool)
        .await
        .context("Failed to insert order into database")?;

        info!(
            "✅ Created order {} in database from Redis: status=filled, symbol={}, filled_size={}, avg_price={:?}",
            order_id, symbol, filled_size, avg_fill_price
        );

        Ok(())
    }

    async fn update_order_cancelled_in_database(&self, event: &OrderUpdatedEvent) -> Result<bool> {
        let order_id = event.order_id;
        let cancelled_at = event.ts;

        let rows_affected = sqlx::query(
            r#"
            UPDATE orders
            SET 
                status = 'cancelled'::order_status,
                cancelled_at = $1,
                updated_at = $1
            WHERE id = $2 AND status <> 'cancelled'::order_status
            "#
        )
        .bind(cancelled_at)
        .bind(order_id)
        .execute(&*self.pool)
        .await
        .context("Failed to update cancelled order in database")?;

        if rows_affected.rows_affected() > 0 {
            info!("✅ Updated order {} in database: status=cancelled", order_id);
            Ok(true)
        } else {
            info!("Order {} already cancelled or not found; skipping duplicate event", order_id);
            Ok(false)
        }
    }

    async fn update_order_rejected_in_database(&self, event: &OrderUpdatedEvent) -> Result<bool> {
        let order_id = event.order_id;
        let rejected_at = event.ts;

        let rows_affected = sqlx::query(
            r#"
            UPDATE orders
            SET
                status = 'rejected'::order_status,
                updated_at = $1
            WHERE id = $2 AND status <> 'rejected'::order_status
            "#
        )
        .bind(rejected_at)
        .bind(order_id)
        .execute(&*self.pool)
        .await
        .context("Failed to update rejected order in database")?;

        if rows_affected.rows_affected() > 0 {
            info!(
                "✅ Updated order {} in database: status=rejected, reason={:?}",
                order_id, event.reason
            );
            Ok(true)
        } else {
            info!("Order {} already rejected or not found; skipping duplicate event", order_id);
            Ok(false)
        }
    }

    async fn publish_order_update_to_redis(&self, event: &OrderUpdatedEvent) {
        let status = format!("{:?}", event.status).to_uppercase();
        let nested_status = status.clone();
        let payload = serde_json::json!({
            "type": "order.update",
            "user_id": event.user_id.to_string(),
            "order_id": event.order_id.to_string(),
            "status": status,
            "quantity": event.filled_size.to_string(),
            "price": event.avg_fill_price.map(|p| p.to_string()),
            "ts": event.ts.timestamp_millis(),
            "payload": {
                "user_id": event.user_id.to_string(),
                "order_id": event.order_id.to_string(),
                "status": nested_status,
                "quantity": event.filled_size.to_string(),
                "price": event.avg_fill_price.map(|p| p.to_string()),
                "ts": event.ts.timestamp_millis(),
            }
        });

        match self.redis.get().await {
            Ok(mut conn) => {
                let publish_result: redis::RedisResult<i64> = redis::cmd("PUBLISH")
                    .arg("orders:updates")
                    .arg(payload.to_string())
                    .query_async(&mut conn)
                    .await;
                if let Err(e) = publish_result {
                    warn!(
                        order_id = %event.order_id,
                        user_id = %event.user_id,
                        error = %e,
                        "Failed to publish order update to Redis"
                    );
                }
            }
            Err(e) => {
                warn!(
                    order_id = %event.order_id,
                    user_id = %event.user_id,
                    error = %e,
                    "Redis unavailable while publishing order update"
                );
            }
        }
    }
}

