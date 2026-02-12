use anyhow::{Context, Result};
use async_nats::Message;
use contracts::{TickEvent, VersionedMessage};
use redis::aio::ConnectionManager;
use std::sync::Arc;
use std::str::FromStr;
use tracing::{debug, error, info, warn, instrument};
use uuid::Uuid;
use rust_decimal::Decimal;

use crate::engine::{OrderCache, LuaScripts, SltpHandler};
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
    
    #[instrument(skip(self, msg), fields(symbol = %msg.subject))]
    pub async fn handle_tick(&self, msg: Message) -> Result<()> {
        self.metrics.inc_ticks_processed();
        
        // Parse symbol from subject (ticks.BNBUSDT -> BNBUSDT)
        let symbol = nats_subjects::parse_symbol_from_tick_subject(&msg.subject)
            .ok_or_else(|| anyhow::anyhow!("Invalid tick subject: {}", msg.subject))?;
        
        // Deserialize tick event
        let bytes = msg.payload.to_vec();
        let versioned: VersionedMessage = serde_json::from_slice(&bytes)
            .context("Failed to deserialize versioned message")?;
        
        let tick_event: TickEvent = versioned.deserialize_payload()
            .context("Failed to deserialize TickEvent")?;
        
        // Validate tick
        if tick_event.bid <= Decimal::ZERO || tick_event.ask <= Decimal::ZERO {
            warn!("Invalid tick: bid={}, ask={}", tick_event.bid, tick_event.ask);
            return Ok(());
        }
        
        if tick_event.ask < tick_event.bid {
            warn!("Invalid tick: ask < bid, clamping");
            // Clamp: set ask = bid + small spread
            let spread = tick_event.bid * Decimal::from_str("0.0001").unwrap_or(Decimal::ZERO);
            let tick = Tick {
                symbol: symbol.clone(),
                bid: tick_event.bid,
                ask: tick_event.bid + spread,
                ts: tick_event.ts,
                seq: tick_event.seq,
            };
            self.process_tick(tick).await?;
        } else {
            let tick = Tick {
                symbol: symbol.clone(),
                bid: tick_event.bid,
                ask: tick_event.ask,
                ts: tick_event.ts,
                seq: tick_event.seq,
            };
            self.process_tick(tick).await?;
        }
        
        Ok(())
    }
    
    #[instrument(skip(self), fields(symbol = %tick.symbol))]
    async fn process_tick(&self, tick: Tick) -> Result<()> {
        // Store last price in Redis
        let mut conn = self.redis.get_connection().await;
        let price_key = format!("prices:{}", tick.symbol);
        let price_json = serde_json::json!({
            "symbol": tick.symbol,
            "bid": tick.bid.to_string(),
            "ask": tick.ask.to_string(),
            "ts": tick.ts.timestamp_millis(),
        });
        {
            use redis::AsyncCommands;
            conn.set(&price_key, price_json.to_string()).await?;
        }
        
        // Update cache
        self.cache.update_tick(tick.clone());
        
        // Get pending orders for this symbol
        let pending_order_ids = self.cache.get_pending_orders(&tick.symbol);
        
        if pending_order_ids.is_empty() {
            debug!("No pending orders for symbol {}", tick.symbol);
            return Ok(());
        }
        
        info!("Processing {} pending orders for {}", pending_order_ids.len(), tick.symbol);
        
        // Evaluate each pending order
        for order_id in pending_order_ids {
            if let Some(order) = self.cache.get_order(&order_id) {
                if order.status != contracts::enums::OrderStatus::Pending {
                    continue;
                }
                
                // Check if order should fill
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
                    // Determine fill price (BID/ASK model)
                    let fill_price = match order.side {
                        contracts::enums::Side::Buy => tick.ask,  // Buy hits ASK
                        contracts::enums::Side::Sell => tick.bid, // Sell hits BID
                    };
                    
                    // Execute fill atomically
                    match self.execute_fill(&mut conn, &order, fill_price, order.size).await {
                        Ok(_) => {
                            info!("Order {} filled at {}", order_id, fill_price);
                            self.metrics.inc_orders_filled();
                        }
                        Err(e) => {
                            error!("Failed to fill order {}: {}", order_id, e);
                        }
                    }
                }
            }
        }
        
        // Check SL/TP triggers for open positions (event-driven, no polling)
        // Uses range queries for O(log N + M) performance - scales to 1M+ positions
        if let Err(e) = self.sltp_handler.check_and_trigger(&tick.symbol, tick.bid, tick.ask).await {
            error!("SL/TP check failed for {}: {}", tick.symbol, e);
            // Don't fail tick processing, just log the error
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
        // Execute atomic fill via Lua script
        let result = self.lua.atomic_fill_order(conn, &order.id, fill_price, fill_size).await?;
        
        if result.get("error").is_some() {
            let error_msg = result.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
            return Err(anyhow::anyhow!("Lua script error: {}", error_msg));
        }
        
        // Get position_id from result
        let position_id = result
            .get("position_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());
        
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
        
        // Also publish evt.order.updated for PostgreSQL persistence (core-api listens to evt.*)
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
            Ok(_) => {
                info!("📤 Published evt.order.updated for PostgreSQL persistence: order_id={}, status=FILLED", order.id);
            }
            Err(e) => {
                error!("❌ Failed to publish evt.order.updated for order {}: {}", order.id, e);
                // Don't fail the fill if event publishing fails - order is already filled
            }
        }
        
        // Publish position opened event if new position
        if let Some(pos_id) = position_id {
            // Check if this is a new position (would need to query Redis)
            // For now, assume it's new if order was just filled
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
                margin_used: Decimal::ZERO, // Would calculate properly
                correlation_id: order.idempotency_key.clone(),
                ts: now(),
            };
            self.nats.publish_event(nats_subjects::EVENT_POSITION_OPENED, &pos_event).await?;
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

