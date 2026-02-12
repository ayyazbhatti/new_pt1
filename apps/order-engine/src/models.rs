use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use contracts::enums::{OrderStatus, OrderType, Side, TimeInForce, PositionSide, PositionStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tick {
    pub symbol: String,
    pub bid: Decimal,
    pub ask: Decimal,
    pub ts: DateTime<Utc>,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub size: Decimal,
    pub limit_price: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    pub take_profit: Option<Decimal>,
    pub time_in_force: TimeInForce,
    pub status: OrderStatus,
    pub filled_size: Decimal,
    pub average_fill_price: Option<Decimal>,
    pub client_order_id: Option<String>,
    pub idempotency_key: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub filled_at: Option<DateTime<Utc>>,
    pub canceled_at: Option<DateTime<Utc>>,
    pub rejection_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: PositionSide,
    pub size: Decimal,
    pub entry_price: Decimal,
    pub mark_price: Decimal,
    pub leverage: Decimal,
    pub margin_used: Decimal,
    pub unrealized_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub stop_loss: Option<Decimal>,
    pub take_profit: Option<Decimal>,
    pub status: PositionStatus,
    pub opened_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub currency: String,
    pub available: Decimal,
    pub locked: Decimal,
    pub equity: Decimal,
    pub margin_used: Decimal,
    pub free_margin: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderCommand {
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub size: Decimal,
    pub limit_price: Option<Decimal>,
    pub stop_loss: Option<Decimal>,
    pub take_profit: Option<Decimal>,
    pub time_in_force: TimeInForce,
    pub client_order_id: Option<String>,
    pub idempotency_key: String,
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelCommand {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosePositionCommand {
    pub position_id: Uuid,
    pub user_id: Uuid,
    pub size: Option<Decimal>, // None = full close
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderAcceptedEvent {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub size: Decimal,
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRejectedEvent {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub reason: String,
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderFilledEvent {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub filled_size: Decimal,
    pub average_fill_price: Decimal,
    pub position_id: Option<Uuid>,
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderCanceledEvent {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub reason: String,
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionOpenedEvent {
    pub position_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: PositionSide,
    pub size: Decimal,
    pub entry_price: Decimal,
    pub leverage: Decimal,
    pub margin_used: Decimal,
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionClosedEvent {
    pub position_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: PositionSide,
    pub closed_size: Decimal,
    pub exit_price: Decimal,
    pub realized_pnl: Decimal,
    pub correlation_id: String,
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
    pub correlation_id: String,
    pub ts: DateTime<Utc>,
}

