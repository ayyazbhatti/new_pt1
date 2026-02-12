use anyhow::{Context, Result};
use async_nats::Message;
use contracts::{commands::CancelOrderCommand, VersionedMessage};
use redis::aio::ConnectionManager;
use std::sync::Arc;
use tracing::{error, info, instrument, warn};

use crate::engine::{OrderCache, LuaScripts};
use crate::models::OrderCanceledEvent;
use crate::nats::NatsClient;
use crate::observability::Metrics;
use crate::subjects::subjects as nats_subjects;
use crate::utils::now;

pub struct CancelHandler {
    cache: Arc<OrderCache>,
    redis: Arc<crate::redis::RedisClient>,
    nats: Arc<NatsClient>,
    lua: Arc<LuaScripts>,
    metrics: Arc<Metrics>,
}

impl CancelHandler {
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
    pub async fn handle_cancel(&self, msg: Message) -> Result<()> {
        // Deserialize command
        let bytes = msg.payload.to_vec();
        let versioned: VersionedMessage = serde_json::from_slice(&bytes)
            .context("Failed to deserialize versioned message")?;
        
        let cmd: CancelOrderCommand = versioned.deserialize_payload()
            .context("Failed to deserialize CancelOrderCommand")?;
        
        let correlation_id = cmd.idempotency_key.clone();
        info!("Received cancel order command: order_id={}, user_id={}, correlation_id={}",
              cmd.order_id, cmd.user_id, correlation_id);
        
        // Get order from cache or Redis
        let order = if let Some(o) = self.cache.get_order(&cmd.order_id) {
            o
        } else {
            // Load from Redis
            let mut conn = self.redis.get_connection().await;
            let order_key = format!("order:{}", cmd.order_id);
            let order_json: Option<String> = {
                use redis::AsyncCommands;
                conn.get(&order_key).await?
            };
            
            if let Some(json) = order_json {
                serde_json::from_str(&json)?
            } else {
                warn!("Order {} not found", cmd.order_id);
                return Ok(());
            }
        };
        
        // Verify order belongs to user
        if order.user_id != cmd.user_id {
            warn!("Order {} does not belong to user {}", cmd.order_id, cmd.user_id);
            return Ok(());
        }
        
        // Verify order is pending
        if order.status != contracts::enums::OrderStatus::Pending {
            warn!("Order {} is not pending, status: {:?}", cmd.order_id, order.status);
            return Ok(());
        }
        
        // Execute atomic cancel
        let mut conn = self.redis.get_connection().await;
        match self.lua.atomic_cancel_order(&mut conn, &cmd.order_id).await {
            Ok(true) => {
                // Publish canceled event
                let event = OrderCanceledEvent {
                    order_id: cmd.order_id,
                    user_id: cmd.user_id,
                    symbol: order.symbol.clone(),
                    reason: "Canceled by user".to_string(),
                    correlation_id: correlation_id.clone(),
                    ts: now(),
                };
                
                self.nats.publish_event(nats_subjects::EVENT_ORDER_CANCELED, &event).await?;
                self.metrics.inc_orders_canceled();
                
                // Update cache
                self.cache.remove_pending_order(&order.symbol, cmd.order_id);
                
                info!("Order {} canceled", cmd.order_id);
            }
            Ok(false) => {
                warn!("Failed to cancel order {}: not found or not pending", cmd.order_id);
            }
            Err(e) => {
                error!("Error canceling order {}: {}", cmd.order_id, e);
            }
        }
        
        Ok(())
    }
}

