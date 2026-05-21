//! Shared helpers for publishing position events (evt.position.updated for DB sync).

use anyhow::{Context, Result};
use contracts::enums::{OrderStatus, PositionSide, PositionStatus};
use contracts::events::{OrderUpdatedEvent, PositionUpdatedEvent};
use redis::aio::ConnectionManager;
use std::collections::HashMap;
use tracing::{error, warn};
use uuid::Uuid;
use rust_decimal::Decimal;

use crate::engine::cache::normalize_symbol;
use crate::models::Order;
use crate::nats::NatsClient;
use crate::subjects::subjects as nats_subjects;
use crate::utils::now;

/// Read position hash from Redis and publish evt.position.updated for DB sync (auth-service, core-api).
pub async fn publish_position_updated(
    nats: &NatsClient,
    conn: &mut ConnectionManager,
    position_id: Uuid,
    status_override: Option<PositionStatus>,
) -> Result<()> {
    let key = format!("pos:by_id:{}", position_id);
    let raw: HashMap<String, String> = redis::cmd("HGETALL").arg(&key).query_async(conn).await
        .context("HGETALL position")?;
    if raw.is_empty() {
        return Ok(());
    }
    let user_id = raw.get("user_id")
        .and_then(|s| Uuid::parse_str(s).ok())
        .context("position user_id")?;
    let symbol = raw.get("symbol").cloned().unwrap_or_default();
    let side_str = raw.get("side").map(|s| s.as_str()).unwrap_or("LONG");
    let side = if side_str == "SHORT" { PositionSide::Short } else { PositionSide::Long };
    let size = Decimal::from_str_exact(raw.get("size").map(|s| s.as_str()).unwrap_or("0")).unwrap_or(Decimal::ZERO);
    let avg_price = Decimal::from_str_exact(raw.get("avg_price").or(raw.get("entry_price")).map(|s| s.as_str()).unwrap_or("0")).unwrap_or(Decimal::ZERO);
    let unrealized_pnl = Decimal::from_str_exact(raw.get("unrealized_pnl").map(|s| s.as_str()).unwrap_or("0")).unwrap_or(Decimal::ZERO);
    let realized_pnl = Decimal::from_str_exact(raw.get("realized_pnl").map(|s| s.as_str()).unwrap_or("0")).unwrap_or(Decimal::ZERO);
    let status_str = status_override.map(|s| match s {
        PositionStatus::Open => "OPEN",
        PositionStatus::Closed => "CLOSED",
        PositionStatus::Liquidated => "LIQUIDATED",
    }).or_else(|| raw.get("status").map(|s| s.as_str()));
    let status = match status_str.map(|s| s.to_uppercase()).as_deref() {
        Some("CLOSED") => PositionStatus::Closed,
        Some("LIQUIDATED") => PositionStatus::Liquidated,
        _ => PositionStatus::Open,
    };
    let sl = raw.get("sl").and_then(|s| Decimal::from_str_exact(s).ok()).filter(|d| *d != Decimal::ZERO);
    let tp = raw.get("tp").and_then(|s| Decimal::from_str_exact(s).ok()).filter(|d| *d != Decimal::ZERO);
    let leverage = raw
        .get("leverage")
        .and_then(|s| Decimal::from_str_exact(s).ok())
        .ok_or_else(|| anyhow::anyhow!("pos:by_id missing leverage field for {}", position_id))?;
    let margin_from_cash = raw
        .get("margin_from_cash")
        .and_then(|s| Decimal::from_str_exact(s).ok())
        .unwrap_or(Decimal::ZERO);
    let margin_from_bonus = raw
        .get("margin_from_bonus")
        .and_then(|s| Decimal::from_str_exact(s).ok())
        .unwrap_or(Decimal::ZERO);
    let ev = PositionUpdatedEvent {
        position_id,
        user_id,
        symbol,
        side,
        size,
        avg_price,
        leverage,
        unrealized_pnl,
        realized_pnl,
        sl,
        tp,
        status,
        ts: now(),
        margin_from_cash: Some(margin_from_cash),
        margin_from_bonus: Some(margin_from_bonus),
    };
    if let Err(e) = nats.publish_event(nats_subjects::EVT_POSITION_UPDATED, &ev).await {
        error!("Failed to publish evt.position.updated for {}: {}", position_id, e);
    }
    Ok(())
}

