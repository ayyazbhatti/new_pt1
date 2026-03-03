use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub server: ServerConfig,
    pub redis: RedisConfig,
    pub auth: AuthConfig,
    pub limits: LimitsConfig,
    pub metrics: MetricsConfig,
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub ws_port: u16,
    pub http_port: u16,
    pub bind_address: String,
    pub max_connections: usize,
    pub heartbeat_interval_secs: u64,
    pub connection_timeout_secs: u64,
}

#[derive(Debug, Clone)]
pub struct RedisConfig {
    pub url: String,
    pub pool_size: usize,
    pub reconnect_interval_secs: u64,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub jwt_secret: String,
    pub jwt_issuer: String,
}

#[derive(Debug, Clone)]
pub struct LimitsConfig {
    pub max_symbols_per_client: usize,
    pub max_message_size_bytes: usize,
    pub max_requests_per_second: u32,
    pub rate_limit_burst: u32,
}

#[derive(Debug, Clone)]
pub struct MetricsConfig {
    pub enabled: bool,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Config {
            server: ServerConfig {
                ws_port: env::var("WS_PORT")
                    .unwrap_or_else(|_| "9001".to_string())
                    .parse()?,
                http_port: env::var("HTTP_PORT")
                    .unwrap_or_else(|_| "9002".to_string())
                    .parse()?,
                bind_address: env::var("BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0".to_string()),
                max_connections: env::var("MAX_CONNECTIONS")
                    .unwrap_or_else(|_| "10000000".to_string())
                    .parse()?,
                heartbeat_interval_secs: env::var("HEARTBEAT_INTERVAL_SECS")
                    .unwrap_or_else(|_| "30".to_string())
                    .parse()?,
                connection_timeout_secs: env::var("CONNECTION_TIMEOUT_SECS")
                    .unwrap_or_else(|_| "300".to_string())
                    .parse()?,
            },
            redis: RedisConfig {
                url: env::var("REDIS_URL")
                    .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
                pool_size: env::var("REDIS_POOL_SIZE")
                    .unwrap_or_else(|_| "100".to_string())
                    .parse()?,
                reconnect_interval_secs: env::var("REDIS_RECONNECT_INTERVAL_SECS")
                    .unwrap_or_else(|_| "5".to_string())
                    .parse()?,
            },
            auth: AuthConfig {
                jwt_secret: env::var("JWT_SECRET")
                    .expect("JWT_SECRET must be set"),
                jwt_issuer: env::var("JWT_ISSUER")
                    .unwrap_or_else(|_| "newpt".to_string()),
            },
            limits: LimitsConfig {
                max_symbols_per_client: env::var("MAX_SYMBOLS_PER_CLIENT")
                    .unwrap_or_else(|_| "500".to_string())
                    .parse()?,
                max_message_size_bytes: env::var("MAX_MESSAGE_SIZE_BYTES")
                    .unwrap_or_else(|_| "65536".to_string())
                    .parse()?,
                max_requests_per_second: env::var("MAX_REQUESTS_PER_SECOND")
                    .unwrap_or_else(|_| "100".to_string())
                    .parse()?,
                rate_limit_burst: env::var("RATE_LIMIT_BURST")
                    .unwrap_or_else(|_| "200".to_string())
                    .parse()?,
            },
            metrics: MetricsConfig {
                enabled: env::var("METRICS_ENABLED")
                    .unwrap_or_else(|_| "true".to_string())
                    .parse()
                    .unwrap_or(true),
                port: env::var("METRICS_PORT")
                    .unwrap_or_else(|_| "9090".to_string())
                    .parse()?,
            },
        })
    }
}

