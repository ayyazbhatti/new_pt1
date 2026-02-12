use anyhow::{Context, Result};
use rust_decimal::Decimal;
use std::str::FromStr;
use uuid::Uuid;
use redis::aio::ConnectionManager;
use crate::models::OrderCommand;
use tracing::{warn, debug};

pub struct Validator;

impl Validator {
    pub async fn validate_order(
        &self,
        conn: &mut ConnectionManager,
        cmd: &OrderCommand,
    ) -> Result<()> {
        // Validate symbol is enabled
        // Check symbol status (format: symbol:status:SYMBOL)
        let symbol_status_key = format!("symbol:status:{}", cmd.symbol);
        let symbol_status: Option<String> = {
            use redis::AsyncCommands;
            conn.get(&symbol_status_key).await?
        };
        
        // If status key exists, check if it's enabled
        if let Some(status) = symbol_status {
            if status != "enabled" {
                return Err(anyhow::anyhow!("Symbol {} is not enabled", cmd.symbol));
            }
        } else {
            // Also check legacy format: symbol:SYMBOL (for backward compatibility)
            let symbol_key = format!("symbol:{}", cmd.symbol);
            let symbol_json: Option<String> = {
                use redis::AsyncCommands;
                conn.get(&symbol_key).await?
            };
            
            if symbol_json.is_none() {
                // Default to enabled if no status found (for backward compatibility)
                // In production, you might want to reject instead
                warn!("Symbol {} status not found in Redis, defaulting to enabled", cmd.symbol);
            } else {
                let symbol_data: serde_json::Value = serde_json::from_str(&symbol_json.unwrap())?;
                if !symbol_data.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true) {
                    return Err(anyhow::anyhow!("Symbol {} is not enabled", cmd.symbol));
                }
            }
        }
        
        // Validate size > 0
        if cmd.size <= Decimal::ZERO {
            return Err(anyhow::anyhow!("Order size must be greater than zero"));
        }
        
        // Validate limit price for limit orders
        if cmd.order_type == contracts::enums::OrderType::Limit {
            if cmd.limit_price.is_none() {
                return Err(anyhow::anyhow!("Limit order requires limit_price"));
            }
            if let Some(limit) = cmd.limit_price {
                if limit <= Decimal::ZERO {
                    return Err(anyhow::anyhow!("Limit price must be greater than zero"));
                }
            }
        }
        
        // Validate SL/TP prices if provided
        // Note: We can't validate against entry price here since market orders don't have a fixed entry price
        // The grace period in check_sltp_triggers.lua will prevent immediate triggering
        if let Some(sl) = cmd.stop_loss {
            if sl <= Decimal::ZERO {
                return Err(anyhow::anyhow!("Stop loss price must be greater than zero"));
            }
        }
        if let Some(tp) = cmd.take_profit {
            if tp <= Decimal::ZERO {
                return Err(anyhow::anyhow!("Take profit price must be greater than zero"));
            }
        }
        
        // Check balance (simplified - would need proper margin calculation)
        let balance_key = format!("user:{}:balance", cmd.user_id);
        let balance_json: Option<String> = redis::cmd("GET")
            .arg(&balance_key)
            .query_async(conn)
            .await?;
        
        if let Some(bal_json) = balance_json {
            let balance: serde_json::Value = serde_json::from_str(&bal_json)?;
            let available: Decimal = balance
                .get("available")
                .and_then(|v| v.as_str())
                .and_then(|s| Decimal::from_str_exact(s).ok())
                .unwrap_or(Decimal::ZERO);
            
            // For market orders, estimate required margin
            let estimated_margin = cmd.size * Decimal::from(100); // Simplified
            if available < estimated_margin {
                return Err(anyhow::anyhow!("Insufficient balance"));
            }
        }
        
        debug!("Order validation passed for user {} symbol {}", cmd.user_id, cmd.symbol);
        Ok(())
    }
}

