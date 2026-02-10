use redis::streams::{StreamReadOptions, StreamReadReply};
use redis::{Client, aio::ConnectionManager};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};
use anyhow::Result;
use futures_util::StreamExt;

pub type MessageSender = broadcast::Sender<(String, serde_json::Value)>;

#[derive(Clone)]
pub struct RedisSubscriber {
    client: Arc<Client>,
    manager: Arc<ConnectionManager>,
    channels: Vec<String>,
    sender: MessageSender,
    reconnect_interval: Duration,
}

impl RedisSubscriber {
    pub async fn new(redis_url: &str, channels: Vec<String>, reconnect_interval_secs: u64) -> Result<Self> {
        let client = Client::open(redis_url)?;
        let manager = ConnectionManager::new(client.clone()).await?;
        let (sender, _) = broadcast::channel(10000);

        Ok(Self {
            client: Arc::new(client),
            manager: Arc::new(manager),
            channels,
            sender,
            reconnect_interval: Duration::from_secs(reconnect_interval_secs),
        })
    }

    pub fn subscribe(&self) -> MessageSender {
        self.sender.clone()
    }

    pub async fn start(&self) {
        let channels = self.channels.clone();
        let client = self.client.clone();
        let manager = self.manager.clone();
        let sender = self.sender.clone();
        let reconnect_interval = self.reconnect_interval;

        tokio::spawn(async move {
            loop {
                match Self::run_subscriber(&channels, &client, &manager, &sender).await {
                    Ok(_) => {
                        warn!("Redis subscriber exited unexpectedly");
                    }
                    Err(e) => {
                        error!("Redis subscriber error: {}", e);
                    }
                }

                warn!("Reconnecting to Redis in {:?}...", reconnect_interval);
                sleep(reconnect_interval).await;
            }
        });
    }

    async fn run_subscriber(
        channels: &[String],
        client: &Client,
        _manager: &ConnectionManager,
        sender: &MessageSender,
    ) -> Result<()> {
        let mut conn = client.get_async_connection().await?;
        let mut pubsub = conn.into_pubsub();

        // Subscribe to all channels
        for channel in channels {
            pubsub.subscribe(channel).await?;
            info!("Subscribed to Redis channel: {}", channel);
        }

        let mut stream = pubsub.into_on_message();

        while let Some(msg) = stream.next().await {
            let channel: String = msg.get_channel_name().to_string();
            let payload: String = msg.get_payload()?;

            // Parse JSON
            match serde_json::from_str::<serde_json::Value>(&payload) {
                Ok(json) => {
                    let _ = sender.send((channel, json));
                }
                Err(e) => {
                    warn!("Failed to parse Redis message from {}: {}", channel, e);
                }
            }
        }

        Err(anyhow::anyhow!("Redis stream ended"))
    }
}

