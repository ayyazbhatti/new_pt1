use axum::{
    http::Method,
    routing::get,
    Router,
};
use std::env;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber;

mod db;
mod middleware;
mod models;
mod routes;
mod services;
mod utils;

use db::create_pool;
use routes::auth::create_auth_router;
use routes::admin_groups::create_admin_groups_router;
use routes::admin_leverage_profiles::create_admin_leverage_profiles_router;

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

    // Create database connection pool
    let pool = create_pool(&database_url).await?;

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

    // Build application
    let app = Router::new()
        .route("/health", get(health_check))
        .nest("/api/auth", create_auth_router(pool.clone()))
        .nest("/api/admin/groups", create_admin_groups_router(pool.clone()))
        .nest("/api/admin/leverage-profiles", create_admin_leverage_profiles_router(pool.clone()))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(pool);

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

