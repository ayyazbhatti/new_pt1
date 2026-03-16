mod config;
mod leverage;
mod nats;
mod redis;
mod models;
mod subjects;
mod engine;
mod observability;
mod utils;
mod health;

use std::sync::Arc;
use tokio::select;
use futures_util::{StreamExt, FutureExt};
use tracing::{error, info, warn};
use anyhow::Result;

use config::Config;
use nats::NatsClient;
use redis::RedisClient;
use engine::{OrderCache, LuaScripts, Validator, TickHandler, OrderHandler, CancelHandler, PositionHandler, SltpHandler};
use observability::{init_logging, Metrics};
use subjects::subjects as nats_subjects;
use health::subscription::SubscriptionMonitor;
use nats::SubscriptionHealth;

#[tokio::main]
async fn main() -> Result<()> {
    // Load config
    let config = Config::from_env()?;
    init_logging(&config.log_level);
    
    info!("🚀 Starting Order Engine");
    info!("   NATS URL: {}", config.nats_url);
    info!("   Redis URL: {}", config.redis_url);
    
    // Connect to NATS with retry logic
    let nats = Arc::new(NatsClient::connect(&config.nats_url).await?);
    
    // Try to set up JetStream (will fall back to basic pub/sub if not available)
    if let Err(e) = nats.ensure_order_stream().await {
        warn!("JetStream setup failed (will use basic pub/sub): {}", e);
    }
    
    // Connect to Redis
    let redis = Arc::new(RedisClient::connect(&config.redis_url).await?);
    
    // Initialize components
    let cache = Arc::new(OrderCache::new());
    let lua = Arc::new(LuaScripts::new()?);
    let validator = Arc::new(Validator);
    let metrics = Arc::new(Metrics::new());
    
    // Warm cache: load pending orders from Redis so ticks can fill them
    engine::warm_order_cache(&cache, &redis).await?;
    
    // Initialize handlers
    let order_handler = Arc::new(OrderHandler::new(
        cache.clone(),
        redis.clone(),
        nats.clone(),
        validator.clone(),
        metrics.clone(),
        lua.clone(),
    ));
    
    let cancel_handler = Arc::new(CancelHandler::new(
        cache.clone(),
        redis.clone(),
        nats.clone(),
        lua.clone(),
        metrics.clone(),
    ));
    
    let position_handler = Arc::new(PositionHandler::new(
        cache.clone(),
        redis.clone(),
        nats.clone(),
        lua.clone(),
        metrics.clone(),
    ));
    
    let sltp_handler = Arc::new(SltpHandler::new(
        redis.clone(),
        lua.clone(),
        position_handler.clone(),
        cache.clone(),
        nats.clone(),
        metrics.clone(),
    ));
    
    // Create tick_handler with SL/TP handler
    let tick_handler = Arc::new(TickHandler::new(
        cache.clone(),
        redis.clone(),
        nats.clone(),
        lua.clone(),
        metrics.clone(),
        sltp_handler.clone(),
    ));
    
    // Subscribe to NATS subjects
    let nats_client = nats.client();
    
    // Subscribe to ticks: ticks.SYMBOL (data-provider) or ticks.SYMBOL.GROUP_ID (per-group)
    // Use ticks.> to match both formats (NATS > = one or more tokens)
    let ticks_subject = format!("{}>", nats_subjects::TICKS_PREFIX);
    let mut ticks_sub = nats_client.subscribe(ticks_subject.clone()).await?;
    info!("✅ Subscribed to {}", ticks_subject);
    
    // Try to use JetStream consumer for order commands, fallback to basic subscription
    let use_jetstream = nats.jetstream().is_some();
    let mut place_sub_jetstream: Option<async_nats::jetstream::consumer::Consumer<async_nats::jetstream::consumer::push::Config>> = None;
    let mut place_sub_basic: Option<async_nats::Subscriber> = None;
    
    if use_jetstream {
        info!("🔍 Setting up JetStream consumer for {}", nats_subjects::CMD_ORDER_PLACE);
        match nats.ensure_order_stream().await {
            Ok(_) => {
                match nats.create_order_consumer().await {
                    Ok(consumer) => {
                        info!("✅ Created JetStream consumer for {} - using persistent messaging", nats_subjects::CMD_ORDER_PLACE);
                        place_sub_jetstream = Some(consumer);
                    }
                    Err(e) => {
                        warn!("Failed to create JetStream consumer, falling back to basic subscription: {}", e);
                    }
                }
            }
            Err(e) => {
                warn!("Failed to set up JetStream stream, falling back to basic subscription: {}", e);
            }
        }
    }
    
    // Fallback to basic subscription if JetStream not available or failed
    if place_sub_jetstream.is_none() {
        info!("🔍 Creating basic subscription to {}", nats_subjects::CMD_ORDER_PLACE);
        // Note: subscription_health will be created later, so we'll set status in handler
        match nats_client.subscribe(nats_subjects::CMD_ORDER_PLACE.to_string()).await {
            Ok(sub) => {
                info!("✅ Subscription created and will be activated: {}", nats_subjects::CMD_ORDER_PLACE);
                place_sub_basic = Some(sub);
            }
            Err(e) => {
                error!("❌ CRITICAL: Failed to create subscription: {}", e);
                return Err(anyhow::anyhow!("Failed to subscribe to {}: {}", nats_subjects::CMD_ORDER_PLACE, e));
            }
        }
    }
    
    let mut cancel_sub = nats_client.subscribe(nats_subjects::CMD_ORDER_CANCEL.to_string()).await?;
    info!("✅ Subscribed to {}", nats_subjects::CMD_ORDER_CANCEL);
    
    let mut close_sub = nats_client.subscribe(nats_subjects::CMD_POSITION_CLOSE.to_string()).await?;
    info!("✅ Subscribed to {}", nats_subjects::CMD_POSITION_CLOSE);
    
    let mut close_all_sub = nats_client.subscribe(nats_subjects::CMD_POSITION_CLOSE_ALL.to_string()).await?;
    info!("✅ Subscribed to {}", nats_subjects::CMD_POSITION_CLOSE_ALL);

    let mut reopen_sub = nats_client.subscribe(nats_subjects::CMD_POSITION_REOPEN.to_string()).await?;
    info!("✅ Subscribed to {}", nats_subjects::CMD_POSITION_REOPEN);

    let mut reopen_with_params_sub = nats_client.subscribe(nats_subjects::CMD_POSITION_REOPEN_WITH_PARAMS.to_string()).await?;
    info!("✅ Subscribed to {}", nats_subjects::CMD_POSITION_REOPEN_WITH_PARAMS);

    let mut update_params_sub = nats_client.subscribe(nats_subjects::CMD_POSITION_UPDATE_PARAMS.to_string()).await?;
    info!("✅ Subscribed to {}", nats_subjects::CMD_POSITION_UPDATE_PARAMS);
    
    // Create subscription health monitor
    let subscription_health = Arc::new(nats::SubscriptionHealth::new());
    
    // Start HTTP health endpoint with both metrics and subscription health
    let app = axum::Router::new()
        .route("/health", axum::routing::get(health))
        .with_state((metrics.clone(), subscription_health.clone()));
    
    let port = std::env::var("PORT").unwrap_or_else(|_| "3002".to_string());
    let addr = format!("0.0.0.0:{}", port);
    info!("📊 Health endpoint listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error!("HTTP server error: {}", e);
        }
    });
    
    info!("✅ Order Engine ready - processing messages");
    
    // Small delay to ensure subscriptions are fully established
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    info!("✅ Subscriptions established - starting message handlers");
    
    // Spawn separate tasks for each subscription to ensure proper polling
    // This avoids potential issues with select! and unpinned streams
    let tick_handler_clone = tick_handler.clone();
    tokio::spawn(async move {
        info!("🔄 Tick handler started");
        while let Some(msg) = ticks_sub.next().await {
            if let Err(e) = tick_handler_clone.handle_tick(msg).await {
                error!("Error handling tick: {}", e);
            }
        }
        error!("Tick subscription stream ended");
    });
    
    // Subscription health already created above for health endpoint
    let health_monitor = SubscriptionMonitor::new(
        subscription_health.clone(),
        300, // Alert if no messages for 5 minutes
    );
    
    // Start health monitoring
    let health_monitor_clone = health_monitor.clone();
    tokio::spawn(async move {
        health_monitor_clone.start_monitoring().await;
    });

    let order_handler_clone = order_handler.clone();
    let health_clone = subscription_health.clone();
    
    // Handle JetStream consumer or basic subscription
    if let Some(consumer) = place_sub_jetstream {
        // For push consumers, we need to subscribe to the deliver_subject
        // Get the NATS client to subscribe to the deliver subject
        let nats_client_for_deliver = nats_client.clone();
        let deliver_subject = "order-engine.deliver";
        
        tokio::spawn(async move {
            info!("🔄 Place order handler started (JetStream push consumer)");
            info!("🔍 Subscribing to deliver subject: {}", deliver_subject);
            
            // Subscribe to the deliver_subject for push consumer
            let mut deliver_sub = match nats_client_for_deliver.subscribe(deliver_subject.to_string()).await {
                Ok(sub) => {
                    info!("✅ Subscribed to deliver subject: {}", deliver_subject);
                    sub
                }
                Err(e) => {
                    error!("Failed to subscribe to deliver subject {}: {}", deliver_subject, e);
                    return;
                }
            };
            
            // Process messages from the deliver_subject
            loop {
                match deliver_sub.next().await {
                    Some(msg) => {
                        health_clone.record_message();
                        info!("📨 Received JetStream push message on subject: {} (total: {})", 
                              msg.subject, health_clone.get_stats().0);
                        // Capture reply for ack (required for Explicit ack policy so message is not redelivered)
                        let reply_subject = msg.reply.clone();
                        match order_handler_clone.handle_place_order(msg).await {
                            Ok(_) => {
                                info!("✅ Successfully processed order from push consumer");
                            }
                            Err(e) => {
                                health_clone.record_error();
                                error!("❌ Error handling place order: {}", e);
                            }
                        }
                        if let Some(reply) = reply_subject {
                            if let Err(e) = nats_client_for_deliver.publish(reply, "".into()).await {
                                error!("Failed to ack JetStream message: {}", e);
                            }
                        }
                    }
                    None => {
                        warn!("Deliver subject subscription ended, reconnecting...");
                        // Try to resubscribe
                        match nats_client_for_deliver.subscribe(deliver_subject.to_string()).await {
                            Ok(sub) => {
                                info!("✅ Resubscribed to deliver subject: {}", deliver_subject);
                                deliver_sub = sub;
                            }
                            Err(e) => {
                                error!("Failed to resubscribe to deliver subject: {}", e);
                                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                            }
                        }
                    }
                }
            }
        });
    } else if let Some(mut place_sub) = place_sub_basic {
        // Store task handle for monitoring
        let handler_task_handle = tokio::spawn(async move {
            info!("🔄 Place order handler started (basic pub/sub) - waiting for messages on cmd.order.place");
            health_clone.set_subscription_active(true);
            health_clone.set_handler_task_alive(true);
            info!("🔍 Subscription stream is active, polling for messages...");
            
            // Add heartbeat to keep task alive status updated
            let heartbeat_clone = health_clone.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                    heartbeat_clone.set_handler_task_alive(true); // Heartbeat
                }
            });
            
            loop {
                match place_sub.next().await {
                    Some(msg) => {
                        health_clone.record_message();
                        let msg_size = msg.payload.len();
                        info!("📨 NATS message received: subject={}, size={} bytes (total: {})", 
                              msg.subject, msg_size, health_clone.get_stats().0);
                        
                        // Verify message is not empty
                        if msg_size == 0 {
                            error!("⚠️ Received empty message on {}", msg.subject);
                            health_clone.record_error();
                            continue; // Skip empty messages
                        }
                        
                        // Log BEFORE handler call
                        health_clone.record_handler_entry();
                        let handler_entry_count = health_clone.get_full_stats().5;
                        info!("🚀 Calling handle_place_order() - entry #{}", handler_entry_count);
                        
                        // Panic recovery for handler
                        let handler_result = std::panic::AssertUnwindSafe(
                            order_handler_clone.handle_place_order(msg)
                        ).catch_unwind().await;
                        
                        match handler_result {
                            Ok(Ok(())) => {
                                // Success - no action needed
                            }
                            Ok(Err(e)) => {
                                health_clone.record_error();
                                error!("❌ Handler error: {}", e);
                            }
                            Err(panic_info) => {
                                health_clone.record_error();
                                error!("❌ CRITICAL: Handler panicked! {:?}", panic_info);
                                // Task continues - this is key!
                            }
                        }
                    }
                    None => {
                        error!("Place order subscription stream ended unexpectedly");
                        health_clone.set_subscription_active(false);
                        break;
                    }
                }
            }
            health_clone.set_handler_task_alive(false);
        });
        
        // Monitor handler task lifecycle
        let task_monitor_health = subscription_health.clone();
        let handler_task_handle_clone = handler_task_handle;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                if handler_task_handle_clone.is_finished() {
                    error!("❌ CRITICAL: Handler task died!");
                    task_monitor_health.set_handler_task_alive(false);
                    // Task died - this is the root cause!
                }
            }
        });
    } else {
        error!("No subscription available for order commands!");
    }
    
    let cancel_handler_clone = cancel_handler.clone();
    tokio::spawn(async move {
        info!("🔄 Cancel order handler started");
        while let Some(msg) = cancel_sub.next().await {
            if let Err(e) = cancel_handler_clone.handle_cancel(msg).await {
                error!("Error handling cancel: {}", e);
            }
        }
        error!("Cancel order subscription stream ended");
    });
    
    let position_handler_clone = position_handler.clone();
    tokio::spawn(async move {
        info!("🔄 Close position handler started");
        while let Some(msg) = close_sub.next().await {
            if let Err(e) = position_handler_clone.handle_close_position(msg).await {
                error!("Error handling close position: {}", e);
            }
        }
        error!("Close position subscription stream ended");
    });

    let position_handler_reopen_clone = position_handler.clone();
    tokio::spawn(async move {
        info!("🔄 Reopen position handler started");
        while let Some(msg) = reopen_sub.next().await {
            if let Err(e) = position_handler_reopen_clone.handle_reopen_position(msg).await {
                error!("Error handling reopen position: {}", e);
            }
        }
        error!("Reopen position subscription stream ended");
    });

    let position_handler_reopen_with_params_clone = position_handler.clone();
    tokio::spawn(async move {
        info!("🔄 Reopen with params position handler started");
        while let Some(msg) = reopen_with_params_sub.next().await {
            if let Err(e) = position_handler_reopen_with_params_clone.handle_reopen_position_with_params(msg).await {
                error!("Error handling reopen with params position: {}", e);
            }
        }
        error!("Reopen with params position subscription stream ended");
    });

    let position_handler_update_params_clone = position_handler.clone();
    tokio::spawn(async move {
        info!("🔄 Update position params handler started");
        while let Some(msg) = update_params_sub.next().await {
            if let Err(e) = position_handler_update_params_clone.handle_update_position_params(msg).await {
                error!("Error handling update position params: {}", e);
            }
        }
        error!("Update position params subscription stream ended");
    });
    
    let position_handler_close_all = position_handler.clone();
    tokio::spawn(async move {
        info!("🔄 Close all positions handler started");
        while let Some(msg) = close_all_sub.next().await {
            if let Err(e) = position_handler_close_all.handle_close_all_positions(msg).await {
                error!("Error handling close all positions: {}", e);
            }
        }
        error!("Close all positions subscription stream ended");
    });
    
    // Keep main thread alive
    info!("✅ All subscription handlers started - system ready");
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        info!("💓 Order engine heartbeat");
    }
}

async fn health(
    axum::extract::State((_metrics, subscription_health)): axum::extract::State<(Arc<Metrics>, Arc<nats::SubscriptionHealth>)>,
) -> axum::response::Json<serde_json::Value> {
    let (msg_count, error_count, age, task_alive, sub_active, handler_entries) = 
        subscription_health.get_full_stats();
    
    axum::response::Json(serde_json::json!({
        "status": "healthy",
        "subscription": {
            "messages_received": msg_count,
            "errors": error_count,
            "last_message_age_seconds": age,
            "handler_task_alive": task_alive,
            "subscription_active": sub_active,
            "handler_entries": handler_entries,
        }
    }))
}
