use dashmap::DashMap;
use parking_lot::RwLock;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;
use crate::models::Order;
use crate::models::Tick;
use tracing::{debug, info};

/// Normalize symbol for consistent lookup (orders and ticks may use different casing).
#[inline]
pub fn normalize_symbol(s: &str) -> String {
    s.trim().to_uppercase()
}

fn tick_key(symbol: &str, group_id: Option<&str>) -> String {
    let sym = normalize_symbol(symbol);
    match group_id {
        Some(g) if !g.is_empty() => format!("{}:{}", sym, g),
        _ => format!("{}:", sym),
    }
}

/// In-memory cache for pending orders per symbol
/// Redis is source of truth, this is for fast lookup
#[derive(Clone)]
pub struct OrderCache {
    // symbol -> Set<order_id>
    pending_orders: Arc<DashMap<String, HashSet<Uuid>>>,
    // order_id -> Order (cached)
    orders: Arc<DashMap<Uuid, Order>>,
    // symbol -> Tick (last tick)
    last_ticks: Arc<RwLock<DashMap<String, Tick>>>,
    // enabled symbols
    enabled_symbols: Arc<RwLock<HashSet<String>>>,
}

impl OrderCache {
    pub fn new() -> Self {
        Self {
            pending_orders: Arc::new(DashMap::new()),
            orders: Arc::new(DashMap::new()),
            last_ticks: Arc::new(RwLock::new(DashMap::new())),
            enabled_symbols: Arc::new(RwLock::new(HashSet::new())),
        }
    }
    
    pub fn add_pending_order(&self, symbol: &str, order_id: Uuid, order: Order) {
        let key = normalize_symbol(symbol);
        self.pending_orders
            .entry(key.clone())
            .or_insert_with(HashSet::new)
            .insert(order_id);
        self.orders.insert(order_id, order);
        debug!("Added pending order {} for symbol {}", order_id, key);
    }
    
    pub fn remove_pending_order(&self, symbol: &str, order_id: Uuid) {
        let key = normalize_symbol(symbol);
        if let Some(mut set) = self.pending_orders.get_mut(&key) {
            set.remove(&order_id);
        }
        self.orders.remove(&order_id);
        debug!("Removed pending order {} for symbol {}", order_id, key);
    }
    
    pub fn get_pending_orders(&self, symbol: &str) -> Vec<Uuid> {
        let key = normalize_symbol(symbol);
        self.pending_orders
            .get(&key)
            .map(|set| set.iter().copied().collect())
            .unwrap_or_default()
    }
    
    pub fn get_order(&self, order_id: &Uuid) -> Option<Order> {
        self.orders.get(order_id).map(|o| o.clone())
    }
    
    pub fn update_order(&self, order: Order) {
        self.orders.insert(order.id, order);
    }
    
    pub fn update_tick(&self, tick: Tick, group_id: Option<&str>) {
        let key = tick_key(&tick.symbol, group_id);
        let ticks = self.last_ticks.write();
        ticks.insert(key, tick);
    }

    pub fn get_last_tick(&self, symbol: &str, group_id: Option<&str>) -> Option<Tick> {
        let key = tick_key(symbol, group_id);
        let ticks = self.last_ticks.read();
        ticks.get(&key).map(|t| t.clone())
    }
    
    pub fn enable_symbol(&self, symbol: String) {
        let mut symbols = self.enabled_symbols.write();
        symbols.insert(symbol.clone());
        info!("Enabled symbol: {}", symbol);
    }
    
    pub fn is_symbol_enabled(&self, symbol: &str) -> bool {
        let symbols = self.enabled_symbols.read();
        symbols.contains(symbol)
    }
    
    pub fn get_enabled_symbols(&self) -> Vec<String> {
        let symbols = self.enabled_symbols.read();
        symbols.iter().cloned().collect()
    }
}

