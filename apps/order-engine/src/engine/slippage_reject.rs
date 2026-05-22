//! Reject a market order when slippage exceeds tolerance: NATS + Redis + cache (mirrors validation rejection path).

use anyhow::Result;
use contracts::enums::OrderStatus;
use redis::aio::ConnectionManager;
use rust_decimal::Decimal;

use crate::engine::OrderCache;
use crate::models::{Order, OrderRejectedEvent};
use crate::nats::NatsClient;
use crate::observability::Metrics;
use crate::subjects::subjects as nats_subjects;
use crate::utils::now;
use risk::slippage::SlippageCheckResult;

/// Publishes `event.order.rejected` + `evt.order.updated` (Rejected) for fee refund / DB sync, updates Redis order, drops pending.
pub async fn reject_market_order_slippage_exceeded(
    nats: &NatsClient,
    cache: &OrderCache,
    conn: &mut ConnectionManager,
    metrics: &Metrics,
    order: &Order,
    fill_price: Decimal,
    result: &SlippageCheckResult,
) -> Result<()> {
    let details = serde_json::json!({
        "slippageBps": result.slippage_bps,
        "maxBps": result.max_bps,
        "referencePrice": result.reference_price.to_string(),
        "fillPrice": fill_price.to_string(),
        "side": format!("{:?}", order.side),
    });

    let rejected_event = OrderRejectedEvent {
        order_id: order.id,
        user_id: order.user_id,
        symbol: order.symbol.clone(),
        reason: "SLIPPAGE_EXCEEDED".to_string(),
        correlation_id: order.idempotency_key.clone(),
        ts: now(),
        details: Some(details.clone()),
    };
    nats.publish_event(nats_subjects::EVENT_ORDER_REJECTED, &rejected_event)
        .await?;

    let order_updated = contracts::events::OrderUpdatedEvent {
        order_id: order.id,
        user_id: order.user_id,
        status: OrderStatus::Rejected,
        filled_size: Decimal::ZERO,
        avg_fill_price: None,
        reason: Some("SLIPPAGE_EXCEEDED".to_string()),
        ts: now(),
    };
    nats.publish_event(nats_subjects::EVENT_ORDER_UPDATED, &order_updated)
        .await?;

    metrics.inc_orders_rejected();

    let mut rejected_order = order.clone();
    rejected_order.status = OrderStatus::Rejected;
    rejected_order.rejection_reason = Some("SLIPPAGE_EXCEEDED".to_string());
    rejected_order.updated_at = now();

    let order_key = format!("order:{}", order.id);
    let order_json = serde_json::to_string(&rejected_order)?;
    let _: () = redis::cmd("SET")
        .arg(&order_key)
        .arg(&order_json)
        .query_async(conn)
        .await?;

    cache.update_order(rejected_order);
    cache.remove_pending_order(&order.symbol, order.id);

    let pending_key = format!("orders:pending:{}", order.symbol);
    let _: () = redis::cmd("ZREM")
        .arg(&pending_key)
        .arg(order.id.to_string())
        .query_async(conn)
        .await?;

    Ok(())
}
