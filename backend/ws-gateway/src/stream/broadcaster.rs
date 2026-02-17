use crate::state::connection_registry::ConnectionRegistry;
use crate::ws::protocol::ServerMessage;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;
use tracing::{debug, error, info, warn};
use dashmap::DashMap;

pub struct Broadcaster {
    registry: Arc<ConnectionRegistry>,
    connection_txs: Arc<DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>>,
}

impl Broadcaster {
    pub fn new(
        registry: Arc<ConnectionRegistry>,
        mut message_rx: mpsc::Receiver<(String, serde_json::Value)>,
    ) -> Self {
        let connection_txs = Arc::new(DashMap::new());
        let registry_clone = registry.clone();
        let connection_txs_clone = connection_txs.clone();
        
        // Spawn the broadcaster task
        tokio::spawn(async move {
            info!("Broadcaster started");
            while let Some((channel, payload)) = message_rx.recv().await {
                match Self::handle_message(&registry_clone, &connection_txs_clone, channel, payload).await {
                    Ok(_) => {}
                    Err(e) => {
                        error!("Error broadcasting message: {}", e);
                    }
                }
            }
        });

        Self {
            registry,
            connection_txs,
        }
    }

    pub fn register_connection(&self, conn_id: Uuid, tx: mpsc::UnboundedSender<ServerMessage>) {
        self.connection_txs.insert(conn_id, tx);
    }

    pub fn unregister_connection(&self, conn_id: Uuid) {
        self.connection_txs.remove(&conn_id);
    }

    async fn handle_message(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        channel: String,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        match channel.as_str() {
            "price:ticks" => {
                Self::broadcast_tick(registry, connection_txs, payload).await?;
            }
            "orders:updates" => {
                Self::broadcast_order_update(registry, connection_txs, payload).await?;
            }
            "positions:updates" => {
                Self::broadcast_position_update(registry, connection_txs, payload).await?;
            }
            "risk:alerts" => {
                Self::broadcast_risk_alert(registry, connection_txs, payload).await?;
            }
            "deposits:requests" => {
                Self::broadcast_deposit_request(registry, connection_txs, payload).await?;
            }
            "deposits:approved" => {
                Self::broadcast_deposit_approved(registry, connection_txs, payload).await?;
            }
            "notifications:push" => {
                Self::broadcast_notification(registry, connection_txs, payload).await?;
            }
            "wallet:balance:updated" => {
                Self::broadcast_wallet_balance(registry, connection_txs, payload).await?;
            }
            _ => {
                warn!("Unknown channel: {}", channel);
            }
        }
        Ok(())
    }

