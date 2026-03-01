use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    /// Group ID (UUID string) for per-group marked-up prices from Redis price:ticks.
    pub group_id: Option<String>,
    pub subscriptions: HashSet<String>,
}

impl Session {
    pub fn new(id: Uuid) -> Self {
        Self {
            id,
            user_id: None,
            group_id: None,
            subscriptions: HashSet::new(),
        }
    }
}

