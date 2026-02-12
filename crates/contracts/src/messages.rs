use serde::{Deserialize, Serialize};

/// Versioned message envelope for all events and commands
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionedMessage {
    pub v: u8,
    pub r#type: String,
    pub payload: serde_json::Value,
}

impl VersionedMessage {
    pub fn new<T: Serialize>(r#type: &str, payload: T) -> Result<Self, serde_json::Error> {
        Ok(Self {
            v: 1,
            r#type: r#type.to_string(),
            payload: serde_json::to_value(payload)?,
        })
    }

    pub fn deserialize_payload<T: for<'de> Deserialize<'de>>(&self) -> Result<T, serde_json::Error> {
        serde_json::from_value(self.payload.clone())
    }
}

/// WebSocket client messages - supports both formats
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WsClientMessage {
    // New format: {"action":"subscribe","symbols":["BTCUSD"],"group":"default"}
    ActionSubscribe {
        action: String,
        symbols: Vec<String>,
        #[serde(default)]
        group: Option<String>,
    },
    ActionUnsubscribe {
        action: String,
        symbols: Vec<String>,
    },
    // New format: {"type":"auth","token":"..."}
    TypeAuth {
        #[serde(rename = "type")]
        msg_type: String,
        token: String,
    },
    // Legacy format: {"op":"auth","token":"..."}
    OpAuth {
        op: String,
        token: String,
    },
    // Legacy format: {"op":"sub","topic":"ticks:BTCUSD"}
    OpSubscribe {
        op: String,
        topic: String,
    },
    // Legacy format: {"op":"unsub","topic":"ticks:BTCUSD"}
    OpUnsubscribe {
        op: String,
        topic: String,
    },
    // Frontend format: {"type":"subscribe","symbols":[],"channels":["positions","orders"]}
    TypeSubscribe {
        #[serde(rename = "type")]
        msg_type: String,
        symbols: Option<Vec<String>>,
        channels: Option<Vec<String>>,
    },
}

/// WebSocket server messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsServerMessage {
    #[serde(rename = "tick")]
    Tick { payload: crate::events::TickEvent },
    #[serde(rename = "order")]
    Order { payload: crate::events::OrderUpdatedEvent },
    #[serde(rename = "order_update")]
    OrderUpdate { payload: crate::events::OrderUpdatedEvent },
    #[serde(rename = "position")]
    Position { payload: crate::events::PositionUpdatedEvent },
    #[serde(rename = "balance")]
    Balance { payload: crate::events::BalanceUpdatedEvent },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "subscribed")]
    Subscribed { topic: String },
    #[serde(rename = "unsubscribed")]
    Unsubscribed { topic: String },
    #[serde(rename = "auth_success")]
    AuthSuccess { 
        user_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        group_id: Option<String>,
    },
    #[serde(rename = "auth_error")]
    AuthError { error: String },
}

