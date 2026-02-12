use anyhow::{Context, Result};
use async_nats::Message;
use contracts::{commands::PlaceOrderCommand, VersionedMessage};
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::sync::Arc;
use tracing::{debug, error, info, instrument, warn};
use uuid::Uuid;

use crate::engine::{OrderCache, LuaScripts, Validator};
use crate::models::{Order, OrderCommand, OrderAcceptedEvent, OrderRejectedEvent};
use crate::nats::NatsClient;
use crate::observability::Metrics;
use crate::subjects::subjects as nats_subjects;
use crate::utils::{generate_order_id, now};

pub struct OrderHandler {
    cache: Arc<OrderCache>,
    redis: Arc<crate::redis::RedisClient>,
    nats: Arc<NatsClient>,
    validator: Arc<Validator>,
    metrics: Arc<Metrics>,
}

impl OrderHandler {
    pub fn new(
        cache: Arc<OrderCache>,
        redis: Arc<crate::redis::RedisClient>,
        nats: Arc<NatsClient>,
        validator: Arc<Validator>,
        metrics: Arc<Metrics>,
    ) -> Self {
        Self {
            cache,
            redis,
            nats,
            validator,
            metrics,
        }
    }
    
    #[instrument(skip(self, msg))]
    pub async fn handle_place_order(&self, msg: Message) -> Result<()> {
        let payload_size = msg.payload.len();
        info!("🚀 HANDLER ENTRY: handle_place_order() called - subject={}, payload_size={} bytes", 
              msg.subject, payload_size);
        
        self.metrics.inc_orders_processed();
        
        // Deserialize command
        let bytes = msg.payload.to_vec();
        info!("🔍 Deserializing VersionedMessage from {} bytes", bytes.len());
        
        let versioned: VersionedMessage = match serde_json::from_slice::<VersionedMessage>(&bytes) {
            Ok(v) => {
                info!("✅ Deserialized VersionedMessage: type={}, v={}", v.r#type, v.v);
                v
            }
            Err(e) => {
                let preview = if bytes.len() > 100 {
                    format!("{:?}...", &bytes[..100])
                } else {
                    format!("{:?}", bytes)
                };
                error!("❌ Deserialization failed: {}. Message preview: {}", e, preview);
                return Err(anyhow::anyhow!("Deserialization failed: {}", e).into());
            }
        };
        
        let cmd: PlaceOrderCommand = match versioned.deserialize_payload::<PlaceOrderCommand>() {
            Ok(c) => {
                info!("✅ Deserialized PlaceOrderCommand: idempotency_key={}", c.idempotency_key);
                c
            }
            Err(e) => {
                error!("❌ Failed to deserialize PlaceOrderCommand: {}", e);
                return Err(anyhow::anyhow!("Command deserialization failed: {}", e).into());
            }
        };
        
        let correlation_id = cmd.idempotency_key.clone();
        info!("📋 Processing order: user={}, symbol={}, side={:?}, type={:?}, idempotency_key={}",
              cmd.user_id, cmd.symbol, cmd.side, cmd.order_type, correlation_id);
        
        // Check idempotency
        info!("🔍 Checking idempotency for key: {}", correlation_id);
        let mut conn = self.redis.get_connection().await;
        let idempotency_key = format!("idempotency:{}", cmd.idempotency_key);
        let existing: Option<String> = {
            use redis::AsyncCommands;
            conn.get(&idempotency_key).await?
        };
        
        if existing.is_some() {
            warn!("⚠️ Duplicate order detected: {}", cmd.idempotency_key);
            // Return existing order (would need to fetch from Redis)
            return Ok(());
        } else {
            info!("✅ New order, proceeding with processing");
        }
        
        // Convert to internal command format
        let order_cmd = OrderCommand {
            user_id: cmd.user_id,
            symbol: cmd.symbol.clone(),
            side: cmd.side,
            order_type: cmd.order_type,
            size: cmd.size,
            limit_price: cmd.limit_price,
            stop_loss: cmd.sl,
            take_profit: cmd.tp,
            time_in_force: cmd.tif,
            client_order_id: cmd.client_order_id.clone(),
            idempotency_key: cmd.idempotency_key.clone(),
            correlation_id: correlation_id.clone(),
            ts: cmd.ts,
        };
        
        // Validate order
        match self.validator.validate_order(&mut conn, &order_cmd).await {
            Ok(_) => {
                // Use order_id from command (set by auth-service from database)
                let order_id = cmd.order_id;
                
                info!("Using order_id from command: {}", order_id);
                
                // Store idempotency key
                let _: () = redis::cmd("SETEX")
                    .arg(&idempotency_key)
                    .arg(1800) // 30 min TTL
                    .arg(order_id.to_string())
                    .query_async(&mut conn)
                    .await?;
                
                // Create order object
                let order = Order {
                    id: order_id,
                    user_id: cmd.user_id,
                    symbol: cmd.symbol.clone(),
                    side: cmd.side,
                    order_type: cmd.order_type,
                    size: cmd.size,
                    limit_price: cmd.limit_price,
                    stop_loss: cmd.sl,
                    take_profit: cmd.tp,
                    time_in_force: cmd.tif,
                    status: contracts::enums::OrderStatus::Pending,
                    filled_size: rust_decimal::Decimal::ZERO,
                    average_fill_price: None,
                    client_order_id: cmd.client_order_id,
                    idempotency_key: cmd.idempotency_key.clone(),
                    created_at: now(),
                    updated_at: now(),
                    filled_at: None,
                    canceled_at: None,
                    rejection_reason: None,
                };
                
                // Store order in Redis
                let order_key = format!("order:{}", order_id);
                let order_json = serde_json::to_string(&order)?;
                let _: () = redis::cmd("SET")
                    .arg(&order_key)
                    .arg(&order_json)
                    .query_async(&mut conn)
                    .await?;
                
                // Add to pending zset
                let pending_key = format!("orders:pending:{}", cmd.symbol);
                let _: () = redis::cmd("ZADD")
                    .arg(&pending_key)
                    .arg(now().timestamp_millis())
                    .arg(order_id.to_string())
                    .query_async(&mut conn)
                    .await?;
                
                // Update cache
                self.cache.add_pending_order(&cmd.symbol, order_id, order.clone());
                
                // Publish accepted event
                let accepted_event = OrderAcceptedEvent {
                    order_id,
                    user_id: cmd.user_id,
                    symbol: cmd.symbol.clone(),
                    side: cmd.side,
                    order_type: cmd.order_type,
                    size: cmd.size,
                    correlation_id: correlation_id.clone(),
                    ts: now(),
                };
                self.nats.publish_event(nats_subjects::EVENT_ORDER_ACCEPTED, &accepted_event).await?;
                
                info!("Order {} accepted for symbol {}", order_id, cmd.symbol);
                
                // For market orders, try immediate execution if tick exists
                if cmd.order_type == contracts::enums::OrderType::Market {
                    if let Some(tick) = self.cache.get_last_tick(&cmd.symbol) {
                        // Execute immediately
                        let fill_price = match cmd.side {
                            contracts::enums::Side::Buy => tick.ask,
                            contracts::enums::Side::Sell => tick.bid,
                        };
                        
                        // Use tick handler's execute_fill logic
                        // For now, just log - tick handler will process on next tick
                        debug!("Market order {} will execute on next tick", order_id);
                    } else {
                        debug!("Market order {} accepted, waiting for first tick", order_id);
                    }
                }
            }
            Err(e) => {
                // Reject order - use order_id from command if available
                let order_id = cmd.order_id;
                let rejection_reason = e.to_string();
                
                let rejected_event = OrderRejectedEvent {
                    order_id,
                    user_id: cmd.user_id,
                    symbol: cmd.symbol.clone(),
                    reason: rejection_reason.clone(),
                    correlation_id: correlation_id.clone(),
                    ts: now(),
                };
                
                self.nats.publish_event(nats_subjects::EVENT_ORDER_REJECTED, &rejected_event).await?;
                self.metrics.inc_orders_rejected();
                
                warn!("Order rejected: {}", rejection_reason);
            }
        }
        
        Ok(())
    }
}

