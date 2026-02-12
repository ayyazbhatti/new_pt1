use crate::AppState;
use chrono::Utc;
use contracts::{
    commands::{CancelOrderCommand, PlaceOrderCommand},
    enums::{OrderStatus, OrderType, PositionSide, PositionStatus, Side, TimeInForce},
    events::{BalanceUpdatedEvent, OrderUpdatedEvent, PositionUpdatedEvent},
    VersionedMessage,
};
use redis::AsyncCommands;
use redis_model::keys::Keys;
use redis_model::models::*;
use risk::{calculate_margin, has_sufficient_margin};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use std::str::FromStr;
use tracing::{error, info};
use uuid::Uuid;

pub async fn execute_place_order(cmd: PlaceOrderCommand, state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    info!("Processing place order: user={}, symbol={}, side={:?}, type={:?}", 
          cmd.user_id, cmd.symbol, cmd.side, cmd.order_type);

    // Check idempotency
    let idempotency_key = Keys::idempotency(cmd.user_id, &cmd.idempotency_key);
    let mut conn = state.redis.get_async_connection().await?;
    
    let existing: Option<String> = conn.get(&idempotency_key).await?;
    if let Some(existing_order_id) = existing {
        info!("Duplicate order detected, returning existing order_id: {}", existing_order_id);
        // Return existing order update
        let order_id = Uuid::parse_str(&existing_order_id)?;
        let event = OrderUpdatedEvent {
            order_id,
            user_id: cmd.user_id,
            status: OrderStatus::Pending,
            filled_size: dec!(0),
            avg_fill_price: None,
            reason: Some("Duplicate idempotency key".to_string()),
            ts: Utc::now(),
        };
        publish_event("evt.order.updated", &event, state).await?;
        return Ok(());
    }

    // Get latest tick
    let tick = {
        let ticks = state.last_ticks.read().await;
        ticks.get(&cmd.symbol)
            .ok_or_else(|| format!("No tick data for symbol {}", cmd.symbol))?
            .clone()
    };

    // Determine fill price based on order type and side
    let fill_price = match cmd.order_type {
        OrderType::Market => {
            match cmd.side {
                Side::Buy => tick.ask,  // BUY fills at ASK
                Side::Sell => tick.bid, // SELL fills at BID
            }
        }
        OrderType::Limit => {
            let limit_price = cmd.limit_price
                .ok_or_else(|| "Limit order must have limit_price".to_string())?;
            
            // Check if limit should trigger
            let should_trigger = match cmd.side {
                Side::Buy => tick.ask <= limit_price,  // LIMIT BUY triggers when ASK <= limit_price
                Side::Sell => tick.bid >= limit_price, // LIMIT SELL triggers when BID >= limit_price
            };
            
            if !should_trigger {
                // Store as pending limit order
                return store_pending_order(cmd, state, &mut conn).await;
            }
            
            limit_price
        }
    };

    // Execute order
    let order_id = Uuid::new_v4();
    
    // Store idempotency key
    let _: () = conn.set_ex(&idempotency_key, order_id.to_string(), 86400).await?; // 24h TTL

    // Calculate margin requirement (simplified - use default leverage for now)
    let leverage = dec!(100.0);
    let margin_required = calculate_margin(cmd.size, fill_price, leverage);

    // Check balance and reserve margin
    let balance_key = Keys::balance(cmd.user_id, "USD");
    let balance: Option<BalanceModel> = get_redis_hash(&mut conn, &balance_key).await?;
    
    let mut balance = balance.unwrap_or_else(|| BalanceModel {
        available: dec!(10000.0), // Default balance
        locked: dec!(0),
        equity: dec!(10000.0),
        margin_used: dec!(0),
        free_margin: dec!(10000.0),
        updated_at: Utc::now().timestamp_millis(),
    });

    if !has_sufficient_margin(balance.free_margin, margin_required) {
        let event = OrderUpdatedEvent {
            order_id,
            user_id: cmd.user_id,
            status: OrderStatus::Rejected,
            filled_size: dec!(0),
            avg_fill_price: None,
            reason: Some("Insufficient margin".to_string()),
            ts: Utc::now(),
        };
        publish_event("evt.order.updated", &event, state).await?;
        return Ok(());
    }

    // Reserve margin
    balance.locked += margin_required;
    balance.free_margin -= margin_required;
    balance.updated_at = Utc::now().timestamp_millis();
    set_redis_hash(&mut conn, &balance_key, &balance).await?;

    // Create order record
    let order = OrderModel {
        user_id: cmd.user_id,
        symbol: cmd.symbol.clone(),
        side: cmd.side,
        order_type: cmd.order_type,
        limit_price: cmd.limit_price,
        size: cmd.size,
        status: OrderStatus::Filled,
        tif: cmd.tif,
        sl: cmd.sl,
        tp: cmd.tp,
        created_at: Utc::now().timestamp_millis(),
        updated_at: Utc::now().timestamp_millis(),
        client_order_id: cmd.client_order_id,
        idempotency_key: cmd.idempotency_key,
    };

    let order_key = Keys::order_by_id(order_id);
    set_redis_hash(&mut conn, &order_key, &order).await?;

    // Add to open orders set (for tracking)
    let orders_open_key = Keys::orders_open(cmd.user_id);
    let _: () = conn.zadd(&orders_open_key, order_id.to_string(), order.created_at).await?;

    // Update or create position
    let position_id = update_position(
        &mut conn,
        cmd.user_id,
        &cmd.symbol,
        cmd.side,
        cmd.size,
        fill_price,
        cmd.sl,
        cmd.tp,
        leverage,
        margin_required,
    ).await?;

    // Update balance: move locked to margin_used
    balance.margin_used += margin_required;
    balance.locked -= margin_required;
    balance.updated_at = Utc::now().timestamp_millis();
    set_redis_hash(&mut conn, &balance_key, &balance).await?;

    // Publish events
    let order_event = OrderUpdatedEvent {
        order_id,
        user_id: cmd.user_id,
        status: OrderStatus::Filled,
        filled_size: cmd.size,
        avg_fill_price: Some(fill_price),
        reason: None,
        ts: Utc::now(),
    };
    publish_event("evt.order.updated", &order_event, state).await?;

    let position_event = PositionUpdatedEvent {
        position_id,
        user_id: cmd.user_id,
        symbol: cmd.symbol,
        side: match cmd.side {
            Side::Buy => PositionSide::Long,
            Side::Sell => PositionSide::Short,
        },
        size: cmd.size,
        avg_price: fill_price,
        unrealized_pnl: dec!(0), // Will be updated on next tick
        realized_pnl: dec!(0),
        sl: cmd.sl,
        tp: cmd.tp,
        status: PositionStatus::Open,
        ts: Utc::now(),
    };
    publish_event("evt.position.updated", &position_event, state).await?;

    let balance_event = BalanceUpdatedEvent {
        user_id: cmd.user_id,
        currency: "USD".to_string(),
        available: balance.available,
        locked: balance.locked,
        equity: balance.equity,
        margin_used: balance.margin_used,
        free_margin: balance.free_margin,
        ts: Utc::now(),
    };
    publish_event("evt.balance.updated", &balance_event, state).await?;

    info!("Order executed: order_id={}, fill_price={}", order_id, fill_price);
    Ok(())
}

