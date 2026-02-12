use redis::aio::ConnectionManager;
use redis::Client;
use anyhow::Result;
use tracing::{info, error};
use std::sync::Arc;

pub struct RedisClient {
    client: Arc<Client>,
    manager: Arc<ConnectionManager>,
}

impl RedisClient {
    pub async fn connect(url: &str) -> Result<Self> {
        info!("Connecting to Redis at {}", url);
        let client = Client::open(url)?;
        let manager = ConnectionManager::new(client.clone()).await?;
        
        // Test connection
        let mut conn = manager.clone();
        redis::cmd("PING").query_async::<_, String>(&mut conn).await?;
        info!("✅ Connected to Redis");
        
        Ok(Self {
            client: Arc::new(client),
            manager: Arc::new(manager),
        })
    }
    
    pub async fn get_connection(&self) -> redis::aio::ConnectionManager {
        (*self.manager).clone()
    }
    
    pub fn client(&self) -> &Arc<Client> {
        &self.client
    }
}