/// Best-effort: find the newest OPEN position for this user+symbol (hedging may have several).
/// Used when Lua returns `order_not_pending` + `FILLED` so we still emit `evt.position.updated`.
pub async fn find_latest_open_position_id_for_user_symbol(
    conn: &mut ConnectionManager,
    user_id: Uuid,
    symbol: &str,
) -> Option<Uuid> {
    let want = normalize_symbol(symbol);
    let set_key = format!("pos:{}", user_id);
    let ids: Vec<String> = redis::cmd("SMEMBERS")
        .arg(&set_key)
        .query_async(conn)
        .await
        .unwrap_or_default();
    let mut best: Option<(Uuid, i64)> = None;
    for sid in ids {
        let Ok(pid) = Uuid::parse_str(&sid) else {
            continue;
        };
        let raw: HashMap<String, String> = redis::cmd("HGETALL")
            .arg(format!("pos:by_id:{}", pid))
            .query_async(conn)
            .await
            .unwrap_or_default();
        let sym = raw.get("symbol").map(|s| s.as_str()).unwrap_or("");
        if normalize_symbol(sym) != want {
            continue;
        }
        let st = raw.get("status").map(|s| s.to_uppercase()).unwrap_or_default();
        if st != "OPEN" {
            continue;
        }
        let opened = raw.get("opened_at").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        if best.as_ref().map_or(true, |(_, t)| opened >= *t) {
            best = Some((pid, opened));
        }
    }
    best.map(|(id, _)| id)
}

/// Republish `evt.order.updated` and `evt.position.updated` when Redis already shows a FILLED
/// order (e.g. concurrent duplicate `atomic_fill_order`: `order_not_pending`).
///
/// Sync position to auth-service Postgres via `evt.position.updated`.
/// Required: prevents Redis-only positions (see `docs/position-redis-postgres-sync-diagnostic-442fde7b.md`).
pub async fn sync_duplicate_fill_to_db(
    nats: &NatsClient,
    conn: &mut ConnectionManager,
    order: &Order,
    fill_price: Decimal,
    fill_size: Decimal,
) {
    use redis::AsyncCommands;
    let order_key = format!("order:{}", order.id);
    let order_json: Option<String> = conn.get(&order_key).await.unwrap_or(None);
    let Some(json_str) = order_json else {
        warn!(
            "sync_duplicate_fill_to_db: no Redis order:{} for order {}",
            order_key, order.id
        );
        return;
    };
    let Ok(order_data) = serde_json::from_str::<serde_json::Value>(&json_str) else {
        warn!(
            "sync_duplicate_fill_to_db: invalid JSON in Redis for order {}",
            order.id
        );
        return;
    };
    let Some(status) = order_data.get("status").and_then(|v| v.as_str()) else {
        warn!(
            "sync_duplicate_fill_to_db: missing status in Redis order {}",
            order.id
        );
        return;
    };
    if status != "FILLED" {
        return;
    }
    let filled_size = order_data
        .get("filled_size")
        .and_then(|v| v.as_str())
        .and_then(|s| Decimal::from_str_exact(s).ok())
        .unwrap_or(fill_size);
    let avg_fill_price = order_data
        .get("average_fill_price")
        .and_then(|v| v.as_str())
        .and_then(|s| Decimal::from_str_exact(s).ok())
        .or(Some(fill_price));

    let order_updated_event = OrderUpdatedEvent {
        order_id: order.id,
        user_id: order.user_id,
        status: OrderStatus::Filled,
        filled_size,
        avg_fill_price,
        reason: None,
        ts: now(),
    };
    if let Err(pub_err) = nats
        .publish_event(nats_subjects::EVENT_ORDER_UPDATED, &order_updated_event)
        .await
    {
        warn!(
            "sync_duplicate_fill_to_db: failed evt.order.updated for order {}: {}",
            order.id, pub_err
        );
    }

    if let Some(pid) =
        find_latest_open_position_id_for_user_symbol(conn, order.user_id, &order.symbol).await
    {
        if let Err(e) = publish_position_updated(nats, conn, pid, None).await {
            warn!(
                "sync_duplicate_fill_to_db: failed evt.position.updated for position {} (order {}): {:?}",
                pid, order.id, e
            );
        }
    } else {
        warn!(
            "sync_duplicate_fill_to_db: FILLED order {} but no OPEN pos:by_id for symbol {} user {} — skipping evt.position.updated",
            order.id, order.symbol, order.user_id
        );
    }
}
