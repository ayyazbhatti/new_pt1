use axum::{
    http::Method,
    routing::{get, post},
    Router,
};
use std::env;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use tracing_subscriber;
use uuid::Uuid;
use futures::stream::StreamExt;

mod db;
mod middleware;
mod models;
mod redis_pool;
mod routes;
mod services;
mod utils;

use db::create_pool;
use routes::auth::create_auth_router;
use routes::admin_groups::create_admin_groups_router;
use routes::admin_leverage_profiles::create_admin_leverage_profiles_router;
use routes::admin_symbols::create_admin_symbols_router;
use routes::admin_markup::create_admin_markup_router;
use routes::admin_swap::create_admin_swap_router;
use routes::admin_users::{create_admin_user_notes_router, create_admin_users_router};
use routes::admin_managers::create_admin_managers_router;
use routes::admin_permission_profiles::create_admin_permission_profiles_router;
use routes::admin_affiliate::create_admin_affiliate_router;
use routes::admin_tags::create_admin_tags_router;
use routes::chat::{create_admin_chat_router, create_user_chat_router};
use routes::deposits::create_deposits_router;
use routes::withdrawals::create_withdrawals_router;
use routes::orders::create_orders_router;
use routes::admin_trading::create_admin_trading_router;
use routes::admin_positions::create_admin_positions_router;
use routes::admin_audit::create_admin_audit_router;
use routes::admin_call_records::create_admin_call_records_router;
use routes::symbols::create_symbols_router;
use routes::finance::create_finance_router;
use routes::admin_settings::create_admin_settings_router;
use routes::appointments::create_appointments_router;
use routes::user_preferences::create_user_preferences_router;
use routes::admin_appointments::create_admin_appointments_router;
use routes::promotions::{create_promotions_public_router, create_admin_promotions_router};
use services::order_event_handler::OrderEventHandler;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables
    dotenv::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "auth_service=debug,tower_http=debug,axum=debug".into()),
        )
        .init();

    // Get database URL
    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    // Get Redis URL (use 127.0.0.1 to match gateway-ws default so pub/sub is on same instance)
    let redis_url = env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());

    // Get NATS URL
    let nats_url = env::var("NATS_URL")
        .unwrap_or_else(|_| "nats://localhost:4222".to_string());

    // Create database connection pool
    let pool = create_pool(&database_url).await?;

    // Redis: Phase 2 pool (one multiplexed connection) + circuit breaker (503 when unhealthy)
    tracing::info!("Connecting to Redis at {}", redis_url);
    let redis_pool = redis_pool::RedisPool::new(&redis_url).await?;
    tracing::info!("Redis pool ready (connection-manager + circuit breaker)");

    // Bootstrap Redis for per-group price stream (price:groups + symbol:markup:*)
    let markup_service = services::admin_markup_service::AdminMarkupService::new(pool.clone());
    if let Err(e) = markup_service.bootstrap_price_groups_redis(&redis_url).await {
        tracing::warn!("Redis markup bootstrap failed (non-fatal): {}", e);
    } else {
        tracing::info!("Redis markup bootstrap completed");
    }

    // Connect to NATS (try to connect, but don't fail if unavailable in dev)
    tracing::info!("Connecting to NATS at {}", nats_url);
    let nats_result = async_nats::connect(&nats_url).await;
    
    let nats = match nats_result {
        Ok(client) => {
            tracing::info!("✅ Connected to NATS");
            Some(client)
        }
        Err(e) => {
            tracing::warn!("⚠️  Failed to connect to NATS: {}. Server will start but event publishing will be disabled.", e);
            tracing::warn!("💡 To enable full functionality, start NATS: docker-compose up nats");
            None
        }
    };

    // Run migrations (if migrations directory exists)
    // Note: For production, use sqlx-cli to run migrations separately
    // sqlx::migrate!("./migrations")
    //     .run(&pool)
    //     .await
    //     .expect("Failed to run migrations");

    // Create CORS layer
    // Note: Cannot use allow_origin(Any/*) with allow_credentials(true)
    // So we specify exact origins for development
    use tower_http::cors::AllowOrigin;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _parts| {
            // Allow localhost origins for development
            origin.to_str().map(|s| 
                s.starts_with("http://localhost:") || 
                s.starts_with("http://127.0.0.1:")
            ).unwrap_or(false)
        }))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::header::ACCEPT,
        ])
        .allow_credentials(true);

    // Use NATS client if available, otherwise the server will still start
    // but event publishing will fail gracefully
    let nats_client = if let Some(client) = nats {
        client
    } else {
        tracing::error!("❌ NATS connection failed. Server will start but event publishing will not work.");
        tracing::error!("💡 To fix: Start NATS server or Docker Compose services");
        // We need to provide a client, so we'll try to connect again with a longer timeout
        // or just panic with a helpful message
        return Err(anyhow::anyhow!(
            "NATS connection failed. Please start NATS server:\n  docker-compose up nats\n  or\n  nats-server"
        ));
    };

    // Initialize account summary coordinator (per-user serialization + publish throttle) to prevent UI flicker
    routes::deposits::init_account_summary_coordinator();
    // Register NATS for stop-out (close all positions when margin level drops below threshold)
    routes::deposits::register_stop_out_nats(Arc::new(nats_client.clone()));

    // Build application state for deposits
    let deposits_state = routes::deposits::DepositsState {
        redis: redis_pool.clone(),
        nats: Arc::new(nats_client.clone()),
    };

    // Build application state for withdrawals
    let withdrawals_state = routes::withdrawals::WithdrawalsState {
        redis: redis_pool.clone(),
        nats: Arc::new(nats_client.clone()),
    };

    // Build application state for orders
    let orders_state = routes::orders::OrdersState {
        redis: redis_pool.clone(),
        nats: Arc::new(nats_client.clone()),
    };

    // Build application state for admin trading
    let admin_trading_state = routes::admin_trading::AdminTradingState {
        redis: redis_pool.clone(),
        nats: Arc::new(nats_client.clone()),
    };

    // Clone pool for event handler and balance listener before passing to router
    let pool_for_events = Arc::new(pool.clone());
    let pool_for_balance = pool.clone();

    // Bulk routes registered with full path so they always match (avoids nest path issues)
    let bulk_routes = Router::new()
        .route("/api/admin/bulk", get(routes::admin_bulk::get_bulk_health))
        .route("/api/admin/bulk/config", get(routes::admin_bulk::get_bulk_config))
        .route("/api/admin/bulk/users", post(routes::admin_bulk::post_bulk_users))
        .layer(axum::middleware::from_fn(middleware::auth_middleware))
        .with_state(pool.clone());

    // Build application
    let app = Router::new()
        .route("/health", get(health_check))
        .merge(bulk_routes)
        .nest("/api/auth", create_auth_router(pool.clone(), redis_pool.clone()))
        .nest("/api/symbols", create_symbols_router(pool.clone())) // Public endpoint for all users
        .nest("/api/admin/orders", create_admin_trading_router(pool.clone(), admin_trading_state.clone()))
        .nest("/api/admin/positions", create_admin_positions_router(pool.clone(), admin_trading_state.clone()))
        .nest("/api/admin/audit", create_admin_audit_router(pool.clone()))
        .nest("/api/admin/call-records", create_admin_call_records_router(pool.clone()))
        .nest("/api/admin/groups", create_admin_groups_router(pool.clone()).layer(axum::extract::Extension(deposits_state.redis.clone())))
        .nest("/api/admin/group-tags", routes::admin_groups::create_admin_group_tags_router(pool.clone()))
        .nest("/api/admin/leverage-profiles", create_admin_leverage_profiles_router(pool.clone()))
        .nest("/api/admin/leverage-profile-tags", routes::admin_leverage_profiles::create_admin_leverage_profile_tags_router(pool.clone()))
        .nest("/api/admin/symbols", create_admin_symbols_router(pool.clone()))
        .nest("/api/admin/markup", create_admin_markup_router(pool.clone()))
        .nest("/api/admin/markup-profile-tags", routes::admin_markup::create_admin_markup_profile_tags_router(pool.clone()))
        .nest("/api/admin/swap", create_admin_swap_router(pool.clone()))
        .nest("/api/admin/swap-rule-tags", routes::admin_swap::create_admin_swap_rule_tags_router(pool.clone()))
        .nest("/api/admin/user-notes", create_admin_user_notes_router(pool.clone()))
        .nest("/api/admin/users", create_admin_users_router(pool.clone(), deposits_state.clone()))
        .nest("/api/admin/managers", create_admin_managers_router(pool.clone()))
        .nest("/api/admin/manager-tags", routes::admin_managers::create_admin_manager_tags_router(pool.clone()))
        .nest("/api/admin/permission-profiles", create_admin_permission_profiles_router(pool.clone()))
        .nest("/api/admin/permission-profile-tags", routes::admin_permission_profiles::create_admin_permission_profile_tags_router(pool.clone()))
        .nest("/api/admin/affiliate", create_admin_affiliate_router(pool.clone()))
        .nest("/api/admin/affiliate-scheme-tags", routes::admin_affiliate::create_admin_affiliate_scheme_tags_router(pool.clone()))
        .nest("/api/admin/settings", create_admin_settings_router(pool.clone()))
        .nest("/api/appointments", create_appointments_router(pool.clone()))
        .nest("/api/admin/appointments", create_admin_appointments_router(pool.clone()))
        .nest("/api/admin/tags", create_admin_tags_router(pool.clone()))
        .nest("/api/admin/finance", create_finance_router(pool.clone()).layer(axum::extract::Extension(deposits_state.clone())))
        .nest("/api/admin/deposits", routes::deposits::create_deposits_router(pool.clone(), deposits_state.clone()))
        .nest("/api/deposits", routes::deposits::create_deposits_router(pool.clone(), deposits_state.clone()))
        .nest("/api/withdrawals", create_withdrawals_router(pool.clone(), withdrawals_state.redis.clone(), withdrawals_state.nats.clone()))
        .nest("/api/wallet", routes::deposits::create_wallet_router(pool.clone(), deposits_state.clone()))
        .nest("/api/account", routes::deposits::create_account_router(pool.clone(), deposits_state.clone()))
        .nest("/api/notifications", routes::deposits::create_notifications_router(pool.clone(), deposits_state.clone()))
        .nest("/api/user", create_user_preferences_router(pool.clone()))
        .nest("/api/promotions", create_promotions_public_router(pool.clone()))
        .nest("/api/admin/promotions", create_admin_promotions_router(pool.clone()))
        .nest(
            "/v1/users",
            routes::deposits::create_positions_router(pool.clone(), deposits_state.clone())
                .merge(create_user_chat_router(pool.clone(), deposits_state.clone())),
        )
        .nest("/api/admin/chat", create_admin_chat_router(pool.clone(), deposits_state.clone()))
        .nest("/api/orders", create_orders_router(pool.clone(), orders_state.clone()))
        .nest("/v1/orders", create_orders_router(pool.clone(), orders_state.clone())) // Keep v1 for backward compatibility
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(pool.clone());

    // Start order event listener to sync filled orders to database
    let nats_for_events = nats_client.clone();
    let redis_for_events = redis_pool.clone();
    let pool_for_orders = pool_for_events.clone();
    tokio::spawn(async move {
        let event_handler = OrderEventHandler::new(pool_for_orders, redis_for_events);
        match nats_for_events.subscribe("evt.order.updated".to_string()).await {
            Ok(subscriber) => {
                info!("✅ Subscribed to evt.order.updated for database sync");
                if let Err(e) = event_handler.start_listener(subscriber).await {
                    error!("Order event listener error: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to subscribe to evt.order.updated: {}", e);
            }
        }
    });

    // Start admin call record listener (ws-gateway publishes admin_call.events)
    let nats_for_calls = nats_client.clone();
    let pool_for_calls = pool.clone();
    tokio::spawn(async move {
        use services::call_record_handler::CallRecordHandler;
        let handler = CallRecordHandler::new(Arc::new(pool_for_calls));
        match nats_for_calls.subscribe("admin_call.events".to_string()).await {
            Ok(subscriber) => {
                info!("✅ Subscribed to admin_call.events for call records");
                if let Err(e) = handler.start_listener(subscriber).await {
                    error!("Call record listener error: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to subscribe to admin_call.events: {}", e);
            }
        }
    });

    // Start position event listener to sync positions to database
    let nats_for_positions = nats_client.clone();
    let pool_for_positions = pool_for_events.clone();
    let redis_for_positions = redis_pool.clone();
    tokio::spawn(async move {
        use services::position_event_handler::PositionEventHandler;
        let position_handler = PositionEventHandler::new(pool_for_positions, redis_for_positions);
        match nats_for_positions.subscribe("evt.position.updated".to_string()).await {
            Ok(subscriber) => {
                info!("✅ Subscribed to evt.position.updated for database sync");
                if let Err(e) = position_handler.start_listener(subscriber).await {
                    error!("Position event listener error: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to subscribe to evt.position.updated: {}", e);
            }
        }
    });

    // On position closed, recompute account summary so margin_used reflects only open positions (0 when none).
    // When trigger_reason is SL or TP, also create notifications and push via Redis (fire-and-forget).
    let nats_for_closed = nats_client.clone();
    let pool_for_closed = pool.clone();
    let redis_for_closed = redis_pool.clone();
    tokio::spawn(async move {
        use futures::StreamExt;
        use routes::deposits::{compute_and_cache_account_summary, create_liquidation_notifications_and_push, create_sltp_notifications_and_push};
        match nats_for_closed.subscribe("event.position.closed".to_string()).await {
            Ok(mut subscriber) => {
                info!("✅ Subscribed to event.position.closed for account summary refresh");
                while let Some(msg) = subscriber.next().await {
                    if let Ok(payload) = serde_json::from_slice::<serde_json::Value>(&msg.payload.to_vec()) {
                        // Support VersionedMessage: { "v", "type", "payload": { user_id, trigger_reason, ... } }
                        let inner = payload
                            .get("payload")
                            .cloned()
                            .unwrap_or(payload);
                        let user_id_str = inner.get("user_id").and_then(|v| v.as_str());
                        if let Some(uid) = user_id_str {
                            if let Ok(user_id) = Uuid::parse_str(uid) {
                                compute_and_cache_account_summary(&pool_for_closed, redis_for_closed.as_ref(), user_id).await;
                            }
                        }
                        // If SL/TP or liquidation trigger, spawn notification task (do not await)
                        let trigger = inner.get("trigger_reason").and_then(|v| v.as_str());
                        if trigger == Some("SL") || trigger == Some("TP") {
                            let pool_spawn = pool_for_closed.clone();
                            let redis_spawn = redis_for_closed.clone();
                            let inner_clone = inner.clone();
                            tokio::spawn(async move {
                                create_sltp_notifications_and_push(pool_spawn, redis_spawn.as_ref(), inner_clone).await;
                            });
                        } else if trigger == Some("liquidated") {
                            let pool_spawn = pool_for_closed.clone();
                            let redis_spawn = redis_for_closed.clone();
                            let inner_clone = inner.clone();
                            tokio::spawn(async move {
                                create_liquidation_notifications_and_push(pool_spawn, redis_spawn.as_ref(), inner_clone).await;
                            });
                        }
                    }
                }
            }
            Err(e) => {
                error!("Failed to subscribe to event.position.closed: {}", e);
            }
        }
    });

    // Start Redis listener for wallet balance requests (pub/sub needs a dedicated connection)
    let client_pubsub = redis::Client::open(redis_url.clone())?;
    let redis_for_balance = redis_pool.clone();
    tokio::spawn(async move {
        use redis::AsyncCommands;
        use routes::deposits::publish_wallet_balance_updated;

        loop {
            match client_pubsub.get_async_connection().await {
                Ok(mut conn) => {
                    let mut pubsub = conn.into_pubsub();
                    if let Err(e) = pubsub.subscribe("wallet:balance:request").await {
                        error!("Failed to subscribe to wallet:balance:request: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                        continue;
                    }
                    
                    info!("✅ Subscribed to wallet:balance:request channel");
                    let mut stream = pubsub.into_on_message();
                    
                    while let Some(msg) = stream.next().await {
                        if let Ok(payload) = msg.get_payload::<String>() {
                            if let Ok(request) = serde_json::from_str::<serde_json::Value>(&payload) {
                                if let Some(user_id_str) = request.get("user_id").and_then(|v| v.as_str()) {
                                    if let Ok(user_id) = Uuid::parse_str(user_id_str) {
                                        info!("📥 Received wallet balance request for user {}", user_id);
                                        publish_wallet_balance_updated(&pool_for_balance, redis_for_balance.as_ref(), user_id).await;
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to get Redis connection for balance listener: {}", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
            }
        }
    });

    // Start price:ticks subscriber for real-time account summary (UnR PnL, equity, free margin)
    let pool_for_ticks = pool.clone();
    let redis_for_ticks = redis_pool.clone();
    let redis_url_ticks = redis_url.clone();
    tokio::spawn(async move {
        use services::price_tick_summary_handler::PriceTickSummaryHandler;
        let handler = PriceTickSummaryHandler::new(pool_for_ticks, redis_for_ticks);
        handler.start_listener(&redis_url_ticks).await;
    });

    // Warm account summary cache for all users so Redis has every user's data (not only on login)
    let pool_warm = pool.clone();
    let redis_warm = redis_pool.clone();
    tokio::spawn(async move {
        use services::account_summary_cache_warmup::warm_all_users;
        warm_all_users(pool_warm, redis_warm).await;
    });

    // Start server
    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    tracing::info!("🚀 Auth service starting on http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("✅ Server ready at http://{}", addr);
    
    // Axum 0.7: Router with state implements IntoMakeService automatically
    // Use serve directly - it should work now that router has state
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> &'static str {
    "OK"
}

