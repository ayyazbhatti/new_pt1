use anyhow::{Context, Result};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{debug, error, info, warn, instrument};
use uuid::Uuid;
use rust_decimal::Decimal;

use crate::engine::{LuaScripts, OrderCache};
use crate::engine::position_handler::PositionHandler;
use crate::models::PositionClosedEvent;
use crate::nats::NatsClient;
use crate::observability::Metrics;
use crate::subjects::subjects as nats_subjects;
use crate::utils::now;

#[derive(Debug, Clone)]
pub enum TriggerReason {
    StopLoss,
    TakeProfit,
}

pub struct SltpHandler {
    redis: Arc<crate::redis::RedisClient>,
    lua: Arc<LuaScripts>,
    position_handler: Arc<PositionHandler>,
    cache: Arc<OrderCache>,
    nats: Arc<NatsClient>,
    metrics: Arc<Metrics>,
}

impl SltpHandler {
    pub fn new(
        redis: Arc<crate::redis::RedisClient>,
        lua: Arc<LuaScripts>,
        position_handler: Arc<PositionHandler>,
        cache: Arc<OrderCache>,
        nats: Arc<NatsClient>,
        metrics: Arc<Metrics>,
    ) -> Self {
        Self {
            redis,
            lua,
            position_handler,
            cache,
            nats,
            metrics,
        }
    }
    
    /// Check and trigger SL/TP for positions of a symbol (optionally for a group only)
    #[instrument(skip(self), fields(symbol = %symbol))]
    pub async fn check_and_trigger(
        &self,
        symbol: &str,
        group_id: &str,
        bid: Decimal,
        ask: Decimal,
    ) -> Result<()> {
        let symbol_open_key = format!("pos:open:{}", symbol);
        let mut conn = self.redis.get_connection().await;
        let has_positions: bool = conn.exists(&symbol_open_key).await
            .unwrap_or(false);

        if !has_positions {
            debug!("No open positions for symbol {}, skipping SL/TP check", symbol);
            return Ok(());
        }

        let triggered = match self.lua.check_sltp_triggers(&mut conn, symbol, group_id, bid, ask).await {
            Ok(result) => result,
            Err(e) => {
                error!("Failed to check SL/TP triggers for {}: {}", symbol, e);
                return Ok(()); // Don't fail tick processing
            }
        };
        
        // Parse triggered positions
        let triggered_list = triggered.as_array()
            .context("SL/TP triggers result is not an array")?;
        
        if triggered_list.is_empty() {
            debug!("No SL/TP triggers for symbol {}", symbol);
            return Ok(());
        }
        
        info!("Found {} SL/TP triggers for symbol {}", triggered_list.len(), symbol);
        self.metrics.inc_sltp_triggers(triggered_list.len() as u64);
        
        // Process each triggered position
        for trigger_item in triggered_list {
            let position_id_str = trigger_item.get("position_id")
                .and_then(|v| v.as_str())
                .context("Missing position_id in trigger")?;
            
            let position_id = Uuid::parse_str(position_id_str)
                .context("Invalid position_id format")?;
            
            let reason_str = trigger_item.get("reason")
                .and_then(|v| v.as_str())
                .context("Missing reason in trigger")?;
            
            let reason = match reason_str {
                "SL" => TriggerReason::StopLoss,
                "TP" => TriggerReason::TakeProfit,
                _ => {
                    warn!("Unknown trigger reason: {}", reason_str);
                    continue;
                }
            };
            
            // Determine exit price based on position side and trigger reason
            let exit_price = self.determine_exit_price(&mut conn, &position_id, bid, ask, &reason).await?;
            
            // Trigger position closure
            if let Err(e) = self.trigger_closure(&position_id, reason, exit_price).await {
                error!("Failed to trigger closure for position {}: {}", position_id, e);
                // Continue processing other triggers
            }
        }
        
        Ok(())
    }
    
    /// Determine exit price for position closure
    async fn determine_exit_price(
        &self,
        conn: &mut ConnectionManager,
        position_id: &Uuid,
        bid: Decimal,
        ask: Decimal,
        reason: &TriggerReason,
    ) -> Result<Decimal> {
        // Get position side
        let pos_key = format!("pos:by_id:{}", position_id);
        let side: Option<String> = conn.hget(&pos_key, "side").await?;
        
        let exit_price = match side.as_deref() {
            Some("LONG") => bid,  // Long closes at BID
            Some("SHORT") => ask, // Short closes at ASK
            _ => {
                // Fallback: use trigger price if available
                warn!("Unknown position side for {}, using bid", position_id);
                bid
            }
        };
        
        Ok(exit_price)
    }
    
