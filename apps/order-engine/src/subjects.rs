/// NATS subject constants for order engine
pub mod subjects {
    // Incoming commands
    pub const CMD_ORDER_PLACE: &str = "cmd.order.place";
    pub const CMD_ORDER_CANCEL: &str = "cmd.order.cancel";
    pub const CMD_POSITION_CLOSE: &str = "cmd.position.close";
    
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
    pub const EVENT_BALANCE_UPDATED: &str = "event.balance.updated";
    
    /// Parse symbol from tick subject (e.g., "ticks.BNBUSDT" -> "BNBUSDT")
    pub fn parse_symbol_from_tick_subject(subject: &str) -> Option<String> {
        subject.strip_prefix(TICKS_PREFIX).map(|s| s.to_string())
    }
    
    /// Build tick subject from symbol
    pub fn tick_subject(symbol: &str) -> String {
        format!("{}{}", TICKS_PREFIX, symbol)
    }
}

