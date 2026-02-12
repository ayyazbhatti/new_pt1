use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub redis_url: String,
    pub feed_provider: String,
    pub server_region: String,
    pub max_connections: usize,
    pub ws_port: u16,
    pub admin_secret_key: String,
    pub http_port: u16,
    pub binance_ws_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Config {
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
            feed_provider: env::var("FEED_PROVIDER").unwrap_or_else(|_| "binance".to_string()),
            server_region: env::var("SERVER_REGION").unwrap_or_else(|_| "asia-1".to_string()),
            max_connections: env::var("MAX_CONNECTIONS")
                .unwrap_or_else(|_| "200000".to_string())
                .parse()
                .unwrap_or(200000),
            ws_port: env::var("WS_PORT")
                .unwrap_or_else(|_| "9003".to_string())
                .parse()
                .unwrap_or(9003),
            http_port: env::var("HTTP_PORT")
                .unwrap_or_else(|_| "9004".to_string())
                .parse()
                .unwrap_or(9004),
            admin_secret_key: env::var("ADMIN_SECRET_KEY")
                .unwrap_or_else(|_| "change-me-in-production".to_string()),
            binance_ws_url: env::var("BINANCE_WS_URL")
                .unwrap_or_else(|_| "wss://stream.binance.com:9443/ws".to_string()),
        })
    }
}

