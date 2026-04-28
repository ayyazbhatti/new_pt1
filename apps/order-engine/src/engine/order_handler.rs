use anyhow::{Context, Result};
use async_nats::Message;
use contracts::{commands::PlaceOrderCommand, VersionedMessage};
use contracts::enums::PositionStatus;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{debug, error, info, instrument, warn};
use uuid::Uuid;
use rust_decimal::Decimal;

use crate::engine::cache::normalize_symbol;
use crate::engine::{OrderCache, LuaScripts, Validator, position_events};
use crate::models::{Order, OrderCommand, OrderAcceptedEvent, OrderRejectedEvent, OrderFilledEvent};
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
    lua: Arc<LuaScripts>,
}

impl OrderHandler {
    pub fn new(
        cache: Arc<OrderCache>,
        redis: Arc<crate::redis::RedisClient>,
        nats: Arc<NatsClient>,
        validator: Arc<Validator>,
        metrics: Arc<Metrics>,
        lua: Arc<LuaScripts>,
    ) -> Self {
        Self {
            cache,
            redis,
            nats,
            validator,
            metrics,
            lua,
        }
    }

    async fn resolve_market_fill_price(
        &self,
        symbol: &str,
        group_id: Option<&str>,
        side: contracts::enums::Side,
    ) -> Option<Decimal> {
        if let Some(tick) = self
            .cache
            .get_last_tick(symbol, group_id)
            .or_else(|| self.cache.get_last_tick(symbol, None))
        {
            return Some(match side {
                contracts::enums::Side::Buy => tick.ask,
                contracts::enums::Side::Sell => tick.bid,
            });
        }

        // Fallback: use latest Redis cached quote for this symbol/group.
        let mut conn = self.redis.get_connection().await;
        let mut keys: Vec<String> = Vec::new();
        if let Some(gid) = group_id {
            keys.push(format!("prices:{}:{}", symbol, gid));
        }
        keys.push(format!("prices:{}:", symbol));

        for key in keys {
            let raw: Option<String> = conn.get(&key).await.ok().flatten();
            let Some(raw) = raw else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let ask = json
                .get("ask")
                .and_then(|v| {
                    v.as_str()
                        .and_then(|s| Decimal::from_str_exact(s).ok())
                        .or_else(|| Decimal::from_str_exact(&v.to_string().trim_matches('"').to_string()).ok())
                });
            let bid = json
                .get("bid")
                .and_then(|v| {
                    v.as_str()
                        .and_then(|s| Decimal::from_str_exact(s).ok())
                        .or_else(|| Decimal::from_str_exact(&v.to_string().trim_matches('"').to_string()).ok())
                });

            let price = match side {
                contracts::enums::Side::Buy => ask,
                contracts::enums::Side::Sell => bid,
            };
            if let Some(fill_price) = price {
                return Some(fill_price);
            }
        }

        None
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
                error!(error = %e, payload_preview = %preview, "ORDER_ERROR stage=deserialize_versioned_message");
                return Err(anyhow::anyhow!("Deserialization failed: {}", e).into());
            }
        };
        
        let cmd: PlaceOrderCommand = match versioned.deserialize_payload::<PlaceOrderCommand>() {
            Ok(c) => {
                info!("✅ Deserialized PlaceOrderCommand: idempotency_key={}", c.idempotency_key);
                c
            }
            Err(e) => {
                error!(error = %e, "ORDER_ERROR stage=deserialize_place_order_command");
                return Err(anyhow::anyhow!("Command deserialization failed: {}", e).into());
            }
        };
        
        let correlation_id = cmd.idempotency_key.clone();
        info!("📋 Processing order: user={}, symbol={}, side={:?}, type={:?}, account_type={:?}, idempotency_key={}",
              cmd.user_id, cmd.symbol, cmd.side, cmd.order_type, cmd.account_type, correlation_id);
        
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
        
        let market_price_hint = if cmd.order_type == contracts::enums::OrderType::Market {
            self.cache
                .get_last_tick(&cmd.symbol, cmd.group_id.as_deref())
                .or_else(|| self.cache.get_last_tick(&cmd.symbol, None))
                .map(|tick| match cmd.side {
                    contracts::enums::Side::Buy => tick.ask,
                    contracts::enums::Side::Sell => tick.bid,
                })
        } else {
            None
        };

        // Convert to internal command format
        let order_cmd = OrderCommand {
            user_id: cmd.user_id,
            symbol: cmd.symbol.clone(),
            group_id: cmd.group_id.clone(),
            side: cmd.side,
            order_type: cmd.order_type,
            size: cmd.size,
            limit_price: cmd.limit_price,
            market_price_hint,
            stop_loss: cmd.sl,
            take_profit: cmd.tp,
            time_in_force: cmd.tif,
            client_order_id: cmd.client_order_id.clone(),
            idempotency_key: cmd.idempotency_key.clone(),
            min_leverage: cmd.min_leverage,
            max_leverage: cmd.max_leverage,
            leverage_tiers: cmd.leverage_tiers.as_ref().map(|tiers| {
                tiers
                    .iter()
                    .map(|t| crate::models::LeverageTier {
                        notional_from: t.notional_from.clone(),
                        notional_to: t.notional_to.clone(),
                        max_leverage: t.max_leverage,
                    })
                    .collect()
            }),
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
                
                // Create order object (include leverage for fill-time margin calculation)
                let leverage_tiers: Option<Vec<crate::models::LeverageTier>> = cmd.leverage_tiers.as_ref().map(|tiers| {
                    tiers.iter().map(|t| crate::models::LeverageTier {
                        notional_from: t.notional_from.clone(),
                        notional_to: t.notional_to.clone(),
                        max_leverage: t.max_leverage,
                    }).collect()
                });
                let symbol_normalized = normalize_symbol(&cmd.symbol);
                let order = Order {
                    id: order_id,
                    user_id: cmd.user_id,
                    symbol: symbol_normalized.clone(),
                    group_id: cmd.group_id.clone(),
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
                    min_leverage: cmd.min_leverage,
                    max_leverage: cmd.max_leverage,
                    leverage_tiers,
                    account_type: cmd.account_type.or_else(|| Some("hedging".to_string())),
                };
                
                // Store order in Redis
                let order_key = format!("order:{}", order_id);
                let order_json = serde_json::to_string(&order)?;
                let _: () = redis::cmd("SET")
                    .arg(&order_key)
                    .arg(&order_json)
                    .query_async(&mut conn)
                    .await?;
                
                // Add to pending zset (use normalized symbol so ticks match regardless of case)
                let pending_key = format!("orders:pending:{}", symbol_normalized);
                let _: () = redis::cmd("ZADD")
                    .arg(&pending_key)
                    .arg(now().timestamp_millis())
                    .arg(order_id.to_string())
                    .query_async(&mut conn)
                    .await?;
                
                // Update cache
                self.cache.add_pending_order(&order.symbol, order_id, order.clone());
                
                // Publish accepted event
                let accepted_event = OrderAcceptedEvent {
                    order_id,
                    user_id: cmd.user_id,
                    symbol: order.symbol.clone(),
                    side: cmd.side,
                    order_type: cmd.order_type,
                    size: cmd.size,
                    correlation_id: correlation_id.clone(),
                    ts: now(),
                };
                self.nats.publish_event(nats_subjects::EVENT_ORDER_ACCEPTED, &accepted_event).await?;
                
                info!(
                    order_id = %order_id,
                    user_id = %cmd.user_id,
                    symbol = %cmd.symbol,
                    side = ?cmd.side,
                    order_type = ?cmd.order_type,
                    size = %cmd.size,
                    "ORDER_ACCEPTED"
                );
                
                // For market orders, try immediate execution from in-memory tick first, then Redis quote fallback.
                if cmd.order_type == contracts::enums::OrderType::Market {
                    if let Some(fill_price) = self
                        .resolve_market_fill_price(&cmd.symbol, cmd.group_id.as_deref(), cmd.side)
                        .await
                    {
                        
                        info!("🚀 Executing market order {} immediately at price {}", order_id, fill_price);
                        
                        let notional = fill_price * order.size;
                        if let Some(eff) = crate::leverage::effective_leverage(
                            notional,
                            order.min_leverage,
                            order.max_leverage,
                            order.leverage_tiers.as_deref(),
                        ) {
                        if eff > Decimal::ZERO {
                        let mut conn = self.redis.get_connection().await;
                        match self.lua.atomic_fill_order(&mut conn, &order_id, fill_price, order.size, eff).await {
                            Ok(result) => {
                                if result.get("error").is_some() {
                                    let error_msg = result.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
                                    warn!("Failed to fill market order {} immediately: {}", order_id, error_msg);
                                    // Order will be processed on next tick
                                } else {
                                    info!(
                                        order_id = %order_id,
                                        user_id = %cmd.user_id,
                                        symbol = %cmd.symbol,
                                        fill_price = %fill_price,
                                        size = %order.size,
                                        "ORDER_FILLED"
                                    );
                                    self.metrics.inc_orders_filled();
                                    
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
                                        .unwrap_or(order.size);
                                    let realized_pnl = result.get("realized_pnl").and_then(|v| v.as_str()).and_then(|s| Decimal::from_str_exact(s).ok()).unwrap_or(Decimal::ZERO);
                                    
                                    // Publish order filled event
                                    let filled_event = OrderFilledEvent {
                                        order_id,
                                        user_id: cmd.user_id,
                                        symbol: cmd.symbol.clone(),
                                        side: cmd.side,
                                        filled_size: order.size,
                                        average_fill_price: fill_price,
                                        position_id,
                                        correlation_id: correlation_id.clone(),
                                        ts: now(),
                                    };
                                    
                                    if let Err(e) = self.nats.publish_event(nats_subjects::EVENT_ORDER_FILLED, &filled_event).await {
                                        error!("Failed to publish order filled event: {}", e);
                                    }
                                    
                                    if let Err(e) = self.nats.publish_event(nats_subjects::EVENT_ORDER_UPDATED, &contracts::events::OrderUpdatedEvent {
                                        order_id,
                                        user_id: cmd.user_id,
                                        status: contracts::enums::OrderStatus::Filled,
                                        filled_size: order.size,
                                        avg_fill_price: Some(fill_price),
                                        reason: None,
                                        ts: now(),
                                    }).await {
                                        error!("Failed to publish order updated event: {}", e);
                                    }
                                    
                                    // Netting: position closed (full close or flip)
                                    if let Some(closed_id) = closed_position_id {
                                        let closed_side = result.get("closed_position_side").and_then(|v| v.as_str()).unwrap_or("LONG");
                                        let pos_side = if closed_side == "SHORT" { contracts::enums::PositionSide::Short } else { contracts::enums::PositionSide::Long };
                                        let closed_event = crate::models::PositionClosedEvent {
                                            position_id: closed_id,
                                            user_id: cmd.user_id,
                                            symbol: cmd.symbol.clone(),
                                            side: pos_side,
                                            closed_size,
                                            exit_price: fill_price,
                                            realized_pnl,
                                            correlation_id: correlation_id.clone(),
                                            ts: now(),
                                            trigger_reason: None,
                                        };
                                        let _ = self.nats.publish_event(nats_subjects::EVENT_POSITION_CLOSED, &closed_event).await;
                                        let _ = position_events::publish_position_updated(self.nats.as_ref(), &mut conn, closed_id, Some(PositionStatus::Closed)).await;
                                    }
                                    // Position opened (created or flipped)
                                    if let Some(pos_id) = position_id {
                                        if fill_action == "created" {
                                            let margin_used = (order.size * fill_price) / eff;
                                            let pos_event = crate::models::PositionOpenedEvent {
                                                position_id: pos_id,
                                                user_id: cmd.user_id,
                                                symbol: cmd.symbol.clone(),
                                                side: match cmd.side { contracts::enums::Side::Buy => contracts::enums::PositionSide::Long, contracts::enums::Side::Sell => contracts::enums::PositionSide::Short },
                                                size: order.size,
                                                entry_price: fill_price,
                                                leverage: eff,
                                                margin_used,
                                                correlation_id: correlation_id.clone(),
                                                ts: now(),
                                            };
                                            let _ = self.nats.publish_event(nats_subjects::EVENT_POSITION_OPENED, &pos_event).await;
                                        }
                                        if fill_action == "flipped" {
                                            let raw: HashMap<String, String> = redis::cmd("HGETALL").arg(format!("pos:by_id:{}", pos_id)).query_async(&mut conn).await.unwrap_or_default();
                                            let size = raw.get("size").and_then(|s| Decimal::from_str_exact(s).ok()).unwrap_or(order.size);
                                            let entry = raw.get("entry_price").or(raw.get("avg_price")).and_then(|s| Decimal::from_str_exact(s).ok()).unwrap_or(fill_price);
                                            let side_str = raw.get("side").map(|s| s.as_str()).unwrap_or("LONG");
                                            let pos_side = if side_str == "SHORT" { contracts::enums::PositionSide::Short } else { contracts::enums::PositionSide::Long };
                                            let lev = raw
                                                .get("leverage")
                                                .and_then(|s| Decimal::from_str_exact(s).ok())
                                                .unwrap_or(eff);
                                            let margin_used = raw
                                                .get("margin")
                                                .and_then(|s| Decimal::from_str_exact(s).ok())
                                                .unwrap_or((size * entry) / lev);
                                            let pos_event = crate::models::PositionOpenedEvent {
                                                position_id: pos_id,
                                                user_id: cmd.user_id,
                                                symbol: cmd.symbol.clone(),
                                                side: pos_side,
                                                size,
                                                entry_price: entry,
                                                leverage: lev,
                                                margin_used,
                                                correlation_id: correlation_id.clone(),
                                                ts: now(),
                                            };
                                            let _ = self.nats.publish_event(nats_subjects::EVENT_POSITION_OPENED, &pos_event).await;
                                        }
                                        let _ = position_events::publish_position_updated(self.nats.as_ref(), &mut conn, pos_id, None).await;
                                    }
                                    
                                    let mut updated_order = order.clone();
                                    updated_order.status = contracts::enums::OrderStatus::Filled;
                                    updated_order.filled_size = order.size;
                                    updated_order.average_fill_price = Some(fill_price);
                                    updated_order.filled_at = Some(now());
                                    self.cache.update_order(updated_order);
                                    self.cache.remove_pending_order(&cmd.symbol, order_id);
                                }
                            }
                            Err(e) => {
                                warn!("Failed to execute immediate fill for market order {}: {}", order_id, e);
                                // Order will be processed on next tick
                            }
                        }
                        } else {
                            warn!(order_id = %order_id, "Effective leverage not positive; skipping immediate fill");
                        }
                        } else {
                            warn!(
                                order_id = %order_id,
                                "Cannot resolve effective leverage for immediate market fill; order will use tick path"
                            );
                        }
                    } else {
                        debug!(
                            "Market order {} accepted, waiting for first tick (no cache tick or Redis quote)",
                            order_id
                        );
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
                // Also publish unified order-updated event so persistence listeners
                // can transition DB state out of pending deterministically.
                self.nats.publish_event(
                    nats_subjects::EVENT_ORDER_UPDATED,
                    &contracts::events::OrderUpdatedEvent {
                        order_id,
                        user_id: cmd.user_id,
                        status: contracts::enums::OrderStatus::Rejected,
                        filled_size: Decimal::ZERO,
                        avg_fill_price: None,
                        reason: Some(rejection_reason.clone()),
                        ts: now(),
                    },
                ).await?;
                self.metrics.inc_orders_rejected();
                
                error!(
                    order_id = %order_id,
                    user_id = %cmd.user_id,
                    symbol = %cmd.symbol,
                    reason = %rejection_reason,
                    "ORDER_REJECTED"
                );
            }
        }
        
        Ok(())
    }
}

