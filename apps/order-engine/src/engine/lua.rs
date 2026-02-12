use redis::aio::ConnectionManager;
use redis::Script;
use anyhow::{Context, Result};
use uuid::Uuid;
use rust_decimal::Decimal;
use chrono::Utc;
use tracing::{error, debug};
use std::str;

pub struct LuaScripts {
    fill_order_script: Script,
    cancel_order_script: Script,
    close_position_script: Script,
}

impl LuaScripts {
    pub fn new() -> Result<Self> {
        let fill_order_script = Script::new(include_str!("../../lua/atomic_fill_order.lua"));
        let cancel_order_script = Script::new(include_str!("../../lua/atomic_cancel_order.lua"));
        let close_position_script = Script::new(include_str!("../../lua/atomic_close_position.lua"));
        
        Ok(Self {
            fill_order_script,
            cancel_order_script,
            close_position_script,
        })
    }
    
    pub async fn atomic_fill_order(
        &self,
        conn: &mut ConnectionManager,
        order_id: &Uuid,
        fill_price: Decimal,
        fill_size: Decimal,
    ) -> Result<serde_json::Value> {
        // Generate UUID for potential new position
        let position_uuid = uuid::Uuid::new_v4();
        let result: String = self.fill_order_script
            .key(format!("order:{}", order_id))
            .arg(order_id.to_string())
            .arg(fill_price.to_string())
            .arg(fill_size.to_string())
            .arg(Utc::now().timestamp_millis().to_string())
            .arg(position_uuid.to_string())
            .invoke_async(conn)
            .await
            .context("Failed to execute atomic_fill_order Lua script")?;
        
        let json: serde_json::Value = serde_json::from_str(&result)
            .context("Failed to parse fill result")?;
        
        debug!("Atomic fill result: {}", json);
        Ok(json)
    }
    
    pub async fn atomic_cancel_order(
        &self,
        conn: &mut ConnectionManager,
        order_id: &Uuid,
    ) -> Result<bool> {
        let result: String = self.cancel_order_script
            .key(format!("order:{}", order_id))
            .arg(order_id.to_string())
            .arg(Utc::now().timestamp_millis().to_string())
            .invoke_async(conn)
            .await
            .context("Failed to execute atomic_cancel_order Lua script")?;
        
        Ok(result == "1")
    }
    
    pub async fn atomic_close_position(
        &self,
        conn: &mut ConnectionManager,
        position_id: &Uuid,
        exit_price: Decimal,
        close_size: Option<Decimal>,
    ) -> Result<serde_json::Value> {
        let size_arg = close_size
            .map(|s| s.to_string())
            .unwrap_or_else(|| "0".to_string());
        
        let result: String = self.close_position_script
            .key(format!("position:{}", position_id))
            .arg(position_id.to_string())
            .arg(exit_price.to_string())
            .arg(size_arg)
            .arg(Utc::now().timestamp_millis().to_string())
            .invoke_async(conn)
            .await
            .context("Failed to execute atomic_close_position Lua script")?;
        
        let json: serde_json::Value = serde_json::from_str(&result)
            .context("Failed to parse close result")?;
        
        debug!("Atomic close result: {}", json);
        Ok(json)
    }
}

