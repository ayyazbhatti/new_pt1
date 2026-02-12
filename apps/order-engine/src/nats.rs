use async_nats::{Client, jetstream::{self, Context, Message as JetStreamMessage}};
use anyhow::{Result, Context as AnyhowContext};
use tracing::{info, error, warn};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use std::sync::atomic::{AtomicU64, AtomicBool, Ordering};
use tokio::time::sleep;
use contracts::VersionedMessage;

pub struct NatsClient {
    client: Arc<Client>,
    jetstream: Option<Arc<Context>>,
}

pub struct SubscriptionHealth {
    last_message_time: Arc<AtomicU64>,
    message_count: Arc<AtomicU64>,
    error_count: Arc<AtomicU64>,
    // Task lifecycle tracking
    handler_task_alive: Arc<AtomicBool>,
    subscription_active: Arc<AtomicBool>,
    handler_entries: Arc<AtomicU64>,
}

impl SubscriptionHealth {
    pub fn new() -> Self {
        Self {
            last_message_time: Arc::new(AtomicU64::new(0)),
            message_count: Arc::new(AtomicU64::new(0)),
            error_count: Arc::new(AtomicU64::new(0)),
            handler_task_alive: Arc::new(AtomicBool::new(false)),
            subscription_active: Arc::new(AtomicBool::new(false)),
            handler_entries: Arc::new(AtomicU64::new(0)),
        }
    }
    
    /// Set handler task alive status
    pub fn set_handler_task_alive(&self, alive: bool) {
        self.handler_task_alive.store(alive, Ordering::Relaxed);
    }
    
    /// Set subscription active status
    pub fn set_subscription_active(&self, active: bool) {
        self.subscription_active.store(active, Ordering::Relaxed);
    }
    
    /// Record handler entry (when handle_place_order is called)
    pub fn record_handler_entry(&self) {
        self.handler_entries.fetch_add(1, Ordering::Relaxed);
    }
    
    /// Get full statistics including task and subscription status
    pub fn get_full_stats(&self) -> (u64, u64, u64, bool, bool, u64) {
        (
            self.message_count.load(Ordering::Relaxed),
            self.error_count.load(Ordering::Relaxed),
            self.last_message_age(),
            self.handler_task_alive.load(Ordering::Relaxed),
            self.subscription_active.load(Ordering::Relaxed),
            self.handler_entries.load(Ordering::Relaxed),
        )
    }

    pub fn record_message(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.last_message_time.store(now, Ordering::Relaxed);
        self.message_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_error(&self) {
        self.error_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn last_message_age(&self) -> u64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let last = self.last_message_time.load(Ordering::Relaxed);
        if last == 0 {
            u64::MAX
        } else {
            now.saturating_sub(last)
        }
    }

    pub fn is_healthy(&self, max_age_seconds: u64) -> bool {
        self.last_message_age() < max_age_seconds
    }

    pub fn get_stats(&self) -> (u64, u64, u64) {
        (
            self.message_count.load(Ordering::Relaxed),
            self.error_count.load(Ordering::Relaxed),
            self.last_message_age(),
        )
    }
}

impl NatsClient {
    pub async fn connect(url: &str) -> Result<Self> {
        Self::connect_with_retry(url, 5).await
    }

    async fn connect_with_retry(url: &str, max_retries: u32) -> Result<Self> {
        let mut backoff = Duration::from_secs(1);
        let max_backoff = Duration::from_secs(60);
        let mut last_error = None;

        for attempt in 1..=max_retries {
            match async_nats::connect(url).await {
                Ok(client) => {
                    info!("✅ Connected to NATS at {} (attempt {})", url, attempt);
                    
                    // Try to create JetStream context (synchronous, not async)
                    let jetstream = {
                        let js = jetstream::new(client.clone());
                        info!("✅ JetStream context created - using persistent messaging");
                        Some(Arc::new(js))
                    };

                    return Ok(Self {
                        client: Arc::new(client),
                        jetstream,
                    });
                }
                Err(e) => {
                    last_error = Some(e);
                    if attempt < max_retries {
                        warn!("Failed to connect to NATS (attempt {}): {}. Retrying in {:?}...", 
                              attempt, last_error.as_ref().unwrap(), backoff);
                        sleep(backoff).await;
                        backoff = (backoff * 2).min(max_backoff);
                    }
                }
            }
        }

        Err(anyhow::anyhow!(
            "Failed to connect to NATS after {} attempts: {:?}",
            max_retries,
            last_error
        ))
    }
    
