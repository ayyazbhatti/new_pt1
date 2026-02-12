use tracing_subscriber::fmt;
use tracing_subscriber::EnvFilter;

pub fn init_logging(log_level: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(log_level));
    
    fmt()
        .with_env_filter(filter)
        .json()
        .with_target(false)
        .with_current_span(false)
        .init();
}

