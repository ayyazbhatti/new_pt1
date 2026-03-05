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
    #[serde(rename = "call.initiate")]
    CallInitiate {
        target_user_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        caller_display_name: Option<String>,
    },
    #[serde(rename = "call.answer")]
    CallAnswer { call_id: String },
    #[serde(rename = "call.reject")]
    CallReject { call_id: String },
    #[serde(rename = "call.end")]
    CallEnd { call_id: String },
    #[serde(rename = "call.webrtc.offer")]
    CallWebrtcOffer { call_id: String, sdp: String },
    #[serde(rename = "call.webrtc.answer")]
    CallWebrtcAnswer { call_id: String, sdp: String },
    #[serde(rename = "call.webrtc.ice")]
    CallWebrtcIce { call_id: String, candidate: String },
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
        status: String, // "OPEN", "CLOSED", "open", "closed"
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
    #[serde(rename = "account.summary.updated")]
    AccountSummaryUpdated {
        payload: serde_json::Value,
    },
    // Admin call user – signaling only
    #[serde(rename = "call.incoming")]
    CallIncoming {
        call_id: String,
        admin_user_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        admin_display_name: Option<String>,
    },
    #[serde(rename = "call.ringing")]
    CallRinging {
        call_id: String,
        target_user_id: String,
    },
    #[serde(rename = "call.accepted")]
    CallAccepted {
        call_id: String,
        target_user_id: String,
    },
    #[serde(rename = "call.rejected")]
    CallRejected {
        call_id: String,
        target_user_id: String,
    },
    #[serde(rename = "call.ended")]
    CallEnded {
        call_id: String,
        ended_by: String,
    },
    #[serde(rename = "call.error")]
    CallError {
        call_id: Option<String>,
        code: String,
        message: String,
    },
    #[serde(rename = "call.webrtc.offer")]
    CallWebrtcOffer { call_id: String, sdp: String },
    #[serde(rename = "call.webrtc.answer")]
    CallWebrtcAnswer { call_id: String, sdp: String },
    #[serde(rename = "call.webrtc.ice")]
    CallWebrtcIce { call_id: String, candidate: String },
}

impl ServerMessage {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

