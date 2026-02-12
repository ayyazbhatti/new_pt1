use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub subscriptions: HashSet<String>,
}

impl Session {
    pub fn new(id: Uuid) -> Self {
        Self {
            id,
            user_id: None,
            subscriptions: HashSet::new(),
        }
    }
}