async fn store_pending_order(
    cmd: PlaceOrderCommand,
    state: &AppState,
    conn: &mut redis::aio::Connection,
) -> Result<(), Box<dyn std::error::Error>> {
    // Use order_id from command (set by auth-service from database)
    let order_id = cmd.order_id;
    
    // Store idempotency key
    let idempotency_key = Keys::idempotency(cmd.user_id, &cmd.idempotency_key);
    let _: () = conn.set_ex(&idempotency_key, order_id.to_string(), 86400).await?;

    let order = OrderModel {
        user_id: cmd.user_id,
        symbol: cmd.symbol.clone(),
        side: cmd.side,
        order_type: cmd.order_type,
        limit_price: cmd.limit_price,
        size: cmd.size,
        status: OrderStatus::Pending,
        tif: cmd.tif,
        sl: cmd.sl,
        tp: cmd.tp,
        created_at: Utc::now().timestamp_millis(),
        updated_at: Utc::now().timestamp_millis(),
        client_order_id: cmd.client_order_id,
        idempotency_key: cmd.idempotency_key,
    };

    let order_key = Keys::order_by_id(order_id);
    set_redis_hash(conn, &order_key, &order).await?;

    let orders_open_key = Keys::orders_open(cmd.user_id);
    let _: () = conn.zadd(&orders_open_key, order_id.to_string(), order.created_at).await?;

    let event = OrderUpdatedEvent {
        order_id,
        user_id: cmd.user_id,
        status: OrderStatus::Pending,
        filled_size: dec!(0),
        avg_fill_price: None,
        reason: Some("Limit order pending".to_string()),
        ts: Utc::now(),
    };
    publish_event("evt.order.updated", &event, state).await?;

    Ok(())
}

