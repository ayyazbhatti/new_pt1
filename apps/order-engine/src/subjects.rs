/// NATS subject constants for order engine
pub mod subjects {
    // Incoming commands
    pub const CMD_ORDER_PLACE: &str = "cmd.order.place";
    pub const CMD_ORDER_CANCEL: &str = "cmd.order.cancel";
    pub const CMD_POSITION_CLOSE: &str = "cmd.position.close";
    pub const CMD_POSITION_CLOSE_ALL: &str = "cmd.position.close_all";
    
    // Incoming ticks (wildcard: ticks.*)
    pub const TICKS_PREFIX: &str = "ticks.";
    
    // Outgoing events
    pub const EVENT_ORDER_ACCEPTED: &str = "event.order.accepted";
    pub const EVENT_ORDER_REJECTED: &str = "event.order.rejected";
    pub const EVENT_ORDER_FILLED: &str = "event.order.filled";
    pub const EVENT_ORDER_CANCELED: &str = "event.order.canceled";
    // For PostgreSQL persistence (core-api listens to evt.*)
    pub const EVENT_ORDER_UPDATED: &str = "evt.order.updated";
    pub const EVENT_POSITION_OPENED: &str = "event.position.opened";
    pub const EVENT_POSITION_CLOSED: &str = "event.position.closed";
    /// For DB sync (auth-service, core-api); position state after fill/reduce/close
    pub const EVT_POSITION_UPDATED: &str = "evt.position.updated";
    pub const EVENT_BALANCE_UPDATED: &str = "event.balance.updated";
    
    /// Parse symbol from tick subject (e.g., "ticks.BNBUSDT" -> "BNBUSDT", "ticks.BNBUSDT.uuid" -> ("BNBUSDT", "uuid"))
    pub fn parse_symbol_from_tick_subject(subject: &str) -> Option<String> {
        subject.strip_prefix(TICKS_PREFIX).map(|s| s.to_string())
    }

    /// Parse per-group tick subject: "ticks.SYMBOL.GROUP_ID" -> (symbol, group_id)
    pub fn parse_tick_subject_per_group(subject: &str) -> Option<(String, String)> {
        let rest = subject.strip_prefix(TICKS_PREFIX)?;
        let mut parts = rest.splitn(2, '.');
        let symbol = parts.next()?.to_string();
        let group_id = parts.next()?.to_string();
        if group_id.is_empty() {
            return None;
        }
        Some((symbol, group_id))
    }

    /// Build tick subject from symbol (legacy)
    pub fn tick_subject(symbol: &str) -> String {
        format!("{}{}", TICKS_PREFIX, symbol)
    }
}

