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
    reopen_position_script: Script,
    reopen_position_with_params_script: Script,
    update_position_params_script: Script,
    check_sltp_triggers_script: Script,
}

impl LuaScripts {
    pub fn new() -> Result<Self> {
        let fill_order_script = Script::new(include_str!("../../lua/atomic_fill_order.lua"));
        let cancel_order_script = Script::new(include_str!("../../lua/atomic_cancel_order.lua"));
        let close_position_script = Script::new(include_str!("../../lua/atomic_close_position.lua"));
        let reopen_position_script = Script::new(include_str!("../../lua/atomic_reopen_position.lua"));
        let reopen_position_with_params_script = Script::new(include_str!("../../lua/atomic_reopen_position_with_params.lua"));
        let update_position_params_script = Script::new(include_str!("../../lua/atomic_update_position_params.lua"));
        let check_sltp_triggers_script = Script::new(include_str!("../../lua/check_sltp_triggers.lua"));
        
        Ok(Self {
            fill_order_script,
            cancel_order_script,
            close_position_script,
            reopen_position_script,
            reopen_position_with_params_script,
            update_position_params_script,
            check_sltp_triggers_script,
        })
    }
    
    pub async fn atomic_fill_order(
        &self,
        conn: &mut ConnectionManager,
        order_id: &Uuid,
        fill_price: Decimal,
        fill_size: Decimal,
        effective_leverage: Decimal,
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
            .arg(effective_leverage.normalize().to_string())
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
        close_reason: Option<&str>,
    ) -> Result<serde_json::Value> {
        let size_arg = close_size
            .map(|s| s.to_string())
            .unwrap_or_else(|| "0".to_string());
        let reason_arg = close_reason.unwrap_or("");
        let result: String = self.close_position_script
            .key(format!("pos:by_id:{}", position_id))  // New format
            .arg(position_id.to_string())
            .arg(exit_price.to_string())
            .arg(size_arg)
            .arg(Utc::now().timestamp_millis().to_string())
            .arg(reason_arg)
            .invoke_async(conn)
            .await
            .context("Failed to execute atomic_close_position Lua script")?;
        
        let json: serde_json::Value = serde_json::from_str(&result)
            .context("Failed to parse close result")?;
        
        debug!("Atomic close result: {}", json);
        Ok(json)
    }
    
    pub async fn atomic_reopen_position(
        &self,
        conn: &mut ConnectionManager,
        position_id: &Uuid,
    ) -> Result<serde_json::Value> {
        let result: String = self.reopen_position_script
            .arg(position_id.to_string())
            .arg(Utc::now().timestamp_millis().to_string())
            .invoke_async(conn)
            .await
            .context("Failed to execute atomic_reopen_position Lua script")?;
        let json: serde_json::Value = serde_json::from_str(&result)
            .context("Failed to parse reopen result")?;
        debug!("Atomic reopen result: {}", json);
        Ok(json)
    }

    /// Reopen the same position with optional overrides (size, entry_price, side, sl, tp).
    /// Empty string for an arg means "keep existing" (for size/entry) or "clear" (for sl/tp).
    pub async fn atomic_reopen_position_with_params(
        &self,
        conn: &mut ConnectionManager,
        position_id: &Uuid,
        size_override: Option<&str>,
        entry_override: Option<&str>,
        side_override: Option<&str>,
        sl_override: Option<&str>,
        tp_override: Option<&str>,
    ) -> Result<serde_json::Value> {
        let size_s = size_override.unwrap_or("");
        let entry_s = entry_override.unwrap_or("");
        let side_s = side_override.unwrap_or("");
        let sl_s = sl_override.unwrap_or("");
        let tp_s = tp_override.unwrap_or("");
        let result: String = self.reopen_position_with_params_script
            .arg(position_id.to_string())
            .arg(Utc::now().timestamp_millis().to_string())
            .arg(size_s)
            .arg(entry_s)
            .arg(side_s)
            .arg(sl_s)
            .arg(tp_s)
            .invoke_async(conn)
            .await
            .context("Failed to execute atomic_reopen_position_with_params Lua script")?;
        let json: serde_json::Value = serde_json::from_str(&result)
            .context("Failed to parse reopen_with_params result")?;
        debug!("Atomic reopen with params result: {}", json);
        Ok(json)
    }

    /// Update an OPEN position's size, entry_price, sl, tp in Redis.
    pub async fn atomic_update_position_params(
        &self,
        conn: &mut ConnectionManager,
        position_id: &Uuid,
        size_override: Option<&str>,
        entry_override: Option<&str>,
        sl_override: Option<&str>,
        tp_override: Option<&str>,
    ) -> Result<serde_json::Value> {
        let size_s = size_override.unwrap_or("");
        let entry_s = entry_override.unwrap_or("");
        let sl_s = sl_override.unwrap_or("");
        let tp_s = tp_override.unwrap_or("");
        let result: String = self.update_position_params_script
            .arg(position_id.to_string())
            .arg(Utc::now().timestamp_millis().to_string())
            .arg(size_s)
            .arg(entry_s)
            .arg(sl_s)
            .arg(tp_s)
            .invoke_async(conn)
            .await
            .context("Failed to execute atomic_update_position_params Lua script")?;
        let json: serde_json::Value = serde_json::from_str(&result)
            .context("Failed to parse update_position_params result")?;
        debug!("Atomic update position params result: {}", json);
        Ok(json)
    }
    
    pub async fn check_sltp_triggers(
        &self,
        conn: &mut ConnectionManager,
        symbol: &str,
        group_id: &str,
        bid: Decimal,
        ask: Decimal,
    ) -> Result<serde_json::Value> {
        let result: String = self.check_sltp_triggers_script
            .arg(symbol)
            .arg(bid.to_string())
            .arg(ask.to_string())
            .arg(group_id)
            .invoke_async(conn)
            .await
            .context("Failed to execute check_sltp_triggers Lua script")?;
        
        let json: serde_json::Value = serde_json::from_str(&result)
            .context("Failed to parse SL/TP triggers result")?;
        
        debug!("SL/TP triggers result: {}", json);
        Ok(json)
    }
}

