use anyhow::Result;
use rust_decimal::Decimal;
use std::str::FromStr;
use redis::aio::ConnectionManager;
use crate::engine::cache::normalize_symbol;
use crate::models::OrderCommand;
use tracing::{warn, debug};

pub struct Validator;

impl Validator {
    pub async fn validate_order(
        &self,
        conn: &mut ConnectionManager,
        cmd: &OrderCommand,
    ) -> Result<()> {
        // Validate symbol is enabled (normalize so lookup matches regardless of case)
        let symbol = normalize_symbol(&cmd.symbol);
        let symbol_status_key = format!("symbol:status:{}", symbol);
        let symbol_status: Option<String> = {
            use redis::AsyncCommands;
            conn.get(&symbol_status_key).await?
        };
        
        // If status key exists, check if it's enabled
        if let Some(status) = symbol_status {
            if status != "enabled" {
                return Err(anyhow::anyhow!("Symbol {} is not enabled", symbol));
            }
        } else {
            // Also check legacy format: symbol:SYMBOL (for backward compatibility)
            let symbol_key = format!("symbol:{}", symbol);
            let symbol_json: Option<String> = {
                use redis::AsyncCommands;
                conn.get(&symbol_key).await?
            };
            
            if symbol_json.is_none() {
                // Default to enabled if no status found (for backward compatibility)
                // In production, you might want to reject instead
                warn!("Symbol {} status not found in Redis, defaulting to enabled", symbol);
            } else {
                let symbol_data: serde_json::Value = serde_json::from_str(&symbol_json.unwrap())?;
                if !symbol_data.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true) {
                    return Err(anyhow::anyhow!("Symbol {} is not enabled", symbol));
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
            let free_margin: Decimal = balance
                .get("free_margin")
                .and_then(|v| v.as_str())
                .and_then(|s| Decimal::from_str_exact(s).ok())
                .or_else(|| {
                    balance
                        .get("available")
                        .and_then(|v| v.as_str())
                        .and_then(|s| Decimal::from_str_exact(s).ok())
                })
                .unwrap_or(Decimal::ZERO);

            let available: Decimal = balance
                .get("available")
                .and_then(|v| v.as_str())
                .and_then(|s| Decimal::from_str_exact(s).ok())
                .unwrap_or(Decimal::ZERO);

            let fill_price = match cmd.order_type {
                contracts::enums::OrderType::Limit => cmd.limit_price,
                contracts::enums::OrderType::Market => cmd.market_price_hint,
            };

            if let Some(price) = fill_price {
                let notional = cmd.size * price;
                let Some(eff) = crate::leverage::effective_leverage(
                    notional,
                    cmd.min_leverage,
                    cmd.max_leverage,
                    cmd.leverage_tiers.as_deref(),
                ) else {
                    return Err(anyhow::anyhow!(
                        "Leverage could not be resolved: require user min/max, symbol tiers, and a matching notional band"
                    ));
                };
                if eff <= Decimal::ZERO {
                    return Err(anyhow::anyhow!("Invalid effective leverage"));
                }
                let required_margin = notional / eff;
                if free_margin < required_margin && available < required_margin {
                    return Err(anyhow::anyhow!("Insufficient balance"));
                }
            }
        }
        
        debug!("Order validation passed for user {} symbol {}", cmd.user_id, cmd.symbol);
        Ok(())
    }
}

