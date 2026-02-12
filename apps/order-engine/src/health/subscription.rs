use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use tokio::time::sleep;
use tracing::{info, error, warn};
use crate::nats::SubscriptionHealth;

#[derive(Clone)]
pub struct SubscriptionMonitor {
    health: Arc<SubscriptionHealth>,
    max_silence_seconds: u64,
    check_interval: Duration,
}

impl SubscriptionMonitor {
    pub fn new(health: Arc<SubscriptionHealth>, max_silence_seconds: u64) -> Self {
        Self {
            health,
            max_silence_seconds,
            check_interval: Duration::from_secs(60), // Check every minute
        }
    }

    pub async fn start_monitoring(&self) {
        info!("🔍 Starting subscription health monitor (max silence: {}s)", self.max_silence_seconds);
        
        loop {
            sleep(self.check_interval).await;
            
            let age = self.health.last_message_age();
            let (msg_count, error_count, _) = self.health.get_stats();
            
            if age > self.max_silence_seconds {
                error!(
                    "⚠️ SUBSCRIPTION HEALTH ALERT: No messages received for {} seconds ({} messages processed, {} errors)",
                    age, msg_count, error_count
                );
                // In production, you would trigger reconnection here
                // For now, we just log the alert
            } else if age > self.max_silence_seconds / 2 {
                warn!(
                    "⚠️ Subscription may be unhealthy: {} seconds since last message ({} messages processed, {} errors)",
                    age, msg_count, error_count
                );
            } else {
                info!(
                    "✅ Subscription healthy: {}s since last message ({} messages, {} errors)",
                    age, msg_count, error_count
                );
            }
        }
    }
}

