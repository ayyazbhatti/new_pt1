//! Connect to a Binance-style multiplex WebSocket base URL and verify we can subscribe and read a ticker.

use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio_tungstenite::{
    connect_async,
    tungstenite::Message,
};

const DEFAULT_BINANCE_WS: &str = "wss://stream.binance.com:9443/ws";

/// Match data-provider `normalize_multiplex_url` so the test uses the same effective URL.
pub fn normalize_multiplex_url(raw: &str) -> String {
    let r = raw.trim();
    if let Some(i) = r.find("/ws") {
        let after = &r[i + 3..];
        if after.starts_with('/') && after.len() > 1 {
            return r[..i + 3].to_string();
        }
    }
    r.to_string()
}

fn resolve_url(user_url: Option<&str>) -> String {
    let trimmed = user_url.map(str::trim).filter(|s| !s.is_empty());
    match trimmed {
        Some(s) => s.to_string(),
        None => std::env::var("BINANCE_WS_URL").unwrap_or_else(|_| DEFAULT_BINANCE_WS.to_string()),
    }
}

/// Returns human-readable success detail, or error string.
pub async fn test_binance_multiplex_ws(user_url: Option<&str>) -> Result<String, String> {
    let raw = resolve_url(user_url);
    let url = normalize_multiplex_url(&raw);
    if !url.starts_with("ws://") && !url.starts_with("wss://") {
        return Err("URL must start with ws:// or wss://".into());
    }

    tokio::time::timeout(Duration::from_secs(15), run_probe(url))
        .await
        .map_err(|_| "Timed out (15s)".to_string())?
}

async fn run_probe(url: String) -> Result<String, String> {
    let (ws, _) = connect_async(url.as_str())
        .await
        .map_err(|e| format!("WebSocket connect failed: {}", e))?;
    let (mut write, mut read) = ws.split();

    let sub = serde_json::json!({
        "method": "SUBSCRIBE",
        "params": ["btcusdt@bookTicker"],
        "id": 1
    });
    write
        .send(Message::Text(sub.to_string().into()))
        .await
        .map_err(|e| format!("Failed to send SUBSCRIBE: {}", e))?;

    let wait = Duration::from_secs(10);
    let deadline = tokio::time::Instant::now() + wait;

    while tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let msg = tokio::time::timeout(remaining, read.next())
            .await
            .map_err(|_| "Timed out waiting for messages".to_string())?;

        let msg = match msg {
            Some(Ok(m)) => m,
            Some(Err(e)) => return Err(format!("WebSocket read error: {}", e)),
            None => return Err("Connection closed before any response".into()),
        };

        if let Message::Text(t) = msg {
            let s = t.to_string();
            if s.contains("bookTicker") {
                return Ok(format!(
                    "Connected to {} and received a bookTicker payload (BTCUSDT).",
                    url
                ));
            }
            if s.contains("\"result\":null") && s.contains("\"id\"") {
                // SUBSCRIBE ack — keep waiting for ticker
                continue;
            }
            if s.to_lowercase().contains("\"code\":") && s.to_lowercase().contains("error") {
                let short: String = s.chars().take(280).collect();
                return Err(format!("Exchange error response: {}", short));
            }
        }
    }

    Err(
        "Connected and subscribed, but no bookTicker message was received within 10s. Check the URL is a Binance multiplex /ws endpoint."
            .into(),
    )
}
