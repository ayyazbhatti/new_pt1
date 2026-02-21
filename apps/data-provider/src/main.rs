use axum::{extract::State, response::Json, routing::get, Router};
use chrono::Utc;
use serde::Serialize;
use contracts::{TickEvent, VersionedMessage};
use rust_decimal::Decimal;
use rust_decimal::prelude::FromStr;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};
use tower_http::cors::CorsLayer;
use tracing::{info, error, warn};
use redis::AsyncCommands;

mod health;

#[derive(Clone)]
struct AppState {
    nats_client: async_nats::Client,
    last_ticks: Arc<RwLock<HashMap<String, TickEvent>>>,
}

/// Optional Redis client for publishing to price:ticks (so ws-gateway can forward to frontend).
fn redis_client() -> Option<Arc<redis::Client>> {
    let url = std::env::var("REDIS_URL").ok()?;
    redis::Client::open(url).ok().map(Arc::new)
}

// Binance ticker response
#[derive(Debug, Deserialize)]
struct BinanceTicker {
    symbol: String,
    #[serde(rename = "bidPrice")]
    bid_price: String,
    #[serde(rename = "askPrice")]
    ask_price: String,
}

/// Response for GET /ticks - last bid/ask per symbol
#[derive(Serialize)]
struct TicksResponse {
    ticks: std::collections::HashMap<String, contracts::TickEvent>,
}

async fn get_ticks(State(state): State<AppState>) -> Json<serde_json::Value> {
    let ticks = state.last_ticks.read().await;
    let map: std::collections::HashMap<String, _> = ticks
        .iter()
        .map(|(k, v)| (k.clone(), serde_json::to_value(v).unwrap_or(serde_json::Value::Null)))
        .collect();
    Json(serde_json::json!({ "ticks": map }))
}

// Symbol mapping: our symbol -> Binance symbol
fn get_binance_symbol(symbol: &str) -> &str {
    match symbol {
        "BTCUSD" => "BTCUSDT",
        "ETHUSD" => "ETHUSDT",
        "SOLUSD" => "SOLUSDT",
        "ADAUSD" => "ADAUSDT",
        "DOGEUSD" => "DOGEUSDT",
        "XRPUSD" => "XRPUSDT",
        "DOTUSD" => "DOTUSDT",
        "MATICUSD" => "MATICUSDT",
        "AVAXUSD" => "AVAXUSDT",
        "LINKUSD" => "LINKUSDT",
        "UNIUSD" => "UNIUSDT",
        "ATOMUSD" => "ATOMUSDT",
        _ => symbol,
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("data-provider=info,tower_http=info")
        .json()
        .init();

    let config = common::config::AppConfig::from_env()
        .map_err(|e| format!("Config error: {}", e))?;

    info!("Connecting to NATS at {}", config.nats_url);
    let nats_client = async_nats::connect(&config.nats_url).await?;
    info!("Connected to NATS");

    let last_ticks = Arc::new(RwLock::new(HashMap::new()));
    let state = AppState {
        nats_client: nats_client.clone(),
        last_ticks: last_ticks.clone(),
    };

    // Start real price fetching for all symbols
    let symbols = vec![
        "BTCUSD", "ETHUSD", "SOLUSD", "ADAUSD", "DOGEUSD",
        "XRPUSD", "DOTUSD", "MATICUSD", "AVAXUSD", "LINKUSD",
        "UNIUSD", "ATOMUSD",
    ];
    let redis = redis_client();
    if redis.is_some() {
        info!("Redis configured: will publish to price:ticks for ws-gateway");
    }
    for symbol in symbols {
        let nats = nats_client.clone();
        let ticks = last_ticks.clone();
        let redis = redis.clone();
        tokio::spawn(fetch_real_ticks(symbol.to_string(), nats, ticks, redis));
    }

    // Start HTTP server
    let app = Router::new()
        .route("/health", get(health::health))
        .route("/ticks", get(get_ticks))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    info!("Data provider HTTP server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn fetch_real_ticks(
    symbol: String,
    nats: async_nats::Client,
    last_ticks: Arc<RwLock<HashMap<String, TickEvent>>>,
    redis: Option<Arc<redis::Client>>,
) {
    let mut interval = interval(Duration::from_millis(500)); // Fetch every 500ms (2 times per second)
    let mut seq = 0u64;
    let binance_symbol = get_binance_symbol(&symbol);
    let client = reqwest::Client::new();
    let url = format!("https://api.binance.com/api/v3/ticker/bookTicker?symbol={}", binance_symbol);

    info!("Starting real price fetcher for {} (Binance: {})", symbol, binance_symbol);

    loop {
        interval.tick().await;
        seq += 1;

        // Fetch real price from Binance
        match client.get(&url).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<BinanceTicker>().await {
                        Ok(ticker) => {
                            // Parse bid and ask prices
                            match (Decimal::from_str_exact(&ticker.bid_price), Decimal::from_str_exact(&ticker.ask_price)) {
                                (Ok(bid), Ok(ask)) => {
                                    if bid > Decimal::ZERO && ask > bid {
                                        // Use Binance symbol format (BTCUSDT) instead of our format (BTCUSD)
                                        // This matches what frontend expects
                                        let tick = TickEvent {
                                            symbol: binance_symbol.to_string(),
                                            bid,
                                            ask,
                                            ts: Utc::now(),
                                            seq,
                                        };

                                        // Store in memory (use Binance symbol format to match frontend)
                                        {
                                            let mut ticks = last_ticks.write().await;
                                            ticks.insert(binance_symbol.to_string(), tick.clone());
                                        }

                                        // Publish to NATS (use Binance symbol format to match frontend)
                                        let subject = format!("ticks.{}", binance_symbol);
                                        if let Ok(msg) = VersionedMessage::new("tick", &tick) {
                                            if let Ok(payload) = serde_json::to_vec(&msg) {
                                                if let Err(e) = nats.publish(subject.clone(), payload.into()).await {
                                                    error!("Failed to publish tick for {}: {}", symbol, e);
                                                } else {
                                                    info!("Published real tick for {}: bid={}, ask={}", symbol, bid, ask);
                                                }
                                            }
                                        }

                                        // Publish to Redis price:ticks so ws-gateway can forward to frontend (left sidebar live prices)
                                        if let Some(rd) = &redis {
                                            let ts_ms = tick.ts.timestamp_millis();
                                            let payload = serde_json::json!({
                                                "symbol": binance_symbol,
                                                "bid": tick.bid.to_string(),
                                                "ask": tick.ask.to_string(),
                                                "ts": ts_ms,
                                            });
                                            if let Ok(json) = serde_json::to_string(&payload) {
                                                if let Ok(mut conn) = rd.get_async_connection().await {
                                                    let _: Result<(), _> = conn.publish("price:ticks", &json).await;
                                                }
                                            }
                                        }
                                    } else {
                                        warn!("Invalid prices from Binance for {}: bid={}, ask={}", symbol, ticker.bid_price, ticker.ask_price);
                                    }
                                }
                                (Err(e), _) | (_, Err(e)) => {
                                    warn!("Failed to parse prices for {}: {}", symbol, e);
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to parse Binance response for {}: {}", symbol, e);
                        }
                    }
                } else {
                    warn!("Binance API returned error for {}: status {}", symbol, response.status());
                }
            }
            Err(e) => {
                error!("Failed to fetch price from Binance for {}: {}", symbol, e);
            }
        }
    }
}

