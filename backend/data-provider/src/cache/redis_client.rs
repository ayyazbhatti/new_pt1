use anyhow::Result;
use redis::aio::ConnectionManager;
use redis::{AsyncCommands, Client};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkupConfig {
    pub bid_markup: f64,
    pub ask_markup: f64,
    #[serde(rename = "type")]
    pub markup_type: String, // "percent" (bid/ask markup as %)
}

pub struct RedisClient {
    client: Client,
    connection: Arc<RwLock<ConnectionManager>>,
}

impl RedisClient {
    pub async fn new(redis_url: &str) -> Result<Self> {
        let client = Client::open(redis_url)?;
        let connection = ConnectionManager::new(client.clone()).await?;

        info!("✅ Redis client connected");

        Ok(Self {
            client,
            connection: Arc::new(RwLock::new(connection)),
        })
    }

    pub async fn get_markup(
        &self,
        symbol: &str,
        group: &str,
    ) -> Result<Option<MarkupConfig>> {
        let key = format!("symbol:markup:{}:{}", symbol, group);
        let mut conn = self.connection.write().await;

        let value: Option<String> = conn.get(&key).await?;

        if let Some(json) = value {
            let markup: MarkupConfig = serde_json::from_str(&json)?;
            Ok(Some(markup))
        } else {
            Ok(None)
        }
    }

    pub async fn get_symbol_status(&self, symbol: &str) -> Result<bool> {
        let key = format!("symbol:status:{}", symbol);
        let mut conn = self.connection.write().await;

        let status: Option<String> = conn.get(&key).await?;
        Ok(status.map(|s| s == "enabled").unwrap_or(true)) // Default to enabled
    }

    pub async fn publish_price_update(&self, channel: &str, message: &str) -> Result<()> {
        let mut conn = self.connection.write().await;
        conn.publish(channel, message).await?;
        Ok(())
    }

    /// SMEMBERS price:groups — group_ids that receive per-group price stream.
    pub async fn smembers_price_groups(&self) -> Result<Vec<String>> {
        let mut conn = self.connection.write().await;
        let members: Vec<String> = conn.smembers("price:groups").await?;
        Ok(members)
    }

    pub async fn subscribe_to_updates<F>(&self, channels: Vec<String>, callback: F) -> Result<()>
    where
        F: Fn(String, String) + Send + Sync + 'static,
    {
        let client = self.client.clone();
        let mut pubsub = client.get_async_connection().await?.into_pubsub();
        
        for channel in channels {
            pubsub.subscribe(&channel).await?;
        }

        tokio::spawn(async move {
            let mut stream = pubsub.into_on_message();
            while let Some(msg) = stream.next().await {
                let channel: String = msg.get_channel_name().to_string();
                let payload: String = msg.get_payload().unwrap_or_default();
                callback(channel, payload);
            }
        });

        Ok(())
    }

    pub fn get_connection_manager(&self) -> Arc<RwLock<ConnectionManager>> {
        self.connection.clone()
    }

    pub fn get_client(&self) -> Client {
        self.client.clone()
    }
}

use futures_util::StreamExt;

