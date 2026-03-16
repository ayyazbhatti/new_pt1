use std::env;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;
use tracing_appender::rolling::{RollingFileAppender, Rotation};

/// When LOG_TO_FILE is "0" or "false", only stdout is used (production default to avoid disk fill).
fn file_logging_enabled() -> bool {
    match env::var("LOG_TO_FILE").ok().as_deref() {
        Some("0") | Some("false") | Some("no") => false,
        Some("1") | Some("true") | Some("yes") => true,
        _ => false, // default off in production; set LOG_TO_FILE=1 for local file logs
    }
}

pub fn init_logging(log_level: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(log_level));

    // Stdout layer: always on (Docker captures this; use log driver max-size to cap)
    let layer_stdout = fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(true)
        .json()
        .with_target(false)
        .with_current_span(false);

    // File layer: only when LOG_TO_FILE=1 (e.g. local dev). In production use stdout only to avoid unbounded disk use.
    if file_logging_enabled() {
        let _ = std::fs::create_dir_all("logs");
        if let Ok(file_appender) = RollingFileAppender::builder()
            .rotation(Rotation::DAILY)
            .build("logs")
        {
            let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
            let _ = Box::leak(Box::new(guard));
            let layer_file = fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .json()
                .with_target(false)
                .with_current_span(false);
            tracing_subscriber::registry()
                .with(filter)
                .with(layer_stdout)
                .with(layer_file)
                .init();
            return;
        }
    }

    tracing_subscriber::registry()
        .with(filter)
        .with(layer_stdout)
        .init();
}

