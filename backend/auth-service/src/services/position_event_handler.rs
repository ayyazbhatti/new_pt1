use anyhow::{Context, Result};
use contracts::events::PositionUpdatedEvent;
use crate::routes::deposits::compute_and_cache_account_summary;
use contracts::enums::{PositionSide, PositionStatus};
use contracts::messages::VersionedMessage;
use futures::StreamExt;
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

pub struct PositionEventHandler {
    pool: Arc<PgPool>,
    redis: Arc<crate::redis_pool::RedisPool>,
}

impl PositionEventHandler {
    pub fn new(pool: Arc<PgPool>, redis: Arc<crate::redis_pool::RedisPool>) -> Self {
        Self { pool, redis }
    }

    pub async fn start_listener(&self, mut subscriber: async_nats::Subscriber) -> Result<()> {
        info!("📡 Starting position event listener for evt.position.updated");

        while let Some(msg) = subscriber.next().await {
            match self.handle_position_update(msg.payload.to_vec()).await {
                Ok(_) => {
                    // Message is auto-acked for basic subscriptions
                }
                Err(e) => {
                    error!("Failed to handle position update event: {}", e);
                }
            }
        }

        Ok(())
    }

    async fn handle_position_update(&self, payload: Vec<u8>) -> Result<()> {
        // Log raw payload for debugging
        let payload_str = String::from_utf8_lossy(&payload);
        debug!("📥 Raw position update payload: {}", payload_str);
        
        // Try to deserialize as VersionedMessage first
        let versioned: VersionedMessage = match serde_json::from_slice(&payload) {
            Ok(v) => v,
            Err(e) => {
                // If VersionedMessage fails, try direct deserialization
                warn!("Failed to deserialize as VersionedMessage: {}. Trying direct deserialization...", e);
                let event: PositionUpdatedEvent = serde_json::from_slice(&payload)
                    .context("Failed to deserialize PositionUpdatedEvent directly")?;
                
                info!(
                    "📦 Received position update event (direct): position_id={}, user_id={}, symbol={}, status={:?}",
                    event.position_id, event.user_id, event.symbol, event.status
                );
                
                // Sync position to database
                self.sync_position_to_database(&event).await?;
                compute_and_cache_account_summary(&*self.pool, self.redis.as_ref(), event.user_id).await;
                // Liquidation email is sent from create_liquidation_notifications_and_push (event.position.closed handler)
                return Ok(());
            }
        };

        let event: PositionUpdatedEvent = versioned
            .deserialize_payload()
            .context("Failed to deserialize PositionUpdatedEvent")?;

        info!(
            "📦 Received position update event: position_id={}, user_id={}, symbol={}, status={:?}",
            event.position_id, event.user_id, event.symbol, event.status
        );

        // Sync position to database
        self.sync_position_to_database(&event).await?;
        compute_and_cache_account_summary(&*self.pool, self.redis.as_ref(), event.user_id).await;
        // Liquidation email is sent from create_liquidation_notifications_and_push (event.position.closed handler)

        Ok(())
    }

    async fn sync_position_to_database(&self, event: &PositionUpdatedEvent) -> Result<()> {
        // Get symbol_id from database (column is 'code', not 'symbol_code')
        let symbol_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM symbols WHERE code = $1"
        )
        .bind(&event.symbol)
        .fetch_optional(&*self.pool)
        .await
        .context("Failed to query symbol")?;

        let symbol_id = symbol_id.ok_or_else(|| {
            anyhow::anyhow!("Symbol {} not found in database", event.symbol)
        })?;

        // Convert PositionSide to database enum (lowercase)
        let side_str = match event.side {
            PositionSide::Long => "long",
            PositionSide::Short => "short",
        };

        // Convert PositionStatus to database enum (lowercase)
        let status_str = match event.status {
            PositionStatus::Open => "open",
            PositionStatus::Closed => "closed",
            PositionStatus::Liquidated => "liquidated",
        };

        // For now, use avg_price as both entry_price and mark_price
        // Mark price will be updated by tick handler later
        let entry_price = event.avg_price;
        let mark_price = event.avg_price; // Will be updated by price ticks