    /// Execute position closure due to SL/TP trigger
    #[instrument(skip(self), fields(position_id = %position_id))]
    async fn trigger_closure(
        &self,
        position_id: &Uuid,
        reason: TriggerReason,
        exit_price: Decimal,
    ) -> Result<()> {
        // Check for lock to prevent race conditions
        let lock_key = format!("pos:closing:{}", position_id);
        let mut conn = self.redis.get_connection().await;
        
        // Try to acquire lock (SETNX with TTL)
        let lock_acquired: bool = redis::cmd("SET")
            .arg(&lock_key)
            .arg("1")
            .arg("EX")
            .arg(5) // 5 second TTL
            .arg("NX")
            .query_async(&mut conn)
            .await
            .unwrap_or(false);
        
        if !lock_acquired {
            debug!("Position {} is already being closed, skipping", position_id);
            return Ok(());
        }
        
        // Get position details for logging
        let pos_key = format!("pos:by_id:{}", position_id);
        let symbol: Option<String> = conn.hget(&pos_key, "symbol").await?;
        let side: Option<String> = conn.hget(&pos_key, "side").await?;
        
        info!(
            "Triggering {} closure for position {} ({} {}) at price {}",
            match reason {
                TriggerReason::StopLoss => "Stop Loss",
                TriggerReason::TakeProfit => "Take Profit",
            },
            position_id,
            side.as_deref().unwrap_or("UNKNOWN"),
            symbol.as_deref().unwrap_or("UNKNOWN"),
            exit_price
        );
        
        // Close position (full close for SL/TP triggers)
        // Note: We need to get user_id for the close_position handler
        // For now, we'll use the position_handler which handles this internally
        // But we need to adapt it to work with our trigger system
        
        // Use the existing atomic_close_position Lua script directly
        let close_result = self.lua.atomic_close_position(&mut conn, position_id, exit_price, None, None).await?;
        
        if close_result.get("error").is_some() {
            let error_msg = close_result.get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            error!("Failed to close position {}: {}", position_id, error_msg);
            // Remove lock on error
            let _: () = conn.del(&lock_key).await?;
            return Err(anyhow::anyhow!("Failed to close position: {}", error_msg));
        }
        
        // Remove lock
        let _: () = conn.del(&lock_key).await?;
        
        // Get position details for event
        let user_id_str: String = conn.hget(&pos_key, "user_id").await?;
        let user_id = Uuid::parse_str(&user_id_str)?;
        let closed_size_str: String = conn.hget(&pos_key, "size").await.unwrap_or_else(|_| "0".to_string());
        let closed_size = Decimal::from_str(&closed_size_str).unwrap_or(Decimal::ZERO);
        let realized_pnl_str: String = conn.hget(&pos_key, "realized_pnl").await.unwrap_or_else(|_| "0".to_string());
        let realized_pnl = Decimal::from_str(&realized_pnl_str).unwrap_or(Decimal::ZERO);
        
        // Determine side enum
        let pos_side = match side.as_deref() {
            Some("LONG") => contracts::enums::PositionSide::Long,
            Some("SHORT") => contracts::enums::PositionSide::Short,
            _ => {
                warn!("Unknown position side for {}, defaulting to Long", position_id);
                contracts::enums::PositionSide::Long
            }
        };
        
        // Publish position closed event with trigger reason
        let trigger_reason_str = match reason {
            TriggerReason::StopLoss => "SL",
            TriggerReason::TakeProfit => "TP",
        };
        
        let event = PositionClosedEvent {
            position_id: *position_id,
            user_id,
            symbol: symbol.as_deref().unwrap_or("UNKNOWN").to_string(),
            side: pos_side,
            closed_size,
            exit_price,
            realized_pnl,
            correlation_id: Uuid::new_v4().to_string(),
            ts: now(),
            trigger_reason: Some(trigger_reason_str.to_string()),
        };
        
        // Publish to NATS
        if let Err(e) = self.nats.publish_event(nats_subjects::EVENT_POSITION_CLOSED, &event).await {
            error!("Failed to publish position closed event to NATS for {}: {}", position_id, e);
        } else {
            info!("Published position closed event to NATS with trigger_reason={} for position {}", trigger_reason_str, position_id);
        }
        
        // Also publish to Redis pub/sub for gateway-ws
        let redis_payload = serde_json::json!({
            "user_id": user_id.to_string(),
            "position_id": position_id.to_string(),
            "symbol": symbol.as_deref().unwrap_or("UNKNOWN"),
            "side": side.as_deref().unwrap_or("UNKNOWN"),
            "quantity": closed_size.to_string(),
            "unrealized_pnl": realized_pnl.to_string(),
            "trigger_reason": trigger_reason_str,
            "ts": now().timestamp_millis(),
        });
        
        let mut redis_conn = self.redis.get_connection().await;
        if let Err(e) = redis::cmd("PUBLISH")
            .arg("positions:updates")
            .arg(serde_json::to_string(&redis_payload)?)
            .query_async::<_, i64>(&mut redis_conn)
            .await
        {
            error!("Failed to publish position closed event to Redis for {}: {}", position_id, e);
        } else {
            info!("Published position closed event to Redis pub/sub with trigger_reason={} for position {}", trigger_reason_str, position_id);
        }
        
        info!("Successfully closed position {} due to {}", position_id, 
            match reason {
                TriggerReason::StopLoss => "Stop Loss",
                TriggerReason::TakeProfit => "Take Profit",
            });
        
        self.metrics.inc_positions_closed();
        
        Ok(())
    }
}

