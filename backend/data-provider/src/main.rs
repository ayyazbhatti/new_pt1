mod cache;
mod catalog;
mod config;
mod feeds;
mod health;
mod pricing;
mod stream;
mod validation;

use crate::cache::redis_client::RedisClient;
use crate::config::Config;
use contracts::DataProvidersConfig;
use crate::feeds::binance_feed::BinanceFeed;
use crate::feeds::feed_router::FeedRouter;
use crate::feeds::mmdps_feed::MmdpsFeed;
use crate::pricing::markup_engine::MarkupEngine;
use crate::stream::broadcaster::Broadcaster;
use crate::health::health_routes::create_health_router;
use crate::validation::symbol_validation::{RateLimiter, SymbolValidator};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{debug, error, info, warn};
use tracing_subscriber;

use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load env
    dotenv::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "data_provider=debug,tower_http=debug".into()),
        )
        .init();

    let mut config = Config::from_env()?;

    // Initialize Redis (needed before merge so we can read admin integrations mirror)
    let redis = Arc::new(RedisClient::new(&config.redis_url).await?);
    if let Ok(Some(json)) = redis.get_admin_integrations_json().await {
        match serde_json::from_str::<DataProvidersConfig>(&json) {
            Ok(admin_cfg) => {
                config.merge_data_providers_admin(&admin_cfg);
                info!("Applied data provider integrations from Redis (admin settings)");
            }
            Err(e) => warn!("Could not parse admin integrations JSON from Redis: {}", e),
        }
    }

    let start_time = SystemTime::now();

    info!("🚀 Starting Data Provider Server");
    info!("   Region: {}", config.server_region);
    info!("   WS Port: {}", config.ws_port);
    info!("   HTTP Port: {}", config.http_port);
    info!("   FEED_PROVIDER (label): {}", config.feed_provider);

    let redis_for_pubsub = redis.clone();

    // Connect to NATS for order-engine
    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".to_string());
    let nats = match async_nats::connect(&nats_url).await {
        Ok(client) => {
            info!("✅ Connected to NATS at {}", nats_url);
            Some(Arc::new(client))
        }
        Err(e) => {
            warn!("⚠️  Failed to connect to NATS: {}. Tick publishing to order-engine will be disabled.", e);
            None
        }
    };
    let nats_for_ticks = nats.clone();

    // Initialize components
    let binance_feed = Arc::new(BinanceFeed::new(config.binance_ws_url.clone()));

    let mmdps_feed = if config.mmdps_api_key.is_some() {
        if let Some(ws_url) = config.mmdps_ws_connect_url() {
            info!(
                "MMDPS feed enabled (auto_route={}, explicit_symbols={})",
                config.mmdps_auto_route,
                config.mmdps_symbols.len()
            );
            Some(Arc::new(MmdpsFeed::new(ws_url)))
        } else {
            warn!("MMDPS_API_KEY missing — MMDPS disabled");
            None
        }
    } else {
        None
    };

    let feed = Arc::new(FeedRouter::new(
        binance_feed,
        mmdps_feed,
        config.mmdps_auto_route,
        config.mmdps_symbols.clone(),
    ));
    let markup_engine = MarkupEngine::new(redis.clone());
    let broadcaster = Arc::new(Broadcaster::new(markup_engine));
    let validator = Arc::new(SymbolValidator::new(100));
    let rate_limiter = Arc::new(RateLimiter::new(60, 100));

    // Track subscribed symbols dynamically
    let subscribed_symbols: Arc<tokio::sync::RwLock<std::collections::HashSet<String>>> = 
        Arc::new(tokio::sync::RwLock::new(std::collections::HashSet::new()));

    // Per-group price stream: group_ids that receive ticks (from Redis price:groups)
    let price_groups: Arc<RwLock<HashSet<String>>> = Arc::new(RwLock::new(HashSet::new()));
    if let Ok(ids) = redis.smembers_price_groups().await {
        let mut g = price_groups.write().await;
        *g = ids.into_iter().collect();
        info!("✅ Loaded {} price groups from Redis", g.len());
    }
    // If no groups at startup (e.g. auth-service not ready yet), retry with backoff so we pick up bootstrap
    let price_groups_startup = price_groups.clone();
    let redis_startup = redis.clone();
    tokio::spawn(async move {
        let mut delay_secs = 2u64;
        for _ in 0..5 {
            let n = price_groups_startup.read().await.len();
            if n > 0 {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
            if let Ok(ids) = redis_startup.smembers_price_groups().await {
                let mut g = price_groups_startup.write().await;
                *g = ids.into_iter().collect();
                if !g.is_empty() {
                    tracing::info!("✅ Loaded {} price groups from Redis (startup retry)", g.len());
                    break;
                }
            }
            delay_secs = (delay_secs + 3).min(15);
        }
    });
    // Periodic refresh: ensure we always have latest price:groups (survives Redis restart, auth bootstrap order)
    const PRICE_GROUPS_REFRESH_INTERVAL_SECS: u64 = 30;
    let price_groups_periodic = price_groups.clone();
    let redis_periodic = redis.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(PRICE_GROUPS_REFRESH_INTERVAL_SECS));
        interval.tick().await; // first tick completes immediately, skip so we don't double-read at startup
        loop {
            interval.tick().await;
            if let Ok(ids) = redis_periodic.smembers_price_groups().await {
                let mut g = price_groups_periodic.write().await;
                let new_set: HashSet<String> = ids.into_iter().collect();
                let changed = *g != new_set;
                *g = new_set;
                if changed {
                    tracing::debug!("Refreshed price groups from Redis: {} groups", g.len());
                }
            }
        }
    });
    let price_groups_for_markup = price_groups.clone();
    let redis_for_markup = redis.clone();
    tokio::spawn(async move {
        use futures_util::StreamExt;
        let client = redis_for_markup.get_client();
        while let Ok(conn) = client.get_async_connection().await {
            let mut pubsub = conn.into_pubsub();
            if pubsub.subscribe("markup:update").await.is_ok() {
                let mut stream = pubsub.into_on_message();
                while let Some(_msg) = stream.next().await {
                    if let Ok(ids) = redis_for_markup.smembers_price_groups().await {
                        let mut g = price_groups_for_markup.write().await;
                        *g = ids.into_iter().collect();
                        tracing::debug!("Refreshed price groups from Redis (markup:update): {} groups", g.len());
                    }
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
    });

    // Subscribe to initial symbols: from INITIAL_SYMBOLS env (comma-separated) or default list of 100
    let initial_symbols: Vec<String> = match std::env::var("INITIAL_SYMBOLS") {
        Ok(s) if !s.trim().is_empty() => s
            .split(',')
            .map(|x| x.trim().to_uppercase())
            .filter(|x| !x.is_empty())
            .collect(),
        _ => vec![
            "BTCUSDT".into(), "ETHUSDT".into(), "BNBUSDT".into(), "SOLUSDT".into(), "XRPUSDT".into(),
            "DOGEUSDT".into(), "ADAUSDT".into(), "SHIBUSDT".into(), "TONUSDT".into(), "TRXUSDT".into(),
            "AVAXUSDT".into(), "DOTUSDT".into(), "LINKUSDT".into(), "MATICUSDT".into(), "LTCUSDT".into(),
            "BCHUSDT".into(), "XMRUSDT".into(), "EOSUSDT".into(), "KASUSDT".into(), "EGLDUSDT".into(),
            "UNIUSDT".into(), "ATOMUSDT".into(), "ETCUSDT".into(), "XLMUSDT".into(), "NEARUSDT".into(),
            "APTUSDT".into(),
            "FILUSDT".into(), "INJUSDT".into(), "OPUSDT".into(), "ARBUSDT".into(), "IMXUSDT".into(),
            "SUIUSDT".into(), "SEIUSDT".into(), "RENDERUSDT".into(), "PEPEUSDT".into(), "WIFUSDT".into(),
            "FLOKIUSDT".into(), "BONKUSDT".into(), "FETUSDT".into(), "RUNEUSDT".into(), "GRTUSDT".into(),
            "AAVEUSDT".into(), "ALGOUSDT".into(), "AXSUSDT".into(), "CRVUSDT".into(), "ENSUSDT".into(),
            "GMTUSDT".into(), "MANAUSDT".into(), "SANDUSDT".into(), "APEUSDT".into(), "LDOUSDT".into(),
            "MKRUSDT".into(), "SNXUSDT".into(), "STXUSDT".into(), "THETAUSDT".into(), "VETUSDT".into(),
            "BLURUSDT".into(), "COMPUSDT".into(), "DYDXUSDT".into(), "GALAUSDT".into(), "HBARUSDT".into(),
            "ICPUSDT".into(), "JASMYUSDT".into(), "KAVAUSDT".into(), "KSMUSDT".into(), "MANTAUSDT".into(),
            "ORDIUSDT".into(), "PENDLEUSDT".into(), "PYTHUSDT".into(), "QNTUSDT".into(), "RDNTUSDT".into(),
            "RPLUSDT".into(), "STRKUSDT".into(), "WLDUSDT".into(), "ZECUSDT".into(), "1INCHUSDT".into(),
            "1000PEPEUSDT".into(), "1000SATSUSDT".into(), "AGIXUSDT".into(), "ARKMUSDT".into(), "ASTRUSDT".into(),
            "BATUSDT".into(), "CELOUSDT".into(), "CFXUSDT".into(), "CHZUSDT".into(), "COTIUSDT".into(),
            "DASHUSDT".into(), "DEFIUSDT".into(), "ENJUSDT".into(), "FLOWUSDT".into(), "FTMUSDT".into(),
            "GASUSDT".into(), "HOTUSDT".into(), "ICXUSDT".into(), "KEYUSDT".into(), "KNCUSDT".into(),
            "LQTYUSDT".into(), "MAGICUSDT".into(), "MINAUSDT".into(), "NMRUSDT".into(), "OCEANUSDT".into(),
            "OMGUSDT".into(), "ONEUSDT".into(), "PHBUSDT".into(), "POLUSDT".into(), "PORTALUSDT".into(),
            "POWRUSDT".into(), "QTUMUSDT".into(), "RSRUSDT".into(), "SKLUSDT".into(), "SSVUSDT".into(),
            "STORJUSDT".into(), "TIAUSDT".into(), "TLMUSDT".into(), "TOKENUSDT".into(), "WOOUSDT".into(),
            "XAIUSDT".into(), "YFIUSDT".into(), "ZILUSDT".into(), "ZROUSDT".into(),
        ],
    };
    let mut bootstrap_symbols = initial_symbols.clone();
    for s in &config.mmdps_symbols {
        if !bootstrap_symbols.iter().any(|x| x == s) {
            bootstrap_symbols.push(s.clone());
        }
    }

    let catalog_pool = if let Some(ref db_url) = config.symbols_database_url {
        match PgPoolOptions::new()
            .max_connections(3)
            .connect(db_url)
            .await
        {
            Ok(pool) => {
                match catalog::symbol_catalog::fetch_mmdps_catalog_symbols(&pool).await {
                    Ok(mut extra) => {
                        extra.truncate(config.catalog_mmdps_max_symbols);
                        let added: usize = extra
                            .iter()
                            .filter(|s| !bootstrap_symbols.iter().any(|x| x == *s))
                            .count();
                        for s in extra {
                            if !bootstrap_symbols.iter().any(|x| x == &s) {
                                bootstrap_symbols.push(s);
                            }
                        }
                        info!(
                            "📚 Symbol catalog (Postgres): merged {} new MMDPS-routed symbols (total bootstrap: {})",
                            added,
                            bootstrap_symbols.len()
                        );
                    }
                    Err(e) => warn!(
                        "Symbol catalog query failed — continuing with env/bootstrap only: {}",
                        e
                    ),
                }
                Some(pool)
            }
            Err(e) => {
                warn!(
                    "SYMBOLS_DATABASE_URL / DATABASE_URL connect failed — catalog merge skipped: {}",
                    e
                );
                None
            }
        }
    } else {
        info!(
            "SYMBOLS_DATABASE_URL / DATABASE_URL not set — MMDPS catalog merge disabled (set to same Postgres as auth-service for automatic forex/equity upstream list)"
        );
        None
    };

    info!(
        "📊 Initial symbols ({}): {:?}",
        bootstrap_symbols.len(),
        bootstrap_symbols
    );
    for symbol in &bootstrap_symbols {
        feed.subscribe_symbol(symbol).await?;
        validator.enable_symbol(symbol.clone());
        subscribed_symbols.write().await.insert(symbol.clone());
    }

    if let Some(pool) = &catalog_pool {
        if config.symbol_catalog_refresh_secs > 0 {
            let pool = pool.clone();
            let feed_c = feed.clone();
            let subs_c = subscribed_symbols.clone();
            let validator_c = validator.clone();
            let secs = config.symbol_catalog_refresh_secs;
            let max = config.catalog_mmdps_max_symbols;
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(secs));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                interval.tick().await;
                loop {
                    interval.tick().await;
                    match catalog::symbol_catalog::fetch_mmdps_catalog_symbols(&pool).await {
                        Ok(mut list) => {
                            list.truncate(max);
                            for sym in list {
                                if subs_c.read().await.contains(&sym) {
                                    continue;
                                }
                                match feed_c.subscribe_symbol(&sym).await {
                                    Ok(()) => {
                                        subs_c.write().await.insert(sym.clone());
                                        validator_c.enable_symbol(sym);
                                    }
                                    Err(e) => {
                                        debug!("catalog refresh: upstream subscribe {} failed: {}", sym, e);
                                    }
                                }
                            }
                        }
                        Err(e) => warn!("symbol catalog refresh query failed: {}", e),
                    }
                }
            });
            info!(
                "📚 Symbol catalog refresh: every {}s (Postgres)",
                config.symbol_catalog_refresh_secs
            );
        }
    }

    // Price update loop — per-group: one Redis message with prices[], per-group NATS, per-group WS
    let feed_clone = feed.clone();
    let broadcaster_clone = broadcaster.clone();
    let markup_engine_clone = Arc::new(MarkupEngine::new(redis.clone()));
    let subscribed_symbols_clone = subscribed_symbols.clone();
    let nats_for_ticks_clone = nats_for_ticks.clone();
    let redis_for_pubsub_clone = redis_for_pubsub.clone();
    let price_groups_loop = price_groups.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            interval.tick().await;

            let symbols_to_broadcast: Vec<String> = {
                subscribed_symbols_clone.read().await.iter().cloned().collect()
            };
            let group_ids: Vec<String> = {
                price_groups_loop.read().await.iter().cloned().collect()
            };

            for symbol in &symbols_to_broadcast {
                if !subscribed_symbols_clone.read().await.contains(symbol) {
                    if let Err(e) = feed_clone.subscribe_symbol(symbol).await {
                        warn!("Failed to subscribe to symbol {}: {}", symbol, e);
                        continue;
                    }
                    subscribed_symbols_clone.write().await.insert(symbol.clone());
                    info!("📈 Subscribed to new symbol: {}", symbol);
                }

                if let Some(price_state) = feed_clone.get_price(symbol).await {
                    let mut prices_by_group: Vec<serde_json::Value> = Vec::new();
                    for group_id in &group_ids {
                        let (bid, ask) = match markup_engine_clone
                            .apply_markup(symbol, group_id, price_state.bid, price_state.ask)
                            .await
                        {
                            Some(p) => p,
                            None => (price_state.bid, price_state.ask),
                        };
                        prices_by_group.push(serde_json::json!({
                            "g": group_id,
                            "bid": bid.to_string(),
                            "ask": ask.to_string(),
                        }));
                        broadcaster_clone
                            .broadcast_price(symbol, Some(group_id.as_str()), bid, ask)
                            .await;
                    }
                    // When no groups in Redis, still send one entry so gateway can deliver ticks (uses "first" for all conns)
                    if prices_by_group.is_empty() {
                        prices_by_group.push(serde_json::json!({
                            "g": "",
                            "bid": price_state.bid.to_string(),
                            "ask": price_state.ask.to_string(),
                        }));
                    }
                    // Always broadcast to symbol-only room so WS clients without a group get live ticks
                    broadcaster_clone
                        .broadcast_price(symbol, None, price_state.bid, price_state.ask)
                        .await;

                    let ts = chrono::Utc::now().timestamp_millis();
                    let tick_json = serde_json::json!({
                        "symbol": symbol,
                        "ts": ts,
                        "prices": prices_by_group,
                    });
                    if let Err(e) = redis_for_pubsub_clone
                        .publish_price_update("price:ticks", &tick_json.to_string())
                        .await
                    {
                        warn!("Failed to publish price to Redis: {}", e);
                    } else {
                        debug!("✅ Published price tick to Redis for {} ({} groups)", symbol, prices_by_group.len());
                    }

                    if let Some(nats_client) = &nats_for_ticks_clone {
                        use contracts::{TickEvent, VersionedMessage};
                        use chrono::Utc;
                        if group_ids.is_empty() {
                            // No price groups: publish once per symbol so gateway-ws (ticks.>) can forward to frontend
                            let tick_event = TickEvent {
                                symbol: symbol.clone(),
                                bid: price_state.bid,
                                ask: price_state.ask,
                                ts: Utc::now(),
                                seq: ts as u64,
                            };
                            let subject = format!("ticks.{}", symbol);
                            if let Ok(msg) = VersionedMessage::new("tick", &tick_event) {
                                if let Ok(payload) = serde_json::to_vec(&msg) {
                                    let _ = nats_client.publish(subject.clone(), payload.into()).await;
                                }
                            }
                        } else {
                            for group_id in &group_ids {
                                let (bid, ask) = match markup_engine_clone
                                    .apply_markup(symbol, group_id, price_state.bid, price_state.ask)
                                    .await
                                {
                                    Some(p) => p,
                                    None => (price_state.bid, price_state.ask),
                                };
                                let tick_event = TickEvent {
                                    symbol: symbol.clone(),
                                    bid,
                                    ask,
                                    ts: Utc::now(),
                                    seq: ts as u64,
                                };
                                let subject = format!("ticks.{}.{}", symbol, group_id);
                                if let Ok(msg) = VersionedMessage::new("tick", &tick_event) {
                                    if let Ok(payload) = serde_json::to_vec(&msg) {
                                        let _ = nats_client.publish(subject.clone(), payload.into()).await;
                                    }
                                }
                            }
                        }
                    }
                } else {
                    debug!("⚠️  No price data available for {}", symbol);
                }
            }
        }
    });

    // Start WebSocket server
    let ws_addr = format!("0.0.0.0:{}", config.ws_port);
    info!("🚀 Preparing to start WebSocket server on {}", ws_addr);
    let broadcaster_ws = broadcaster.clone();
    let validator_ws = validator.clone();
    let rate_limiter_ws = rate_limiter.clone();

    let feed_ws = feed.clone();
    let ws_addr_clone = ws_addr.clone();
    info!("📡 Spawning WebSocket server task...");
    tokio::spawn(async move {
        info!("🚀 Starting WebSocket server on {}", ws_addr_clone);
        match crate::stream::ws_server::start_ws_server(
            &ws_addr,
            broadcaster_ws,
            validator_ws,
            rate_limiter_ws,
            Some(feed_ws),
            Some(subscribed_symbols.clone()),
        )
        .await
        {
            Ok(_) => {
                info!("✅ WebSocket server started successfully");
            }
            Err(e) => {
                error!("❌ WebSocket server error: {}", e);
                error!("Failed to start WebSocket server on {}", ws_addr);
            }
        }
    });
    info!("✅ WebSocket server task spawned");

    // Create health router
    let health_app = create_health_router(
        broadcaster.clone(),
        feed.clone(),
        config.server_region.clone(),
        start_time,
        config.mmdps_api_key.clone(),
        config.mmdps_history_base.clone(),
    );

    // Start HTTP server
    let http_addr = format!("0.0.0.0:{}", config.http_port);
    let http_listener = tokio::net::TcpListener::bind(&http_addr).await?;
    info!("✅ HTTP server listening on {}", http_addr);

    let app = health_app
        .layer(CorsLayer::permissive()) // Allow browser (e.g. localhost:5173) to fetch /prices
        .layer(TraceLayer::new_for_http());
    axum::serve(http_listener, app).await?;

    Ok(())
}

