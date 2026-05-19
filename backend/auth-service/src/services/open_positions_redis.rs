//! Open positions from Redis (order-engine source of truth).

use std::collections::HashMap;

use redis::AsyncCommands;
use redis_model::keys::Keys;
use uuid::Uuid;

use crate::redis_pool::RedisPool;

const DEFAULT_CAP: usize = 50;

/// List open positions for a user from Redis (`pos:{user_id}` + `pos:by_id:{id}`).
pub async fn fetch_open_positions_json(
    redis: &RedisPool,
    user_id: Uuid,
    cap: usize,
) -> serde_json::Value {
    let cap = if cap == 0 { DEFAULT_CAP } else { cap };
    let mut conn = match redis.get().await {
        Ok(c) => c,
        Err(_) => {
            return serde_json::json!({
                "count": 0,
                "symbols": [],
                "positions": [],
            });
        }
    };

    let positions_key = Keys::positions_set(user_id);
    let position_ids: Vec<String> = conn.smembers(&positions_key).await.unwrap_or_default();

    let mut open = Vec::new();
    let mut symbols = Vec::new();

    for pos_id_str in position_ids {
        if open.len() >= cap {
            break;
        }
        let pos_id = match Uuid::parse_str(&pos_id_str) {
            Ok(u) => u,
            Err(_) => continue,
        };
        let pos_key = Keys::position_by_id(pos_id);
        let status: Option<String> = conn.hget(&pos_key, "status").await.ok().flatten();
        let status = status.as_deref().unwrap_or("");
        if !status.eq_ignore_ascii_case("open") {
            continue;
        }
        let pos_data: HashMap<String, String> = match conn
            .hgetall::<_, HashMap<String, String>>(&pos_key)
            .await
        {
            Ok(d) if !d.is_empty() => d,
            _ => continue,
        };

        let symbol = pos_data
            .get("symbol")
            .cloned()
            .unwrap_or_default();
        if !symbol.is_empty() && !symbols.contains(&symbol) {
            symbols.push(symbol.clone());
        }

        open.push(serde_json::json!({
            "id": pos_id_str,
            "symbol": symbol,
            "side": pos_data.get("side").cloned().unwrap_or_default(),
            "size": pos_data
                .get("size")
                .or_else(|| pos_data.get("original_size"))
                .cloned()
                .unwrap_or_default(),
            "entryPrice": pos_data
                .get("entry_price")
                .or_else(|| pos_data.get("avg_price"))
                .cloned(),
            "margin": pos_data.get("margin").cloned(),
            "unrealizedPnl": pos_data.get("unrealized_pnl").cloned(),
            "leverage": pos_data.get("leverage").cloned(),
        }));
    }

    serde_json::json!({
        "count": open.len(),
        "symbols": symbols,
        "positions": open,
        "cappedAt": cap,
    })
}
