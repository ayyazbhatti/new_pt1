use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Clone)]
pub struct Metrics {
    orders_processed: Arc<AtomicU64>,
    orders_filled: Arc<AtomicU64>,
    orders_rejected: Arc<AtomicU64>,
    orders_canceled: Arc<AtomicU64>,
    ticks_processed: Arc<AtomicU64>,
    positions_opened: Arc<AtomicU64>,
    positions_closed: Arc<AtomicU64>,
}

impl Metrics {
    pub fn new() -> Self {
        Self {
            orders_processed: Arc::new(AtomicU64::new(0)),
            orders_filled: Arc::new(AtomicU64::new(0)),
            orders_rejected: Arc::new(AtomicU64::new(0)),
            orders_canceled: Arc::new(AtomicU64::new(0)),
            ticks_processed: Arc::new(AtomicU64::new(0)),
            positions_opened: Arc::new(AtomicU64::new(0)),
            positions_closed: Arc::new(AtomicU64::new(0)),
        }
    }
    
    pub fn inc_orders_processed(&self) {
        self.orders_processed.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn inc_orders_filled(&self) {
        self.orders_filled.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn inc_orders_rejected(&self) {
        self.orders_rejected.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn inc_orders_canceled(&self) {
        self.orders_canceled.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn inc_ticks_processed(&self) {
        self.ticks_processed.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn inc_positions_opened(&self) {
        self.positions_opened.fetch_add(1, Ordering::Relaxed);
    }
    
    pub fn inc_positions_closed(&self) {
        self.positions_closed.fetch_add(1, Ordering::Relaxed);
    }
}

