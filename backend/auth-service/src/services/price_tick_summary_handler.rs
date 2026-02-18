//! Subscribes to Redis `price:ticks` and recomputes account summary for users with open positions
//! so unrealized PnL (and equity, free margin, margin level) stay real-time. No polling.

use crate::routes::deposits::{compute_and_cache_account_summary_with_prices, PriceOverrides};
use futures::StreamExt;
use redis::AsyncCommands;
use redis_model::keys::Keys;
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

const THROTTLE_MS: u64 = 100;

pub struct PriceTickSummaryHandler {
    pool: sqlx::PgPool,
    redis: redis::Client,
    last_update_per_user: std::sync::Mutex<HashMap<Uuid, Instant>>,
}

impl PriceTickSummaryHandler {
    pub fn new(pool: sqlx::PgPool, redis: redis::Client) -> Self {
        Self {
            pool,
            redis,
            last_update_per_user: std::sync::Mutex::new(HashMap::new()),
        }
    }

    fn should_skip_throttle(&self, user_id: Uuid) -> bool {
        let mut guard = match self.last_update_per_user.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };
        let now = Instant::now();
        if let Some(last) = guard.get(&user_id) {
            if now.saturating_duration_since(*last) < Duration::from_millis(THROTTLE_MS) {
                return true;
            }
        }
        guard.insert(user_id, now);
        false
    }

    pub async fn start_listener(&self, redis_url: &str) {
        info!("📡 Starting price:ticks subscriber for real-time account summary");

        loop {
            match redis::Client::open(redis_url) {
                Ok(client) => {
                    if let Err(e) = self.run_subscriber(&client).await {
                        error!("price:ticks subscriber error: {}", e);
                    }
                }
                Err(e) => {
                    error!("Failed to open Redis for price:ticks: {}", e);
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }

    async fn run_subscriber(&self, client: &redis::Client) -> anyhow::Result<()> {
        let conn = client.get_async_connection().await?;
        let mut pubsub = conn.into_pubsub();
        pubsub.subscribe("price:ticks").await?;
        info!("✅ Subscribed to Redis price:ticks");
        let mut stream = pubsub.into_on_message();

        while let Some(msg) = stream.next().await {
            if let Ok(payload_str) = msg.get_payload::<String>() {
                if let Err(e) = self.handle_tick(&payload_str).await {
                    warn!("Failed to handle price tick: {}", e);
                }
            }
        }

        Ok(())
    }

    async fn handle_tick(&self, payload_str: &str) -> anyhow::Result<()> {
        let payload: serde_json::Value = serde_json::from_str(payload_str)
            .map_err(|e| anyhow::anyhow!("Invalid JSON: {}", e))?;

        let symbol = payload
            .get("symbol")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing symbol"))?
            .to_string();

        let prices_array = payload
            .get("prices")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow::anyhow!("Missing prices array"))?;

        if prices_array.is_empty() {
            return Ok(());
        }

        let mut conn = self.redis.get_async_connection().await?;
        let open_key = Keys::positions_open_by_symbol(&symbol);
        let position_ids: Vec<String> = conn.zrange(&open_key, 0, -1).await.unwrap_or_default();

        if position_ids.is_empty() {
            return Ok(());
        }

        let mut user_overrides: HashMap<Uuid, PriceOverrides> = HashMap::new();

        for pos_id_str in position_ids {
            let pos_id = match Uuid::parse_str(&pos_id_str) {
                Ok(u) => u,
                Err(_) => continue,
            };
            let pos_key = Keys::position_by_id(pos_id);
            let status: Option<String> = conn.hget(&pos_key, "status").await.ok().flatten();
            if status.as_deref() != Some("OPEN") {
                continue;
            }
            let user_id_str: Option<String> = conn.hget(&pos_key, "user_id").await.ok().flatten();
            let user_id = match user_id_str.and_then(|s| Uuid::parse_str(&s).ok()) {
                Some(u) => u,
                None => continue,
            };
            let group_id: String = conn.hget(&pos_key, "group_id").await.ok().flatten().unwrap_or_default();

            let (bid, ask) = match prices_array.iter().find(|p| p.get("g").and_then(|v| v.as_str()) == Some(group_id.as_str())) {
                Some(p) => {
                    let bid_s = p.get("bid").and_then(|v| v.as_str()).unwrap_or("0");
                    let ask_s = p.get("ask").and_then(|v| v.as_str()).unwrap_or("0");
                    let bid = Decimal::from_str(bid_s).unwrap_or(Decimal::ZERO);
                    let ask = Decimal::from_str(ask_s).unwrap_or(Decimal::ZERO);
                    (bid, ask)
                }
                None => {
                    let first = prices_array.first().and_then(|p| {
                        let bid_s = p.get("bid").and_then(|v| v.as_str())?;
                        let ask_s = p.get("ask").and_then(|v| v.as_str())?;
                        Some((
                            Decimal::from_str(bid_s).unwrap_or(Decimal::ZERO),
                            Decimal::from_str(ask_s).unwrap_or(Decimal::ZERO),
                        ))
                    });
                    match first {
                        Some((b, a)) => (b, a),
                        None => continue,
                    }
                }
            };

            user_overrides
                .entry(user_id)
                .or_default()
                .insert((symbol.clone(), group_id), (bid, ask));
        }

        for (user_id, overrides) in user_overrides {
            if self.should_skip_throttle(user_id) {
                debug!("Throttle skip user {} ({}ms)", user_id, THROTTLE_MS);
                continue;
            }
            compute_and_cache_account_summary_with_prices(
                &self.pool,
                &self.redis,
                user_id,
                Some(overrides),
            )
            .await;
        }

        Ok(())
    }
}
