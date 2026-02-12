use chrono::{DateTime, Utc};
use contracts::enums::{OrderStatus, OrderType, PositionSide, PositionStatus, Side, TimeInForce};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Redis hash model for latest tick
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickModel {
    pub bid: Decimal,
    pub ask: Decimal,
    pub ts: i64, // timestamp milliseconds
    pub seq: u64,
}

/// Redis hash model for user profile (hot subset)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserModel {
    pub group_id: Uuid,
    pub leverage_profile_id: Uuid,
    pub status: String, // active, restricted, etc.
    pub created_at: i64,
}

/// Redis hash model for balance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceModel {
    pub available: Decimal,
    pub locked: Decimal,
    pub equity: Decimal,
    pub margin_used: Decimal,
    pub free_margin: Decimal,
    pub updated_at: i64,
}

/// Redis hash model for position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionModel {
    pub user_id: Uuid,
    pub symbol: String,
    pub side: PositionSide,
    pub size: Decimal,
    pub entry_price: Decimal,
    pub avg_price: Decimal,
    pub sl: Option<Decimal>,
    pub tp: Option<Decimal>,
    pub leverage: Decimal,
    pub margin: Decimal,
    pub unrealized_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub status: PositionStatus,
    pub opened_at: i64,
    pub updated_at: i64,
}

/// Redis hash model for order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderModel {
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub limit_price: Option<Decimal>,
    pub size: Decimal,
    pub status: OrderStatus,
    pub tif: TimeInForce,
    pub sl: Option<Decimal>,
    pub tp: Option<Decimal>,
    pub created_at: i64,
    pub updated_at: i64,
    pub client_order_id: Option<String>,
    pub idempotency_key: String,
}

/// Redis hash model for symbol config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolModel {
    pub enabled: bool,
    pub base: String,
    pub quote: String,
    pub min_size: Decimal,
    pub step_size: Decimal,
    pub price_tick: Decimal,
    pub leverage_profile_id: Uuid,
    pub swap_profile_id: Option<Uuid>,
    pub price_stream_profile_id: Uuid,
}

