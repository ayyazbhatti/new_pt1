use uuid::Uuid;

/// Redis key builders following the exact schema from requirements
pub struct Keys;

impl Keys {
    // Latest tick
    pub fn tick(symbol: &str) -> String {
        format!("tick:{}", symbol)
    }

    // User profile
    pub fn user(user_id: Uuid) -> String {
        format!("user:{}", user_id)
    }

    // Balance
    pub fn balance(user_id: Uuid, currency: &str) -> String {
        format!("bal:{}:{}", user_id, currency)
    }

    // Open positions set
    pub fn positions_set(user_id: Uuid) -> String {
        format!("pos:{}", user_id)
    }

    // Position by ID
    pub fn position_by_id(position_id: Uuid) -> String {
        format!("pos:by_id:{}", position_id)
    }

    /// Open positions by symbol (ZSET: score = entry price, member = position_id).
    /// Used by order-engine Lua and by auth-service for tick-driven account summary.
    pub fn positions_open_by_symbol(symbol: &str) -> String {
        format!("pos:open:{}", symbol)
    }

    /// Account summary for a user (Balance, Equity, Margin, PnL, etc.).
    /// Stored under position namespace so position cache is centralized: pos:* holds
    /// position list, per-position hashes, and this summary (derived from positions + DB).
    pub fn position_summary(user_id: Uuid) -> String {
        format!("pos:summary:{}", user_id)
    }

    // Open orders sorted set
    pub fn orders_open(user_id: Uuid) -> String {
        format!("ord:{}:open", user_id)
    }

    // Order by ID
    pub fn order_by_id(order_id: Uuid) -> String {
        format!("ord:by_id:{}", order_id)
    }

    // Symbol config
    pub fn symbol(symbol: &str) -> String {
        format!("sym:{}", symbol)
    }

    // Leverage profiles
    pub fn leverage_profiles_all() -> String {
        "levprof:all".to_string()
    }

    pub fn leverage_profile(id: Uuid) -> String {
        format!("levprof:{}", id)
    }

    pub fn leverage_profile_tiers(profile_id: Uuid) -> String {
        format!("levprof:{}:tiers", profile_id)
    }

    pub fn leverage_tier(tier_id: Uuid) -> String {
        format!("levtier:{}", tier_id)
    }

    // Price stream profiles
    pub fn price_stream_profiles_all() -> String {
        "psprof:all".to_string()
    }

    pub fn price_stream_profile(id: Uuid) -> String {
        format!("psprof:{}", id)
    }

    pub fn price_stream_profile_symbol(profile_id: Uuid, symbol: &str) -> String {
        format!("psprof:{}:{}", profile_id, symbol)
    }

    // Idempotency
    pub fn idempotency(user_id: Uuid, key: &str) -> String {
        format!("idempo:{}:{}", user_id, key)
    }

    /// Account summary cache key. Alias for position_summary so all position-related
    /// data (positions + summary) lives under pos:* (centralized position cache).
    pub fn account_summary(user_id: Uuid) -> String {
        Self::position_summary(user_id)
    }

    // Account summary pub/sub channel (event name; not a Redis key)
    pub fn account_summary_channel(user_id: Uuid) -> String {
        format!("account:summary:{}", user_id)
    }
}

