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
}

