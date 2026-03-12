use anyhow::{Context, Result};
use async_nats::Message;
use contracts::{TickEvent, VersionedMessage};
use contracts::enums::{PositionSide, PositionStatus};
use redis::aio::ConnectionManager;
use std::collections::HashMap;
use std::sync::Arc;
use std::str::FromStr;
use tracing::{debug, error, info, warn, instrument};
use uuid::Uuid;
use rust_decimal::Decimal;

use crate::engine::cache::normalize_symbol;
use crate::engine::{OrderCache, LuaScripts, SltpHandler, position_events};
use crate::models::{Tick, Order};
use crate::nats::NatsClient;
use crate::observability::Metrics;
use crate::subjects::subjects as nats_subjects;
use crate::utils::now;

pub struct TickHandler {
    cache: Arc<OrderCache>,
    redis: Arc<crate::redis::RedisClient>,
    nats: Arc<NatsClient>,
    lua: Arc<LuaScripts>,
    metrics: Arc<Metrics>,
    sltp_handler: Arc<SltpHandler>,
}

impl TickHandler {
    pub fn new(
        cache: Arc<OrderCache>,
        redis: Arc<crate::redis::RedisClient>,
        nats: Arc<NatsClient>,
        lua: Arc<LuaScripts>,
        metrics: Arc<Metrics>,
        sltp_handler: Arc<SltpHandler>,
    ) -> Self {
        Self {
            cache,
            redis,
            nats,
            lua,
            metrics,
            sltp_handler,
        }
    }
    
    #[instrument(skip(self, msg), fields(subject = %msg.subject))]
    pub async fn handle_tick(&self, msg: Message) -> Result<()> {
        self.metrics.inc_ticks_processed();

        // Per-group subject: ticks.SYMBOL.GROUP_ID (normalize symbol so orders match regardless of case)
        let (symbol, group_id) = match nats_subjects::parse_tick_subject_per_group(&msg.subject) {
            Some((s, g)) => (normalize_symbol(&s), Some(g)),
            None => {
                let s = nats_subjects::parse_symbol_from_tick_subject(&msg.subject)
                    .ok_or_else(|| anyhow::anyhow!("Invalid tick subject: {}", msg.subject))?;
                (normalize_symbol(&s), None)
            }
        };

        let bytes = msg.payload.to_vec();
        let versioned: VersionedMessage = serde_json::from_slice(&bytes)
            .context("Failed to deserialize versioned message")?;

        let tick_event: TickEvent = versioned.deserialize_payload()
            .context("Failed to deserialize TickEvent")?;

        if tick_event.bid <= Decimal::ZERO || tick_event.ask <= Decimal::ZERO {
            warn!("Invalid tick: bid={}, ask={}", tick_event.bid, tick_event.ask);
            return Ok(());
        }

        let (bid, ask) = if tick_event.ask < tick_event.bid {
            let spread = tick_event.bid * Decimal::from_str("0.0001").unwrap_or(Decimal::ZERO);
            (tick_event.bid, tick_event.bid + spread)
        } else {
            (tick_event.bid, tick_event.ask)
        };

        let tick = Tick {
            symbol: symbol.clone(),
            bid,
            ask,
            ts: tick_event.ts,
            seq: tick_event.seq,
        };
        self.process_tick(tick, group_id.as_deref()).await?;

        Ok(())
    }
    
