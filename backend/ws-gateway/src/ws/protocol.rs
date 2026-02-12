use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "auth")]
    Auth {
        token: String,
    },
    #[serde(rename = "subscribe")]
    Subscribe {
        symbols: Vec<String>,
        channels: Vec<String>,
    },
    #[serde(rename = "unsubscribe")]
    Unsubscribe {
        symbols: Vec<String>,
    },
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "auth_success")]
    AuthSuccess {
        user_id: String,
        group_id: Option<String>,
    },
    #[serde(rename = "auth_error")]
    AuthError {
        error: String,
    },
    #[serde(rename = "tick")]
    Tick {
        symbol: String,
        bid: String,
        ask: String,
        ts: i64,
    },
    #[serde(rename = "order_update")]
    OrderUpdate {
        order_id: String,
        status: String,
        symbol: String,
        side: String,
        quantity: String,
        price: Option<String>,
        ts: i64,
    },
    #[serde(rename = "position_update")]
    PositionUpdate {
        position_id: String,
        symbol: String,
        side: String,
        quantity: String,
        unrealized_pnl: String,
        ts: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        trigger_reason: Option<String>, // "SL" or "TP" for stop loss/take profit triggers
    },
    #[serde(rename = "risk_alert")]
    RiskAlert {
        alert_type: String,
        message: String,
        severity: String,
        ts: i64,
    },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error {
        code: String,
        message: String,
    },
    #[serde(rename = "subscribed")]
    Subscribed {
        symbols: Vec<String>,
    },
    #[serde(rename = "unsubscribed")]
    Unsubscribed {
        symbols: Vec<String>,
    },
    // Deposit and notification events - payload is kept as nested object
    #[serde(rename = "deposit.request.created")]
    DepositRequestCreated {
        payload: serde_json::Value,
    },
    #[serde(rename = "deposit.request.approved")]
    DepositRequestApproved {
        payload: serde_json::Value,
    },
    #[serde(rename = "notification.push")]
    NotificationPush {
        payload: serde_json::Value,
    },
    #[serde(rename = "wallet.balance.updated")]
    WalletBalanceUpdated {
        payload: serde_json::Value,
    },
}

impl ServerMessage {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

