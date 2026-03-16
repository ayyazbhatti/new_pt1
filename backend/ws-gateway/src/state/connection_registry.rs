use dashmap::DashMap;
use std::sync::Arc;
use uuid::Uuid;

/// Normalize user_id for consistent lookup (UUID with/without dashes, case).
fn normalize_user_id(user_id: &str) -> String {
    user_id.trim().to_lowercase().replace('-', "")
}

#[derive(Debug, Clone)]
pub struct Connection {
    pub conn_id: Uuid,
    pub user_id: String,
    pub group_id: Option<String>,
    /// User role from JWT (e.g. "admin", "user") for call and other role-based checks.
    pub role: String,
    pub subscriptions: Arc<DashMap<String, Vec<String>>>, // symbol -> channels
    pub last_heartbeat: std::time::Instant,
}

#[derive(Debug, Clone)]
pub struct ConnectionRegistry {
    // conn_id -> Connection
    connections: Arc<DashMap<Uuid, Connection>>,
    // user_id -> Vec<conn_id>
    user_connections: Arc<DashMap<String, Vec<Uuid>>>,
    // symbol -> Vec<conn_id>
    symbol_subscribers: Arc<DashMap<String, Vec<Uuid>>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(DashMap::new()),
            user_connections: Arc::new(DashMap::new()),
            symbol_subscribers: Arc::new(DashMap::new()),
        }
    }

    pub fn register(&self, conn: Connection) {
        let conn_id = conn.conn_id;
        let user_id = conn.user_id.clone();
        let key = normalize_user_id(&user_id);

        // Register connection
        self.connections.insert(conn_id, conn);

        // Index by normalized user_id so wallet balance etc. find the connection
        self.user_connections
            .entry(key)
            .or_insert_with(Vec::new)
            .push(conn_id);
    }

    pub fn unregister(&self, conn_id: Uuid) {
        if let Some((_, conn)) = self.connections.remove(&conn_id) {
            let key = normalize_user_id(&conn.user_id);
            if let Some(mut conns) = self.user_connections.get_mut(&key) {
                conns.retain(|&id| id != conn_id);
                if conns.is_empty() {
                    drop(conns);
                    self.user_connections.remove(&key);
                }
            }

            // Remove from symbol subscriptions
            for entry in conn.subscriptions.iter() {
                let symbol = entry.key().clone();
                if let Some(mut subscribers) = self.symbol_subscribers.get_mut(&symbol) {
                    subscribers.retain(|&id| id != conn_id);
                    if subscribers.is_empty() {
                        drop(subscribers);
                        self.symbol_subscribers.remove(&symbol);
                    }
                }
            }
        }
    }

    pub fn get(&self, conn_id: &Uuid) -> Option<Connection> {
        self.connections.get(conn_id).map(|entry| entry.clone())
    }

    pub fn subscribe_symbol(&self, conn_id: Uuid, symbol: String, channels: Vec<String>) {
        if let Some(mut conn) = self.connections.get_mut(&conn_id) {
            conn.subscriptions.insert(symbol.clone(), channels);
            conn.last_heartbeat = std::time::Instant::now();

            // Add to symbol subscribers
            self.symbol_subscribers
                .entry(symbol)
                .or_insert_with(Vec::new)
                .push(conn_id);
        }
    }

    pub fn unsubscribe_symbol(&self, conn_id: Uuid, symbol: &str) {
        if let Some(mut conn) = self.connections.get_mut(&conn_id) {
            conn.subscriptions.remove(symbol);

            // Remove from symbol subscribers
            if let Some(mut subscribers) = self.symbol_subscribers.get_mut(symbol) {
                subscribers.retain(|&id| id != conn_id);
                if subscribers.is_empty() {
                    drop(subscribers);
                    self.symbol_subscribers.remove(symbol);
                }
            }
        }
    }

    pub fn get_symbol_subscribers(&self, symbol: &str) -> Vec<Uuid> {
        self.symbol_subscribers
            .get(symbol)
            .map(|entry| entry.value().clone())
            .unwrap_or_default()
    }

    pub fn get_user_connections(&self, user_id: &str) -> Vec<Uuid> {
        let key = normalize_user_id(user_id);
        self.user_connections
            .get(&key)
            .map(|entry| entry.value().clone())
            .unwrap_or_default()
    }

    /// Connection IDs for all connections with role "admin" or "super_admin" (case-insensitive). Used for chat.support routing.
    pub fn get_admin_connection_ids(&self) -> Vec<Uuid> {
        self.connections
            .iter()
            .filter(|entry| {
                let r = entry.value().role.as_str();
                r.eq_ignore_ascii_case("admin") || r.eq_ignore_ascii_case("super_admin")
            })
            .map(|entry| entry.conn_id)
            .collect()
    }

    pub fn update_heartbeat(&self, conn_id: Uuid) {
        if let Some(mut conn) = self.connections.get_mut(&conn_id) {
            conn.last_heartbeat = std::time::Instant::now();
        }
    }

    pub fn get_stale_connections(&self, timeout_secs: u64) -> Vec<Uuid> {
        let now = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(timeout_secs);

        self.connections
            .iter()
            .filter_map(|entry| {
                if now.duration_since(entry.last_heartbeat) > timeout {
                    Some(entry.conn_id)
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn total_connections(&self) -> usize {
        self.connections.len()
    }

    pub fn total_subscriptions(&self) -> usize {
        self.symbol_subscribers.len()
    }
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