async fn update_position(
    conn: &mut redis::aio::Connection,
    user_id: Uuid,
    symbol: &str,
    side: Side,
    size: Decimal,
    fill_price: Decimal,
    sl: Option<Decimal>,
    tp: Option<Decimal>,
    leverage: Decimal,
    margin: Decimal,
) -> Result<Uuid, Box<dyn std::error::Error>> {
    let positions_key = Keys::positions_set(user_id);
    let existing_positions: Vec<String> = conn.smembers(&positions_key).await?;

    // Check if position exists for this symbol and side
    for pos_id_str in existing_positions {
        if let Ok(pos_id) = Uuid::parse_str(&pos_id_str) {
            let pos_key = Keys::position_by_id(pos_id);
            let pos: Option<PositionModel> = get_redis_hash(conn, &pos_key).await?;
            
            if let Some(mut pos) = pos {
                if pos.symbol == symbol && 
                   pos.status == PositionStatus::Open &&
                   ((side == Side::Buy && pos.side == PositionSide::Long) ||
                    (side == Side::Sell && pos.side == PositionSide::Short)) {
                    // Update existing position
                    let total_size = pos.size + size;
                    let total_notional = (pos.avg_price * pos.size) + (fill_price * size);
                    pos.avg_price = total_notional / total_size;
                    pos.size = total_size;
                    pos.margin += margin;
                    pos.updated_at = Utc::now().timestamp_millis();
                    if sl.is_some() { pos.sl = sl; }
                    if tp.is_some() { pos.tp = tp; }
                    
                    set_redis_hash(conn, &pos_key, &pos).await?;
                    return Ok(pos_id);
                }
            }
        }
    }

    // Create new position
    let position_id = Uuid::new_v4();
    let position = PositionModel {
        user_id,
        symbol: symbol.to_string(),
        side: match side {
            Side::Buy => PositionSide::Long,
            Side::Sell => PositionSide::Short,
        },
        size,
        entry_price: fill_price,
        avg_price: fill_price,
        sl,
        tp,
        leverage,
        margin,
        unrealized_pnl: dec!(0),
        realized_pnl: dec!(0),
        status: PositionStatus::Open,
        opened_at: Utc::now().timestamp_millis(),
        updated_at: Utc::now().timestamp_millis(),
    };

    let pos_key = Keys::position_by_id(position_id);
    set_redis_hash(conn, &pos_key, &position).await?;
    
    let _: () = conn.sadd(&positions_key, position_id.to_string()).await?;

    Ok(position_id)
}

pub async fn execute_cancel_order(
    cmd: CancelOrderCommand,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut conn = state.redis.get_async_connection().await?;
    
    let order_key = Keys::order_by_id(cmd.order_id);
    let order: Option<OrderModel> = get_redis_hash(&mut conn, &order_key).await?;
    
    let order = order.ok_or_else(|| "Order not found".to_string())?;
    
    if order.status != OrderStatus::Pending {
        return Err(format!("Order cannot be cancelled, status: {:?}", order.status).into());
    }

    // Update order status
    let mut updated_order = order.clone();
    updated_order.status = OrderStatus::Cancelled;
    updated_order.updated_at = Utc::now().timestamp_millis();
    set_redis_hash(&mut conn, &order_key, &updated_order).await?;

    // Remove from open orders
    let orders_open_key = Keys::orders_open(cmd.user_id);
    let _: () = conn.zrem(&orders_open_key, cmd.order_id.to_string()).await?;

    // Unlock any reserved margin (if applicable)
    // This would need to be implemented based on order type

    let event = OrderUpdatedEvent {
        order_id: cmd.order_id,
        user_id: cmd.user_id,
        status: OrderStatus::Cancelled,
        filled_size: dec!(0),
        avg_fill_price: None,
        reason: Some("Cancelled by user".to_string()),
        ts: Utc::now(),
    };
    publish_event("evt.order.updated", &event, state).await?;

    Ok(())
}

async fn publish_event<T: serde::Serialize>(
    subject: &str,
    event: &T,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    let msg = VersionedMessage::new(subject, event)?;
    let payload = serde_json::to_vec(&msg)?;
    state.nats.publish(subject.to_string(), payload.into()).await?;
    Ok(())
}

async fn get_redis_hash<T: for<'de> serde::Deserialize<'de>>(
    conn: &mut redis::aio::Connection,
    key: &str,
) -> Result<Option<T>, Box<dyn std::error::Error>> {
    let map: std::collections::HashMap<String, String> = conn.hgetall(key).await?;
    if map.is_empty() {
        return Ok(None);
    }
    let json = serde_json::to_value(map)?;
    Ok(Some(serde_json::from_value(json)?))
}

async fn set_redis_hash<T: serde::Serialize>(
    conn: &mut redis::aio::Connection,
    key: &str,
    value: &T,
) -> Result<(), Box<dyn std::error::Error>> {
    let json = serde_json::to_value(value)?;
    if let Some(map) = json.as_object() {
        let mut pipe = redis::pipe();
        for (k, v) in map {
            if let Some(s) = v.as_str() {
                pipe.cmd("HSET").arg(key).arg(k).arg(s);
            } else {
                pipe.cmd("HSET").arg(key).arg(k).arg(v.to_string());
            }
        }
        pipe.query_async(conn).await?;
    }
    Ok(())
}

