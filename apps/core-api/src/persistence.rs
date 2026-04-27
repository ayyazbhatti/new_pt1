use crate::AppState;
use async_nats::Subscriber;
use futures_util::StreamExt;
use contracts::{
    events::{BalanceUpdatedEvent, OrderUpdatedEvent, PositionUpdatedEvent},
    VersionedMessage,
};
use sqlx::PgPool;
use tracing::{error, info, warn};
use redis::AsyncCommands;

pub async fn consume_events(state: AppState) {
    info!("🔄 Starting persistence consumer...");
    let mut sub = match state.nats.subscribe("evt.*".to_string()).await {
        Ok(s) => {
            info!("✅ Successfully subscribed to evt.* events");
            s
        }
        Err(e) => {
            error!("❌ Failed to subscribe to evt.* events: {}", e);
            return;
        }
    };

    info!("✅ Persistence consumer started and ready to receive events");

    while let Some(msg) = sub.next().await {
        let bytes = msg.payload.to_vec();
        if let Ok(versioned) = serde_json::from_slice::<VersionedMessage>(&bytes) {
            match versioned.r#type.as_str() {
                "evt.order.updated" => {
                    if let Ok(event) = versioned.deserialize_payload::<OrderUpdatedEvent>() {
                        if let Err(e) = persist_order(&state.db, &event, &state.redis).await {
                            error!("Failed to persist order: {}", e);
                        }
                    }
                }
                "evt.position.updated" => {
                    if let Ok(event) = versioned.deserialize_payload::<PositionUpdatedEvent>() {
                        if let Err(e) = persist_position(&state.db, &event).await {
                            error!("Failed to persist position: {}", e);
                        }
                    }
                }
                "evt.balance.updated" => {
                    if let Ok(event) = versioned.deserialize_payload::<BalanceUpdatedEvent>() {
                        if let Err(e) = persist_balance(&state.db, &event).await {
                            error!("Failed to persist balance: {}", e);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

async fn persist_order(db: &PgPool, event: &OrderUpdatedEvent, redis: &redis::Client) -> Result<(), Box<dyn std::error::Error>> {
    // Fetch full order data from Redis to get all required fields
    // Order-engine uses format: order:{order_id}
    let mut conn = redis.get_async_connection().await?;
    let order_key = format!("order:{}", event.order_id);
    let order_json: Option<String> = conn.get(&order_key).await?;
    
    if let Some(order_json) = order_json {
        let order_data: serde_json::Value = serde_json::from_str(&order_json)?;
        
        // Extract required fields from Redis order data
        let symbol = order_data.get("symbol")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing symbol in order data")?;
        let side = order_data.get("side")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing side in order data")?;
        let order_type = order_data.get("order_type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing order_type in order data")?;
        let size = order_data.get("size")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| "Missing size in order data")?;
        let tif = order_data.get("time_in_force")
            .and_then(|v| v.as_str())
            .unwrap_or("GTC");
        let created_at = order_data.get("created_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .ok_or_else(|| "Missing or invalid created_at in order data")?;
        
        sqlx::query(
            r#"
            INSERT INTO orders (id, user_id, symbol, side, order_type, size, tif, status, filled_size, avg_fill_price, reason, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                filled_size = EXCLUDED.filled_size,
                avg_fill_price = EXCLUDED.avg_fill_price,
                reason = EXCLUDED.reason,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(event.order_id)
        .bind(event.user_id)
        .bind(symbol)
        .bind(side)
        .bind(order_type)
        .bind(size.to_string())
        .bind(tif)
        .bind(format!("{:?}", event.status))
        .bind(event.filled_size.to_string())
        .bind(event.avg_fill_price.map(|p| p.to_string()))
        .bind(&event.reason)
        .bind(created_at)
        .bind(event.ts)
        .execute(db)
        .await?;
        
        info!("✅ Persisted order {} to PostgreSQL", event.order_id);
    } else {
        warn!("⚠️ Order {} not found in Redis, cannot persist to PostgreSQL", event.order_id);
    }

    Ok(())
}

async fn persist_position(db: &PgPool, event: &PositionUpdatedEvent) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query(
        r#"
        INSERT INTO positions (id, user_id, symbol, side, size, avg_price, leverage, unrealized_pnl, realized_pnl, status, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
            size = EXCLUDED.size,
            avg_price = EXCLUDED.avg_price,
            leverage = EXCLUDED.leverage,
            unrealized_pnl = EXCLUDED.unrealized_pnl,
            realized_pnl = EXCLUDED.realized_pnl,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(event.position_id)
    .bind(event.user_id)
    .bind(&event.symbol)
    .bind(format!("{:?}", event.side))
    .bind(event.size.to_string())
    .bind(event.avg_price.to_string())
    .bind(event.leverage.to_string())
    .bind(event.unrealized_pnl.to_string())
    .bind(event.realized_pnl.to_string())
    .bind(format!("{:?}", event.status))
    .bind(event.ts)
    .execute(db)
    .await?;

    Ok(())
}

async fn persist_balance(db: &PgPool, event: &BalanceUpdatedEvent) -> Result<(), Box<dyn std::error::Error>> {
    sqlx::query(
        r#"
        INSERT INTO balances (user_id, currency, available, locked, equity, margin_used, free_margin, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, currency) DO UPDATE SET
            available = EXCLUDED.available,
            locked = EXCLUDED.locked,
            equity = EXCLUDED.equity,
            margin_used = EXCLUDED.margin_used,
            free_margin = EXCLUDED.free_margin,
            updated_at = EXCLUDED.updated_at
        "#,
    )
    .bind(event.user_id)
    .bind(&event.currency)
    .bind(event.available.to_string())
    .bind(event.locked.to_string())
    .bind(event.equity.to_string())
    .bind(event.margin_used.to_string())
    .bind(event.free_margin.to_string())
    .bind(event.ts)
    .execute(db)
    .await?;

    Ok(())
}

