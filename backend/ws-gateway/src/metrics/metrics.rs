use prometheus::{Counter, Gauge, Histogram, Registry};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

pub struct Metrics {
    pub connections_total: Gauge,
    pub messages_out_total: Counter,
    pub messages_in_total: Counter,
    pub latency_ms: Histogram,
    pub subscriptions_total: Gauge,
    pub errors_total: Counter,
    pub registry: Registry,
}

impl Metrics {
    pub fn new() -> anyhow::Result<Self> {
        let registry = Registry::new();

        let connections_total = Gauge::new("ws_connections_total", "Total WebSocket connections")?;
        let messages_out_total = Counter::new("ws_messages_out_total", "Total messages sent to clients")?;
        let messages_in_total = Counter::new("ws_messages_in_total", "Total messages received from clients")?;
        let latency_ms = Histogram::with_opts(
            prometheus::HistogramOpts::new("ws_latency_ms", "Message latency in milliseconds")
                .buckets(vec![1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0]),
        )?;
        let subscriptions_total = Gauge::new("ws_subscriptions_total", "Total active subscriptions")?;
        let errors_total = Counter::new("ws_errors_total", "Total errors")?;

        registry.register(Box::new(connections_total.clone()))?;
        registry.register(Box::new(messages_out_total.clone()))?;
        registry.register(Box::new(messages_in_total.clone()))?;
        registry.register(Box::new(latency_ms.clone()))?;
        registry.register(Box::new(subscriptions_total.clone()))?;
        registry.register(Box::new(errors_total.clone()))?;

        Ok(Self {
            connections_total,
            messages_out_total,
            messages_in_total,
            latency_ms,
            subscriptions_total,
            errors_total,
            registry,
        })
    }
}

