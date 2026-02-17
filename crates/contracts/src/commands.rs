use crate::enums::{OrderType, Side, TimeInForce};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Leverage tier for symbol (exposure notional range -> max leverage).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeverageTier {
    pub notional_from: String,
    pub notional_to: Option<String>,
    pub max_leverage: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceOrderCommand {
    pub order_id: Uuid,
    pub user_id: Uuid,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub size: Decimal,
    pub limit_price: Option<Decimal>,
    pub sl: Option<Decimal>, // Stop Loss
    pub tp: Option<Decimal>, // Take Profit
    pub tif: TimeInForce,
    pub client_order_id: Option<String>,
    pub idempotency_key: String,
    pub ts: DateTime<Utc>,
    /// User's group_id for per-group price stream (tick lookup)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    /// User min leverage (clamp)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_leverage: Option<i32>,
    /// User max leverage (clamp)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_leverage: Option<i32>,
    /// Symbol leverage tiers (exposure -> max leverage); used at fill time with notional = size * price
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leverage_tiers: Option<Vec<LeverageTier>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelOrderCommand {
    pub user_id: Uuid,
    pub order_id: Uuid,
    pub idempotency_key: String,
    pub ts: DateTime<Utc>,
}