    async fn broadcast_tick(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let symbol = payload
            .get("symbol")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing symbol in tick"))?;

        let ts = payload
            .get("ts")
            .or_else(|| payload.get("timestamp"))
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        // Per-group format: { symbol, ts, prices: [ { g, bid, ask }, ... ] }
        let prices_array = payload.get("prices").and_then(|v| v.as_array());

        let mut subscriber_ids: Vec<Uuid> = registry.get_symbol_subscribers(symbol).into_iter().collect();
        if symbol.ends_with("USDT") {
            let symbol_usd = format!("{}USD", symbol.trim_end_matches("USDT"));
            for id in registry.get_symbol_subscribers(&symbol_usd) {
                if !subscriber_ids.contains(&id) {
                    subscriber_ids.push(id);
                }
            }
        }

        let mut sent = 0;
        let mut failed = 0;

        /// Normalize group id for comparison (lowercase, no dashes) so UUID format always matches.
        fn normalize_group_id(s: &str) -> String {
            s.trim().to_lowercase().replace('-', "")
        }

        if let Some(prices) = prices_array {
            for conn_id in subscriber_ids {
                let conn = registry.get(&conn_id);
                let (bid, ask) = if let Some(conn) = conn {
                    let group_id_normalized = conn.group_id.as_deref().map(normalize_group_id);
                    let found = group_id_normalized.as_ref().and_then(|gid_norm| {
                        prices.iter().find(|p| {
                            p.get("g")
                                .and_then(|v| v.as_str())
                                .map(normalize_group_id)
                                .as_ref()
                                == Some(gid_norm)
                        })
                    });
                    match found {
                        Some(p) => (
                            p.get("bid").and_then(|v| v.as_str()).map(|s| s.to_string())
                                .or_else(|| p.get("bid").and_then(|v| v.as_f64()).map(|f| f.to_string())),
                            p.get("ask").and_then(|v| v.as_str()).map(|s| s.to_string())
                                .or_else(|| p.get("ask").and_then(|v| v.as_f64()).map(|f| f.to_string())),
                        ),
                        None => {
                            let first = prices.first();
                            (
                                first.and_then(|p| p.get("bid").and_then(|v| v.as_str()).map(|s| s.to_string()))
                                    .or_else(|| first.and_then(|p| p.get("bid").and_then(|v| v.as_f64()).map(|f| f.to_string()))),
                                first.and_then(|p| p.get("ask").and_then(|v| v.as_str()).map(|s| s.to_string()))
                                    .or_else(|| first.and_then(|p| p.get("ask").and_then(|v| v.as_f64()).map(|f| f.to_string()))),
                            )
                        }
                    }
                } else {
                    (None, None)
                };
                if let (Some(bid), Some(ask)) = (bid, ask) {
                    let message = ServerMessage::Tick {
                        symbol: symbol.to_string(),
                        bid,
                        ask,
                        ts,
                    };
                    if let Some(tx) = connection_txs.get(&conn_id) {
                        if tx.send(message).is_ok() {
                            sent += 1;
                        } else {
                            failed += 1;
                            connection_txs.remove(&conn_id);
                            registry.unregister(conn_id);
                        }
                    }
                }
            }
        } else {
            // Legacy single bid/ask format
            let bid = payload
                .get("bid")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| payload.get("bid").and_then(|v| v.as_f64()).map(|f| f.to_string()))
                .ok_or_else(|| anyhow::anyhow!("Missing bid in tick"))?;
            let ask = payload
                .get("ask")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| payload.get("ask").and_then(|v| v.as_f64()).map(|f| f.to_string()))
                .ok_or_else(|| anyhow::anyhow!("Missing ask in tick"))?;
            let message = ServerMessage::Tick {
                symbol: symbol.to_string(),
                bid,
                ask,
                ts,
            };
            for conn_id in subscriber_ids {
                if let Some(tx) = connection_txs.get(&conn_id) {
                    if tx.send(message.clone()).is_ok() {
                        sent += 1;
                    } else {
                        failed += 1;
                        connection_txs.remove(&conn_id);
                        registry.unregister(conn_id);
                    }
                }
            }
        }

        if sent > 0 {
            debug!("📡 Broadcast tick {} to {} connections ({} failed)", symbol, sent, failed);
        } else {
            debug!("⚠️ No subscribers for tick {}", symbol);
        }

        Ok(())
    }

    async fn broadcast_order_update(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let user_id = payload
            .get("user_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing user_id in order update"))?;

        let order_id = payload
            .get("order_id")
            .or_else(|| payload.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("Missing order_id"))?;

        let status = payload
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let symbol = payload
            .get("symbol")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let side = payload
            .get("side")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let quantity = payload
            .get("quantity")
            .or_else(|| payload.get("volume"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| payload.get("quantity").and_then(|v| v.as_f64()).map(|f| f.to_string()))
            .unwrap_or_default();

        let price = payload
            .get("price")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| payload.get("price").and_then(|v| v.as_f64()).map(|f| f.to_string()));

        let ts = payload
            .get("ts")
            .or_else(|| payload.get("timestamp"))
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        let message = ServerMessage::OrderUpdate {
            order_id,
            status,
            symbol,
            side,
            quantity,
            price,
            ts,
        };

        // Send to all user connections
        let connections = registry.get_user_connections(user_id);
        for conn_id in connections {
            if let Some(tx) = connection_txs.get(&conn_id) {
                let _ = tx.send(message.clone());
            }
        }

        Ok(())
    }

    async fn broadcast_position_update(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let user_id = payload
            .get("user_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing user_id in position update"))?;

        let position_id = payload
            .get("position_id")
            .or_else(|| payload.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("Missing position_id"))?;

        let symbol = payload
            .get("symbol")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let side = payload
            .get("side")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let quantity = payload
            .get("quantity")
            .or_else(|| payload.get("volume"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| payload.get("quantity").and_then(|v| v.as_f64()).map(|f| f.to_string()))
            .unwrap_or_default();

        let unrealized_pnl = payload
            .get("unrealized_pnl")
            .or_else(|| payload.get("pnl"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| payload.get("unrealized_pnl").and_then(|v| v.as_f64()).map(|f| f.to_string()))
            .unwrap_or_default();

        let trigger_reason = payload
            .get("trigger_reason")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Extract status - default to "OPEN" if not provided (for new positions)
        let status = payload
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "OPEN".to_string());

        let ts = payload
            .get("ts")
            .or_else(|| payload.get("timestamp"))
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        let message = ServerMessage::PositionUpdate {
            position_id,
            symbol,
            side,
            quantity,
            unrealized_pnl,
            status,
            ts,
            trigger_reason,
        };

        // Send to all user connections
        let connections = registry.get_user_connections(user_id);
        for conn_id in connections {
            if let Some(tx) = connection_txs.get(&conn_id) {
                let _ = tx.send(message.clone());
            }
        }

        Ok(())
    }

    async fn broadcast_risk_alert(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let user_id = payload
            .get("user_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing user_id in risk alert"))?;

        let alert_type = payload
            .get("alert_type")
            .or_else(|| payload.get("type"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let message_text = payload
            .get("message")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let severity = payload
            .get("severity")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "warning".to_string());

        let ts = payload
            .get("ts")
            .or_else(|| payload.get("timestamp"))
            .and_then(|v| v.as_i64())
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

        let message = ServerMessage::RiskAlert {
            alert_type,
            message: message_text,
            severity,
            ts,
        };

        // Send to all user connections
        let connections = registry.get_user_connections(user_id);
        for conn_id in connections {
            if let Some(tx) = connection_txs.get(&conn_id) {
                let _ = tx.send(message.clone());
            }
        }

        Ok(())
    }

    async fn broadcast_deposit_request(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        // Create message in format frontend expects: { type: "deposit.request.created", payload: {...} }
        let message = ServerMessage::DepositRequestCreated {
            payload: payload.clone(),
        };

        // Broadcast to all connections (admin should receive this)
        // In production, filter by user role from registry
        for entry in connection_txs.iter() {
            let _ = entry.value().send(message.clone());
        }

        Ok(())
    }

    async fn broadcast_deposit_approved(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let user_id = payload
            .get("userId")
            .or_else(|| payload.get("user_id"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing userId in deposit approved"))?;

        let message = ServerMessage::DepositRequestApproved {
            payload: payload.clone(),
        };

        // Send to the user who made the deposit
        let connections = registry.get_user_connections(user_id);
        for conn_id in connections {
            if let Some(tx) = connection_txs.get(&conn_id) {
                let _ = tx.send(message.clone());
            }
        }

        // Also send to all admins (they should see the approval)
        // For now, broadcast to all - in production filter by role
        for entry in connection_txs.iter() {
            let _ = entry.value().send(message.clone());
        }

        Ok(())
    }

    async fn broadcast_notification(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        // Extract user_id from payload if available, otherwise broadcast to all
        let user_id_opt = payload
            .get("userId")
            .or_else(|| payload.get("user_id"))
            .and_then(|v| v.as_str());

        let message = ServerMessage::NotificationPush {
            payload: payload.clone(),
        };

        if let Some(user_id) = user_id_opt {
            // Send to specific user
            let connections = registry.get_user_connections(user_id);
            for conn_id in connections {
                if let Some(tx) = connection_txs.get(&conn_id) {
                    let _ = tx.send(message.clone());
                }
            }
        } else {
            // Broadcast to all (for admin notifications)
            for entry in connection_txs.iter() {
                let _ = entry.value().send(message.clone());
            }
        }

        Ok(())
    }

    async fn broadcast_wallet_balance(
        registry: &ConnectionRegistry,
        connection_txs: &DashMap<Uuid, mpsc::UnboundedSender<ServerMessage>>,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        let user_id = payload
            .get("userId")
            .or_else(|| payload.get("user_id"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing userId in wallet balance"))?;

        info!("📡 Broadcasting wallet.balance.updated for user_id={}, payload={:?}", user_id, payload);

        let message = ServerMessage::WalletBalanceUpdated {
            payload: payload.clone(),
        };

        // Send to the user
        let connections = registry.get_user_connections(user_id);
        let connection_count = connections.len();
        
        if connection_count == 0 {
            warn!("⚠️ No WebSocket connections found for user_id={}", user_id);
        } else {
            info!("📤 Sending wallet.balance.updated to {} connection(s) for user_id={}", connection_count, user_id);
        }

        for conn_id in connections {
            if let Some(tx) = connection_txs.get(&conn_id) {
                if let Err(e) = tx.send(message.clone()) {
                    warn!("Failed to send wallet.balance.updated to connection {}: {}", conn_id, e);
                } else {
                    info!("✅ Sent wallet.balance.updated to connection {}", conn_id);
                }
            }
        }

        Ok(())
    }
}

