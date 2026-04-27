use crate::ws::protocol::ClientMessage;
use crate::config::LimitsConfig;
use anyhow::Result;

/// Canonical symbol key used for WS subscriptions.
/// Accept common separators from clients (`EUR/USD`, `EUR-USD`, `EUR_USD`, `EUR.USD`) and
/// normalize to the registry/tick key format (`EURUSD`).
pub fn normalize_subscription_symbol(raw: &str) -> Option<String> {
    let normalized: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

pub struct MessageValidator {
    limits: LimitsConfig,
}

impl MessageValidator {
    pub fn new(limits: LimitsConfig) -> Self {
        Self { limits }
    }

    pub fn validate_message(&self, message: &ClientMessage) -> Result<()> {
        match message {
            ClientMessage::Subscribe { symbols, channels } => {
                if symbols.len() > self.limits.max_symbols_per_client {
                    return Err(anyhow::anyhow!(
                        "Too many symbols: {} (max: {})",
                        symbols.len(),
                        self.limits.max_symbols_per_client
                    ));
                }

                if symbols.is_empty() {
                    return Err(anyhow::anyhow!("Symbols list cannot be empty"));
                }

                // Empty channels = subscribe to price ticks only (frontend price stream)
                if !channels.is_empty() {
                    let valid_channels = ["tick", "positions", "orders", "risk"];
                    for channel in channels {
                        if !valid_channels.contains(&channel.as_str()) {
                            return Err(anyhow::anyhow!("Invalid channel: {}", channel));
                        }
                    }
                }

                // Validate symbol format after canonicalization so clients may send common separators.
                for symbol in symbols {
                    let Some(normalized) = normalize_subscription_symbol(symbol) else {
                        return Err(anyhow::anyhow!("Invalid symbol format: {}", symbol));
                    };
                    if normalized.len() > 20 {
                        return Err(anyhow::anyhow!("Invalid symbol format: {}", symbol));
                    }
                }
            }
            ClientMessage::Unsubscribe { symbols } => {
                if symbols.len() > self.limits.max_symbols_per_client {
                    return Err(anyhow::anyhow!(
                        "Too many symbols: {} (max: {})",
                        symbols.len(),
                        self.limits.max_symbols_per_client
                    ));
                }
            }
            ClientMessage::Auth { token } => {
                if token.is_empty() {
                    return Err(anyhow::anyhow!("Token cannot be empty"));
                }
                if token.len() > 2048 {
                    return Err(anyhow::anyhow!("Token too long"));
                }
            }
            ClientMessage::Ping => {
                // No validation needed
            }
            ClientMessage::CallInitiate { target_user_id, .. } => {
                if target_user_id.is_empty() {
                    return Err(anyhow::anyhow!("target_user_id cannot be empty"));
                }
                if target_user_id.len() > 128 {
                    return Err(anyhow::anyhow!("target_user_id too long"));
                }
            }
            ClientMessage::CallAnswer { call_id }
            | ClientMessage::CallReject { call_id }
            | ClientMessage::CallEnd { call_id } => {
                if call_id.is_empty() {
                    return Err(anyhow::anyhow!("call_id cannot be empty"));
                }
                if uuid::Uuid::parse_str(call_id).is_err() {
                    return Err(anyhow::anyhow!("call_id must be a valid UUID"));
                }
            }
            ClientMessage::CallWebrtcOffer { call_id, sdp } => {
                if call_id.is_empty() || uuid::Uuid::parse_str(call_id).is_err() {
                    return Err(anyhow::anyhow!("call_id must be a valid UUID"));
                }
                if sdp.is_empty() || sdp.len() > 16384 {
                    return Err(anyhow::anyhow!("sdp must be 1-16384 bytes"));
                }
            }
            ClientMessage::CallWebrtcAnswer { call_id, sdp } => {
                if call_id.is_empty() || uuid::Uuid::parse_str(call_id).is_err() {
                    return Err(anyhow::anyhow!("call_id must be a valid UUID"));
                }
                if sdp.is_empty() || sdp.len() > 16384 {
                    return Err(anyhow::anyhow!("sdp must be 1-16384 bytes"));
                }
            }
            ClientMessage::CallWebrtcIce { call_id, candidate } => {
                if call_id.is_empty() || uuid::Uuid::parse_str(call_id).is_err() {
                    return Err(anyhow::anyhow!("call_id must be a valid UUID"));
                }
                if candidate.len() > 2048 {
                    return Err(anyhow::anyhow!("candidate too long"));
                }
            }
        }

        Ok(())
    }

    pub fn validate_message_size(&self, size: usize) -> Result<()> {
        if size > self.limits.max_message_size_bytes {
            return Err(anyhow::anyhow!(
                "Message too large: {} bytes (max: {})",
                size,
                self.limits.max_message_size_bytes
            ));
        }
        Ok(())
    }
}

