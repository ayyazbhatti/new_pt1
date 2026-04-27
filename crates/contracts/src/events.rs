use crate::enums::{OrderStatus, PositionSide, PositionStatus};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickEvent {
    pub symbol: String,
    pub bid: Decimal,
    pub ask: Decimal,
    pub ts: DateTime<Utc>,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderUpdatedEvent {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub status: OrderStatus,
    pub filled_size: Decimal,
    pub avg_fill_price: Option<Decimal>,
    pub reason: Option<String>,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionUpdatedEvent {
    pub position_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: PositionSide,
    pub size: Decimal,
    pub avg_price: Decimal,
    /// Effective leverage stored on the position (tier + user clamp at open/fill).
    pub leverage: Decimal,
    pub unrealized_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub sl: Option<Decimal>,
    pub tp: Option<Decimal>,
    pub status: PositionStatus,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceUpdatedEvent {
    pub user_id: Uuid,
    pub currency: String,
    pub available: Decimal,
    pub locked: Decimal,
    pub equity: Decimal,
    pub margin_used: Decimal,
    pub free_margin: Decimal,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAlertEvent {
    pub user_id: Uuid,
    pub alert_type: String,
    pub message: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub event_type: String,
    pub user_id: Option<Uuid>,
    pub order_id: Option<Uuid>,
    pub position_id: Option<Uuid>,
    pub details: serde_json::Value,
    pub ts: DateTime<Utc>,
}

