//! Shared helpers for publishing position events (evt.position.updated for DB sync).

use anyhow::{Context, Result};
use contracts::enums::{PositionSide, PositionStatus};
use contracts::events::PositionUpdatedEvent;
use redis::aio::ConnectionManager;
use std::collections::HashMap;
use std::str::FromStr;
use tracing::error;
use uuid::Uuid;
use rust_decimal::Decimal;

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
    let ev = PositionUpdatedEvent {
        position_id,
        user_id,
        symbol,
        side,
        size,
        avg_price,
        unrealized_pnl,
        realized_pnl,
        sl,
        tp,
        status,
        ts: now(),
    };
    if let Err(e) = nats.publish_event(nats_subjects::EVT_POSITION_UPDATED, &ev).await {
        error!("Failed to publish evt.position.updated for {}: {}", position_id, e);
    }
    Ok(())
}
