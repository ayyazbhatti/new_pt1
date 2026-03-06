//! Phase 2: Bounded Redis access via ConnectionManager + circuit breaker.
//! - One multiplexed connection per process (no connection storm).
//! - Circuit breaker returns 503 when Redis is unhealthy instead of exhausting resources.

use axum::http::StatusCode;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{info, warn};

/// Circuit state: closed (normal), open (reject requests), or half-open (one trial).
#[derive(Debug, Clone, Copy)]
enum CircuitState {
    Closed,
    Open { until: Instant },
    HalfOpen,
}

/// Opens after N consecutive failures; stays open for COOLDOWN; one trial in half-open.
const FAILURE_THRESHOLD: u32 = 3;
const COOLDOWN_SECS: u64 = 30;
const HEALTH_CHECK_INTERVAL_SECS: u64 = 5;

/// Circuit breaker: after FAILURE_THRESHOLD failures, open for COOLDOWN_SECS; then half-open.
#[derive(Clone)]
pub struct CircuitBreaker {
    state: Arc<RwLock<CircuitState>>,
    failure_count: Arc<AtomicU32>,
}

impl CircuitBreaker {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(CircuitState::Closed)),
            failure_count: Arc::new(AtomicU32::new(0)),
        }
    }

    /// Returns true if the request is allowed (circuit closed or half-open).
    pub async fn allow_request(&self) -> bool {
        let mut state = self.state.write().await;
        match *state {
            CircuitState::Closed => true,
            CircuitState::Open { until } => {
                if Instant::now() >= until {
                    *state = CircuitState::HalfOpen;
                    info!("Redis circuit: open -> half-open (trial)");
                    true
                } else {
                    false
                }
            }
            CircuitState::HalfOpen => true,
        }
    }

    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::SeqCst);
        let state = self.state.try_write();
        if let Ok(mut g) = state {
            if matches!(*g, CircuitState::HalfOpen) {
                *g = CircuitState::Closed;
                info!("Redis circuit: half-open -> closed");
            }
        }
    }

    pub fn record_failure(&self) {
        let prev = self.failure_count.fetch_add(1, Ordering::SeqCst);
        let count = prev + 1;
        if count >= FAILURE_THRESHOLD {
            let state = self.state.try_write();
            if let Ok(mut g) = state {
                let now = Instant::now();
                *g = CircuitState::Open {
                    until: now + Duration::from_secs(COOLDOWN_SECS),
                };
                self.failure_count.store(0, Ordering::SeqCst);
                warn!(
                    "Redis circuit: opened for {}s ({} failures)",
                    COOLDOWN_SECS, count
                );
            }
        }
    }
}

/// Redis pool: one multiplexed connection (ConnectionManager) + circuit breaker.
/// Handlers call get() to obtain a connection; if the circuit is open, get() returns 503.
#[derive(Clone)]
pub struct RedisPool {
    manager: Arc<redis::aio::ConnectionManager>,
    circuit: Arc<CircuitBreaker>,
}

impl RedisPool {
    /// Create pool and spawn background health check. Uses one connection for the process.
    pub async fn new(redis_url: &str) -> anyhow::Result<Arc<Self>> {
        let client = redis::Client::open(redis_url)?;
        let manager = redis::aio::ConnectionManager::new(client)
            .await
            .map_err(|e| anyhow::anyhow!("Redis connection manager: {}", e))?;
        let manager = Arc::new(manager);
        let circuit = Arc::new(CircuitBreaker::new());

        let pool = Arc::new(Self {
            manager: manager.clone(),
            circuit: circuit.clone(),
        });

        // Background health check: ping Redis periodically; update circuit on success/failure
        tokio::spawn({
            let manager = manager.clone();
            let circuit = circuit.clone();
            async move {
                let mut interval = tokio::time::interval(Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    interval.tick().await;
                    let mut conn = (*manager).clone();
                    match redis::cmd("PING").query_async::<_, String>(&mut conn).await {
                        Ok(_) => circuit.record_success(),
                        Err(e) => {
                            warn!("Redis health check failed: {}", e);
                            circuit.record_failure();
                        }
                    }
                }
            }
        });

        Ok(pool)
    }

    /// Get a connection for this request. Returns 503 if the circuit is open.
    pub async fn get(&self) -> Result<redis::aio::ConnectionManager, StatusCode> {
        if !self.circuit.allow_request().await {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        Ok((*self.manager).clone())
    }
}
