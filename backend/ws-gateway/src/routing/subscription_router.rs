// Subscription routing logic
// This module handles routing of subscriptions to appropriate channels

use crate::state::connection_registry::ConnectionRegistry;
use std::sync::Arc;

pub struct SubscriptionRouter {
    registry: Arc<ConnectionRegistry>,
}

impl SubscriptionRouter {
    pub fn new(registry: Arc<ConnectionRegistry>) -> Self {
        Self { registry }
    }

    pub fn route_subscription(&self, conn_id: uuid::Uuid, symbol: &str, channels: Vec<String>) {
        self.registry.subscribe_symbol(conn_id, symbol.to_string(), channels);
    }

    pub fn route_unsubscription(&self, conn_id: uuid::Uuid, symbol: &str) {
        self.registry.unsubscribe_symbol(conn_id, symbol);
    }
}