    pub fn client(&self) -> &Arc<Client> {
        &self.client
    }

    pub fn jetstream(&self) -> Option<&Arc<Context>> {
        self.jetstream.as_ref()
    }

    pub async fn publish_event<T: serde::Serialize>(
        &self,
        subject: &str,
        event: &T,
    ) -> Result<()> {
        // Wrap event in VersionedMessage (required by core-api persistence consumer)
        let msg = VersionedMessage::new(subject, event)
            .context("Failed to create VersionedMessage")?;
        let payload = serde_json::to_vec(&msg)
            .context("Failed to serialize VersionedMessage")?;
        
        // Publish to both JetStream (if available) and basic pub/sub
        // Core-api uses basic pub/sub, so we need to publish there too
        let mut published_to_jetstream = false;
        if let Some(js) = &self.jetstream {
            let payload_clone = payload.clone();
            match js.publish(subject.to_string(), payload_clone.into()).await {
                Ok(_) => {
                    info!("📤 Published to JetStream: {}", subject);
                    published_to_jetstream = true;
                }
                Err(e) => {
                    warn!("JetStream publish failed, falling back to basic pub/sub: {}", e);
                }
            }
        }
        
        // Always publish via basic pub/sub so core-api persistence consumer can receive it
        self.client.publish(subject.to_string(), payload.into()).await?;
        if published_to_jetstream {
            info!("📤 Published to NATS (basic pub/sub): {}", subject);
        } else {
            info!("📤 Published to NATS: {}", subject);
        }
        Ok(())
    }

    /// Create or get JetStream stream for orders
    pub async fn ensure_order_stream(&self) -> Result<()> {
        let js = self.jetstream()
            .ok_or_else(|| anyhow::anyhow!("JetStream not available"))?;

        // Try to get existing stream
        if js.get_stream("ORDERS").await.is_ok() {
            info!("✅ ORDERS stream already exists");
            return Ok(());
        }

        // Create stream
        let stream_config = jetstream::stream::Config {
            name: "ORDERS".to_string(),
            subjects: vec!["cmd.order.>".to_string()],
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            max_age: Duration::from_secs(3600), // 1 hour
            storage: jetstream::stream::StorageType::File,
            max_messages: 1_000_000,
            max_bytes: 10_000_000_000i64, // 10GB
            ..Default::default()
        };

        js.create_stream(stream_config).await
            .context("Failed to create ORDERS stream")?;
        
        info!("✅ Created ORDERS JetStream stream");
        Ok(())
    }

    /// Create JetStream consumer for order commands
    /// Using push consumer for automatic message delivery
    pub async fn create_order_consumer(&self) -> Result<jetstream::consumer::Consumer<jetstream::consumer::push::Config>> {
        let js = self.jetstream()
            .ok_or_else(|| anyhow::anyhow!("JetStream not available"))?;

        // Ensure stream exists
        self.ensure_order_stream().await?;

        // Create push consumer for automatic message delivery
        let consumer_config = jetstream::consumer::push::Config {
            durable_name: Some("order-engine".to_string()),
            deliver_subject: "order-engine.deliver".to_string(),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 5, // Retry up to 5 times
            ack_wait: Duration::from_secs(30),
            ..Default::default()
        };

        let stream = js.get_stream("ORDERS").await?;
        let consumer = stream
            .create_consumer(consumer_config)
            .await
            .context("Failed to create order consumer")?;

        info!("✅ Created JetStream push consumer: order-engine");
        Ok(consumer)
    }
}