    #[instrument(skip(self), fields(symbol = %tick.symbol))]
    async fn process_tick(&self, tick: Tick, group_id: Option<&str>) -> Result<()> {
        let mut conn = self.redis.get_connection().await;
        let price_key = format!("prices:{}:{}", tick.symbol, group_id.unwrap_or(""));
        let price_json = serde_json::json!({
            "symbol": tick.symbol,
            "bid": tick.bid.to_string(),
            "ask": tick.ask.to_string(),
            "ts": tick.ts.timestamp_millis(),
        });
        {
            use redis::AsyncCommands;
            conn.set::<_, _, ()>(&price_key, price_json.to_string()).await?;
        }

        self.cache.update_tick(tick.clone(), group_id);

        let pending_order_ids = self.cache.get_pending_orders(&tick.symbol);

        if pending_order_ids.is_empty() {
            debug!("No pending orders for symbol {}", tick.symbol);
        } else {
            let mut filled_any = false;
            for order_id in pending_order_ids {
                if let Some(order) = self.cache.get_order(&order_id) {
                    if order.status != contracts::enums::OrderStatus::Pending {
                        continue;
                    }
                    // When tick has no group_id (ticks.SYMBOL), treat as global - fill any order for symbol.
                    // When tick has group_id (ticks.SYMBOL.GROUP_ID): fill orders with same group, or orders with no group (global).
                    if let Some(tick_group) = group_id {
                        if let Some(ref order_group) = order.group_id {
                            if order_group.as_str() != tick_group {
                                continue;
                            }
                        }
                    }

                    let should_fill = match order.order_type {
                        contracts::enums::OrderType::Market => true,
                        contracts::enums::OrderType::Limit => {
                            if let Some(limit_price) = order.limit_price {
                                match order.side {
                                    contracts::enums::Side::Buy => tick.ask <= limit_price,
                                    contracts::enums::Side::Sell => tick.bid >= limit_price,
                                }
                            } else {
                                false
                            }
                        }
                    };

                    if should_fill {
                        let fill_price = match order.side {
                            contracts::enums::Side::Buy => tick.ask,
                            contracts::enums::Side::Sell => tick.bid,
                        };
                        match self.execute_fill(&mut conn, &order, fill_price, order.size).await {
                            Ok(_) => {
                                info!(
                                    order_id = %order_id,
                                    user_id = %order.user_id,
                                    symbol = %order.symbol,
                                    fill_price = %fill_price,
                                    size = %order.size,
                                    "ORDER_FILLED"
                                );
                                self.metrics.inc_orders_filled();
                                filled_any = true;
                            }
                            Err(e) => {
                                let error_msg = e.to_string();
                                if error_msg.contains("order_not_pending") || error_msg.contains("FILLED") {
                                    let order_key = format!("order:{}", order.id);
                                    let order_json: Option<String> = {
                                        use redis::AsyncCommands;
                                        conn.get(&order_key).await.unwrap_or(None)
                                    };
                                    if let Some(json_str) = order_json {
                                        if let Ok(order_data) = serde_json::from_str::<serde_json::Value>(&json_str) {
                                            if let Some(status) = order_data.get("status").and_then(|v| v.as_str()) {
                                                if status == "FILLED" {
                                                    let filled_size = order_data.get("filled_size")
                                                        .and_then(|v| v.as_str())
                                                        .and_then(|s| Decimal::from_str_exact(s).ok())
                                                        .unwrap_or(order.size);
                                                    let avg_fill_price = order_data.get("average_fill_price")
                                                        .and_then(|v| v.as_str())
                                                        .and_then(|s| Decimal::from_str_exact(s).ok());
                                                    let order_updated_event = contracts::events::OrderUpdatedEvent {
                                                        order_id: order.id,
                                                        user_id: order.user_id,
                                                        status: contracts::enums::OrderStatus::Filled,
                                                        filled_size,
                                                        avg_fill_price,
                                                        reason: None,
                                                        ts: now(),
                                                    };
                                                    if let Err(pub_err) = self.nats.publish_event(nats_subjects::EVENT_ORDER_UPDATED, &order_updated_event).await {
                                                        error!("❌ Failed to publish evt.order.updated: {}", pub_err);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    error!("Failed to fill order {}: {}", order_id, e);
                                }
                            }
                        }
                    }
                }
            }
            if filled_any {
                // Remove filled orders from pending in cache is done in execute_fill
            }
        }

        // Run SL/TP check on every tick. Pass empty string when no group_id so Lua checks all
        // positions for this symbol (data-provider publishes ticks.SYMBOL with no group).
        let gid = group_id.unwrap_or("");
        if let Err(e) = self.sltp_handler.check_and_trigger(&tick.symbol, gid, tick.bid, tick.ask).await {
            error!("SL/TP check failed for {}: {}", tick.symbol, e);
        }

        Ok(())
    }

    async fn execute_fill(
        &self,
        conn: &mut ConnectionManager,
        order: &Order,
        fill_price: rust_decimal::Decimal,
        fill_size: rust_decimal::Decimal,
    ) -> Result<()> {
        let notional = fill_price * fill_size;
        let effective_lev = crate::leverage::effective_leverage(
            notional,
            order.min_leverage,
            order.max_leverage,
            order.leverage_tiers.as_deref(),
            100.0,
        );
        let result = self.lua.atomic_fill_order(conn, &order.id, fill_price, fill_size, effective_lev).await?;
        
        if result.get("error").is_some() {
            let error_msg = result.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
            return Err(anyhow::anyhow!("Lua script error: {}", error_msg));
        }
        
        let fill_action = result.get("fill_action").and_then(|v| v.as_str()).unwrap_or("created");
        let position_id = result
            .get("position_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let closed_position_id = result
            .get("closed_position_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        let closed_size = result.get("closed_position_size")
            .and_then(|v| v.as_str())
            .and_then(|s| Decimal::from_str_exact(s).ok())
            .unwrap_or(fill_size);
        let _realized_pnl = result.get("realized_pnl").and_then(|v| v.as_str()).and_then(|s| Decimal::from_str_exact(s).ok());
        
        // Publish order filled event
        let event = crate::models::OrderFilledEvent {
            order_id: order.id,
            user_id: order.user_id,
            symbol: order.symbol.clone(),
            side: order.side,
            filled_size: fill_size,
            average_fill_price: fill_price,
            position_id,
            correlation_id: order.idempotency_key.clone(),
            ts: now(),
        };
        
        self.nats.publish_event(nats_subjects::EVENT_ORDER_FILLED, &event).await?;
        
        // Also publish evt.order.updated for PostgreSQL persistence
        let order_updated_event = contracts::events::OrderUpdatedEvent {
            order_id: order.id,
            user_id: order.user_id,
            status: contracts::enums::OrderStatus::Filled,
            filled_size: fill_size,
            avg_fill_price: Some(fill_price),
            reason: None,
            ts: now(),
        };
        match self.nats.publish_event(nats_subjects::EVENT_ORDER_UPDATED, &order_updated_event).await {
            Ok(_) => { info!("📤 Published evt.order.updated order_id={}, status=FILLED", order.id); }
            Err(e) => { error!("❌ Failed to publish evt.order.updated for order {}: {}", order.id, e); }
        }
        
        // Netting: publish position closed when we reduced to zero or flipped
        if let Some(closed_id) = closed_position_id {
            let closed_side = result.get("closed_position_side").and_then(|v| v.as_str()).unwrap_or("LONG");
            let pos_side = if closed_side == "SHORT" { contracts::enums::PositionSide::Short } else { contracts::enums::PositionSide::Long };
            let closed_event = crate::models::PositionClosedEvent {
                position_id: closed_id,
                user_id: order.user_id,
                symbol: order.symbol.clone(),
                side: pos_side,
                closed_size,
                exit_price: fill_price,
                realized_pnl: _realized_pnl.unwrap_or(Decimal::ZERO),
                correlation_id: order.idempotency_key.clone(),
                ts: now(),
                trigger_reason: None,
            };
            self.nats.publish_event(nats_subjects::EVENT_POSITION_CLOSED, &closed_event).await?;
            let _ = position_events::publish_position_updated(self.nats.as_ref(), conn, closed_id, Some(PositionStatus::Closed)).await;
        }
        
        // Publish position opened only when a new position was created (not when adding to existing)
        if let Some(pos_id) = position_id {
            if fill_action == "created" {
                let pos_event = crate::models::PositionOpenedEvent {
                    position_id: pos_id,
                    user_id: order.user_id,
                    symbol: order.symbol.clone(),
                    side: match order.side {
                        contracts::enums::Side::Buy => contracts::enums::PositionSide::Long,
                        contracts::enums::Side::Sell => contracts::enums::PositionSide::Short,
                    },
                    size: fill_size,
                    entry_price: fill_price,
                    leverage: Decimal::from(100),
                    margin_used: Decimal::ZERO,
                    correlation_id: order.idempotency_key.clone(),
                    ts: now(),
                };
                self.nats.publish_event(nats_subjects::EVENT_POSITION_OPENED, &pos_event).await?;
            }
            if fill_action == "flipped" {
                let raw: HashMap<String, String> = redis::cmd("HGETALL").arg(format!("pos:by_id:{}", pos_id)).query_async(conn).await.unwrap_or_default();
                let size = raw.get("size").and_then(|s| Decimal::from_str_exact(s).ok()).unwrap_or(fill_size);
                let entry = raw.get("entry_price").or(raw.get("avg_price")).and_then(|s| Decimal::from_str_exact(s).ok()).unwrap_or(fill_price);
                let side_str = raw.get("side").map(|s| s.as_str()).unwrap_or("LONG");
                let pos_side = if side_str == "SHORT" { contracts::enums::PositionSide::Short } else { contracts::enums::PositionSide::Long };
                let pos_event = crate::models::PositionOpenedEvent {
                    position_id: pos_id,
                    user_id: order.user_id,
                    symbol: order.symbol.clone(),
                    side: pos_side,
                    size,
                    entry_price: entry,
                    leverage: Decimal::from(100),
                    margin_used: Decimal::ZERO,
                    correlation_id: order.idempotency_key.clone(),
                    ts: now(),
                };
                self.nats.publish_event(nats_subjects::EVENT_POSITION_OPENED, &pos_event).await?;
            }
            let _ = position_events::publish_position_updated(self.nats.as_ref(), conn, pos_id, None).await;
        }
        
        // Update cache
        let mut updated_order = order.clone();
        updated_order.status = contracts::enums::OrderStatus::Filled;
        updated_order.filled_size = fill_size;
        updated_order.average_fill_price = Some(fill_price);
        updated_order.filled_at = Some(now());
        self.cache.update_order(updated_order.clone());
        self.cache.remove_pending_order(&order.symbol, order.id);
        
        Ok(())
    }
}

