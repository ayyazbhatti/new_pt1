use anyhow::{Context, Result, anyhow};
use async_nats::Message;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::sync::Arc;
use tracing::{error, info, instrument, warn};
use uuid::Uuid;

use crate::engine::{OrderCache, LuaScripts};
use crate::models::{ClosePositionCommand, PositionClosedEvent, BalanceUpdatedEvent};
use crate::nats::NatsClient;
use crate::observability::Metrics;
use crate::subjects::subjects as nats_subjects;
use crate::utils::now;
use rust_decimal::Decimal;

pub struct PositionHandler {
    cache: Arc<OrderCache>,
    redis: Arc<crate::redis::RedisClient>,
    nats: Arc<NatsClient>,
    lua: Arc<LuaScripts>,
    metrics: Arc<Metrics>,
}

impl PositionHandler {
    pub fn new(
        cache: Arc<OrderCache>,
        redis: Arc<crate::redis::RedisClient>,
        nats: Arc<NatsClient>,
        lua: Arc<LuaScripts>,
        metrics: Arc<Metrics>,
    ) -> Self {
        Self {
            cache,
            redis,
            nats,
            lua,
            metrics,
        }
    }
    
    #[instrument(skip(self, msg))]
    pub async fn handle_close_position(&self, msg: Message) -> Result<()> {
        // Deserialize command (would need to define ClosePositionCommand in contracts)
        // For now, parse from JSON
        let bytes = msg.payload.to_vec();
        let cmd_json: serde_json::Value = serde_json::from_slice(&bytes)?;
        
        let position_id = cmd_json.get("position_id")
            .and_then(|v| v.as_str())
            .and_then(|s| uuid::Uuid::parse_str(s).ok())
            .context("Invalid position_id")?;
        
        let user_id = cmd_json.get("user_id")
            .and_then(|v| v.as_str())
            .and_then(|s| uuid::Uuid::parse_str(s).ok())
            .context("Invalid user_id")?;
        
        let close_size = cmd_json.get("size")
            .and_then(|v| v.as_str())
            .and_then(|s| Decimal::from_str_exact(s).ok());
        
        let correlation_id = cmd_json.get("correlation_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        
        info!("Received close position command: position_id={}, user_id={}, size={:?}, correlation_id={}",
              position_id, user_id, close_size, correlation_id);
        
        // Get position from Redis (check new format first, then old format)
        let mut conn = self.redis.get_connection().await;
        use redis_model::keys::Keys;
        
        // Try new format (Hash) first
        let pos_key_new = Keys::position_by_id(position_id);
        let position_data: std::collections::HashMap<String, String> = redis::cmd("HGETALL")
            .arg(&pos_key_new)
            .query_async(&mut conn)
            .await?;
        
        let (symbol, side, group_id) = if !position_data.is_empty() {
            // New format (Hash)
            let pos_user_id_str = position_data.get("user_id")
                .ok_or_else(|| anyhow::anyhow!("Missing user_id in position"))?;
            let pos_user_id = Uuid::parse_str(pos_user_id_str)
                .context("Invalid user_id in position")?;

            if pos_user_id != user_id {
                warn!("Position {} does not belong to user {}", position_id, user_id);
                return Ok(());
            }

            let symbol = position_data.get("symbol")
                .ok_or_else(|| anyhow::anyhow!("Missing symbol in position"))?
                .clone();
            let side = position_data.get("side")
                .ok_or_else(|| anyhow::anyhow!("Missing side in position"))?
                .clone();
            let group_id = position_data.get("group_id").cloned();

            (symbol, side, group_id)
        } else {
            // Try old format (JSON)
        let position_key = format!("position:{}", position_id);
        let position_json: Option<String> = redis::cmd("GET")
            .arg(&position_key)
            .query_async(&mut conn)
            .await?;
        
        if position_json.is_none() {
                warn!("Position {} not found in Redis", position_id);
            return Ok(());
        }
        
        let position: serde_json::Value = serde_json::from_str(&position_json.unwrap())?;
        
        // Verify position belongs to user
        let pos_user_id = position.get("user_id")
            .and_then(|v| v.as_str())
            .and_then(|s| uuid::Uuid::parse_str(s).ok());
        
        if pos_user_id != Some(user_id) {
            warn!("Position {} does not belong to user {}", position_id, user_id);
            return Ok(());
        }
        
        let symbol = position.get("symbol")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .context("Missing symbol in position")?;

        let side = position.get("side")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .context("Missing side in position")?;
        let group_id = position.get("group_id").and_then(|v| v.as_str()).map(|s| s.to_string());

            (symbol, side, group_id)
        };

        // Ticks from data-provider are published as "ticks.SYMBOL" (no group), so they are cached under key "SYMBOL:".
        // Positions can have a group_id, so lookup "SYMBOL:group_id" finds nothing. Fall back to symbol-level tick.
        let tick = self.cache.get_last_tick(&symbol, group_id.as_deref())
            .or_else(|| self.cache.get_last_tick(&symbol, None))
            .context("No tick data available for symbol")?;
        
        // Determine exit price (BID/ASK model)
        let exit_price = if side == "LONG" {
            tick.bid  // Long closes at BID
        } else {
            tick.ask  // Short closes at ASK
        };
        
        // Execute atomic close
        match self.lua.atomic_close_position(&mut conn, &position_id, exit_price, close_size, None).await {
            Ok(result) => {
                if result.get("error").is_some() {
                    let error_msg = result.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
                    error!("Failed to close position {}: {}", position_id, error_msg);
                    return Ok(());
                }
                
                let closed_size: Decimal = result
                    .get("closed_size")
                    .and_then(|v| v.as_str())
                    .and_then(|s| Decimal::from_str_exact(s).ok())
                    .unwrap_or(Decimal::ZERO);
                
                let realized_pnl: Decimal = result
                    .get("realized_pnl")
                    .and_then(|v| v.as_str())
                    .and_then(|s| Decimal::from_str_exact(s).ok())
                    .unwrap_or(Decimal::ZERO);
                
                // Publish position closed event
                let pos_side = if side == "LONG" {
                    contracts::enums::PositionSide::Long
                } else {
                    contracts::enums::PositionSide::Short
                };
                
                let event = PositionClosedEvent {
                    position_id,
                    user_id,
                    symbol: symbol.clone(),
                    side: pos_side,
                    closed_size,
                    exit_price,
                    realized_pnl,
                    correlation_id: correlation_id.clone(),
                    ts: now(),
                    trigger_reason: None, // Manual close, not SL/TP trigger
                };
                
                // Publish to NATS
                self.nats.publish_event(nats_subjects::EVENT_POSITION_CLOSED, &event).await?;
                
                // Also publish to Redis pub/sub for gateway-ws
                let redis_payload = serde_json::json!({
                    "user_id": user_id.to_string(),
                    "position_id": position_id.to_string(),
                    "symbol": symbol.clone(),
                    "side": if side == "LONG" { "LONG" } else { "SHORT" },
                    "quantity": closed_size.to_string(),
                    "unrealized_pnl": realized_pnl.to_string(),
                    "trigger_reason": None::<String>, // Manual close, no trigger
                    "ts": now().timestamp_millis(),
                });
                
                if let Err(e) = redis::cmd("PUBLISH")
                    .arg("positions:updates")
                    .arg(serde_json::to_string(&redis_payload)?)
                    .query_async::<_, i64>(&mut conn)
                    .await
                {
                    warn!("Failed to publish position closed event to Redis: {}", e);
                }
                
                self.metrics.inc_positions_closed();
                
                // Publish balance updated event
                let balance_key = format!("user:{}:balance", user_id);
                let balance_json: Option<String> = redis::cmd("GET")
                    .arg(&balance_key)
                    .query_async(&mut conn)
                    .await?;
                
                if let Some(bal_json) = balance_json {
                    let balance: serde_json::Value = serde_json::from_str(&bal_json)?;
                    
                    let balance_event = BalanceUpdatedEvent {
                        user_id,
                        currency: "USD".to_string(),
                        available: balance.get("available")
                            .and_then(|v| v.as_str())
                            .and_then(|s| Decimal::from_str_exact(s).ok())
                            .unwrap_or(Decimal::ZERO),
                        locked: balance.get("locked")
                            .and_then(|v| v.as_str())
                            .and_then(|s| Decimal::from_str_exact(s).ok())
                            .unwrap_or(Decimal::ZERO),
                        equity: balance.get("equity")
                            .and_then(|v| v.as_str())
                            .and_then(|s| Decimal::from_str_exact(s).ok())
                            .unwrap_or(Decimal::ZERO),
                        margin_used: balance.get("margin_used")
                            .and_then(|v| v.as_str())
                            .and_then(|s| Decimal::from_str_exact(s).ok())
                            .unwrap_or(Decimal::ZERO),
                        free_margin: balance.get("free_margin")
                            .and_then(|v| v.as_str())
                            .and_then(|s| Decimal::from_str_exact(s).ok())
                            .unwrap_or(Decimal::ZERO),
                        correlation_id: correlation_id.clone(),
                        ts: now(),
                    };
                    
                    self.nats.publish_event(nats_subjects::EVENT_BALANCE_UPDATED, &balance_event).await?;
                }
                
                info!("Position {} closed: size={}, pnl={}", position_id, closed_size, realized_pnl);
            }
            Err(e) => {
                error!("Error closing position {}: {}", position_id, e);
            }
        }
        
        Ok(())
    }

    /// Handle cmd.position.close_all: close all OPEN positions for the user. Processes sequentially.
    #[instrument(skip(self, msg))]
    pub async fn handle_close_all_positions(&self, msg: async_nats::Message) -> Result<()> {
        let bytes = msg.payload.to_vec();
        let cmd_json: serde_json::Value = serde_json::from_slice(&bytes)?;
        let user_id = cmd_json
            .get("user_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .context("Invalid user_id in close_all")?;
        let correlation_id = cmd_json
            .get("correlation_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let reason = cmd_json
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("stop_out");
        let is_liquidation = reason.eq_ignore_ascii_case("liquidated");
        info!("Received close_all_positions: user_id={}, correlation_id={}, reason={}", user_id, correlation_id, reason);

        use redis_model::keys::Keys;
        use contracts::enums::PositionStatus;
        use crate::engine::position_events;
        let mut conn = self.redis.get_connection().await;
        let positions_key = Keys::positions_set(user_id);
        let position_ids: Vec<String> = redis::cmd("SMEMBERS")
            .arg(&positions_key)
            .query_async(&mut conn)
            .await?;
        let mut closed = 0u32;
        for pos_id_str in position_ids {
            let position_id = match Uuid::parse_str(&pos_id_str) {
                Ok(u) => u,
                Err(_) => continue,
            };
            let pos_key = Keys::position_by_id(position_id);
            let status: Option<String> = redis::cmd("HGET")
                .arg(&pos_key)
                .arg("status")
                .query_async(&mut conn)
                .await
                .ok();
            if status.as_deref().map(|s| s.eq_ignore_ascii_case("OPEN")) != Some(true) {
                continue;
            }
            let symbol: Option<String> = redis::cmd("HGET")
                .arg(&pos_key)
                .arg("symbol")
                .query_async(&mut conn)
                .await
                .ok();
            let side: Option<String> = redis::cmd("HGET")
                .arg(&pos_key)
                .arg("side")
                .query_async(&mut conn)
                .await
                .ok();
            let group_id: Option<String> = redis::cmd("HGET")
                .arg(&pos_key)
                .arg("group_id")
                .query_async(&mut conn)
                .await
                .ok();
            let (symbol, side) = match (symbol, side) {
                (Some(s), Some(side)) => (s, side),
                _ => continue,
            };
            // Ticks from data-provider are cached under symbol only (no group). Fall back to symbol-level tick
            // so positions with a group_id still get closed (same as single-position close path).
            let tick = match self.cache.get_last_tick(&symbol, group_id.as_deref())
                .or_else(|| self.cache.get_last_tick(&symbol, None))
            {
                Some(t) => t,
                None => {
                    warn!("Close all: no tick for symbol {}, skipping position {}", symbol, position_id);
                    continue;
                }
            };
            let exit_price = if side.eq_ignore_ascii_case("LONG") {
                tick.bid
            } else {
                tick.ask
            };
            let close_reason_arg = if is_liquidation { Some("liquidated") } else { None };
            match self.lua.atomic_close_position(&mut conn, &position_id, exit_price, None, close_reason_arg).await {
                Ok(result) => {
                    if result.get("error").is_some() {
                        let err_msg = result.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
                        warn!("Close all: position {} failed: {}", position_id, err_msg);
                        continue;
                    }
                    let closed_size: Decimal = result
                        .get("closed_size")
                        .and_then(|v| v.as_str())
                        .and_then(|s| Decimal::from_str_exact(s).ok())
                        .unwrap_or(Decimal::ZERO);
                    let realized_pnl: Decimal = result
                        .get("realized_pnl")
                        .and_then(|v| v.as_str())
                        .and_then(|s| Decimal::from_str_exact(s).ok())
                        .unwrap_or(Decimal::ZERO);
                    let pos_side = if side.eq_ignore_ascii_case("LONG") {
                        contracts::enums::PositionSide::Long
                    } else {
                        contracts::enums::PositionSide::Short
                    };
                    let status_override = if is_liquidation {
                        Some(PositionStatus::Liquidated)
                    } else {
                        Some(PositionStatus::Closed)
                    };
                    if let Err(e) = position_events::publish_position_updated(
                        self.nats.as_ref(),
                        &mut conn,
                        position_id,
                        status_override,
                    )
                    .await
                    {
                        warn!("Close all: failed to publish evt.position.updated for {}: {}", position_id, e);
                    }
                    let event = PositionClosedEvent {
                        position_id,
                        user_id,
                        symbol: symbol.clone(),
                        side: pos_side,
                        closed_size,
                        exit_price,
                        realized_pnl,
                        correlation_id: correlation_id.clone(),
                        ts: now(),
                        trigger_reason: Some(reason.to_string()),
                    };
                    if self.nats.publish_event(nats_subjects::EVENT_POSITION_CLOSED, &event).await.is_err() {
                        warn!("Close all: failed to publish position closed for {}", position_id);
                    }
                    if let Err(e) = redis::cmd("PUBLISH")
                        .arg("positions:updates")
                        .arg(serde_json::to_string(&serde_json::json!({
                            "user_id": user_id.to_string(),
                            "position_id": position_id.to_string(),
                            "symbol": symbol,
                            "side": side,
                            "quantity": closed_size.to_string(),
                            "unrealized_pnl": realized_pnl.to_string(),
                            "trigger_reason": reason,
                            "ts": now().timestamp_millis(),
                        }))?)
                        .query_async::<_, i64>(&mut conn)
                        .await
                    {
                        warn!("Close all: failed to publish to Redis: {}", e);
                    }
                    self.metrics.inc_positions_closed();
                    closed += 1;
                    info!("Close all: closed position {} for user {} (reason={})", position_id, user_id, reason);
                }
                Err(e) => {
                    warn!("Close all: error closing position {}: {}", position_id, e);
                }
            }
        }
        info!("Close all: finished for user {}, closed {} position(s)", user_id, closed);
        Ok(())
    }
}