        let leverage = event.leverage;
        if leverage <= rust_decimal::Decimal::ZERO {
            return Err(anyhow::anyhow!(
                "Position {} update missing valid leverage in event",
                event.position_id
            ));
        }

        // margin_used: (size * entry_price) / leverage
        let margin_used = (event.size * entry_price) / leverage;

        // Liquidation (simplified): LONG entry * (1 - 1/L), SHORT entry * (1 + 1/L)
        let one = rust_decimal::Decimal::ONE;
        let liquidation_price = if matches!(event.side, PositionSide::Long) {
            entry_price * (one - one / leverage)
        } else {
            entry_price * (one + one / leverage)
        };

        // Calculate PnL
        let pnl = event.unrealized_pnl + event.realized_pnl;
        let pnl_percent = if entry_price > rust_decimal::Decimal::ZERO {
            (pnl / (entry_price * event.size)) * rust_decimal::Decimal::from(100)
        } else {
            rust_decimal::Decimal::ZERO
        };

        let opened_at = event.ts;
        let updated_at = event.ts;
        let closed_at = if matches!(event.status, PositionStatus::Closed | PositionStatus::Liquidated) {
            Some(event.ts)
        } else {
            None
        };

        // Try to update existing position first
        let rows_affected = sqlx::query(
            r#"
            UPDATE positions
            SET 
                size = $1,
                entry_price = $2,
                mark_price = $3,
                leverage = $4,
                margin_used = $5,
                liquidation_price = $6,
                pnl = $7,
                pnl_percent = $8,
                status = $9::position_status,
                updated_at = $10,
                closed_at = $11
            WHERE id = $12
            "#
        )
        .bind(event.size)
        .bind(entry_price)
        .bind(mark_price)
        .bind(leverage) // NUMERIC in DB
        .bind(margin_used)
        .bind(liquidation_price)
        .bind(pnl)
        .bind(pnl_percent)
        .bind(status_str)
        .bind(updated_at)
        .bind(closed_at)
        .bind(event.position_id)
        .execute(&*self.pool)
        .await
        .context("Failed to update position in database")?;

        if rows_affected.rows_affected() > 0 {
            info!(
                "✅ Updated position {} in database: symbol={}, size={}, status={:?}",
                event.position_id, event.symbol, event.size, event.status
            );
            return Ok(());
        }

        // Position doesn't exist, create it
        info!(
            "📝 Creating new position {} in database: symbol={}, size={}, status={:?}",
            event.position_id, event.symbol, event.size, event.status
        );

        sqlx::query(
            r#"
            INSERT INTO positions (
                id, user_id, symbol_id, side, size, entry_price, mark_price,
                leverage, margin_used, liquidation_price, pnl, pnl_percent,
                status, opened_at, updated_at, closed_at
            )
            VALUES (
                $1, $2, $3, $4::position_side, $5, $6, $7,
                $8, $9, $10, $11, $12,
                $13::position_status, $14, $15, $16
            )
            ON CONFLICT (id) DO UPDATE SET
                size = $5,
                entry_price = $6,
                mark_price = $7,
                leverage = $8,
                margin_used = $9,
                liquidation_price = $10,
                pnl = $11,
                pnl_percent = $12,
                status = $13::position_status,
                updated_at = $15,
                closed_at = $16
            "#
        )
        .bind(event.position_id)
        .bind(event.user_id)
        .bind(symbol_id)
        .bind(side_str)
        .bind(event.size)
        .bind(entry_price)
        .bind(mark_price)
        .bind(leverage) // NUMERIC in DB
        .bind(margin_used)
        .bind(liquidation_price)
        .bind(pnl)
        .bind(pnl_percent)
        .bind(status_str)
        .bind(opened_at)
        .bind(updated_at)
        .bind(closed_at)
        .execute(&*self.pool)
        .await
        .context("Failed to insert position into database")?;

        info!(
            "✅ Created position {} in database: symbol={}, size={}, status={:?}",
            event.position_id, event.symbol, event.size, event.status
        );

        Ok(())
    }
}

