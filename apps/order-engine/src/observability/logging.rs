use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;
use tracing_appender::rolling::{RollingFileAppender, Rotation};

pub fn init_logging(log_level: &str) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(log_level));

    // Stdout layer (current behavior)
    let layer_stdout = fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(true)
        .json()
        .with_target(false)
        .with_current_span(false);

    // File layer: logs/order-engine.log (daily rotation), keep guard alive for flush
    let _ = std::fs::create_dir_all("logs");
    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .build("logs")
        .unwrap_or_else(|e| {
            eprintln!("Failed to create logs/ directory for order-engine: {}", e);
            // Fallback: use current dir if "logs" fails (e.g. permission)
            RollingFileAppender::builder()
                .rotation(Rotation::DAILY)
                .build("./order-engine-logs")
                .expect("order-engine: could not create log file")
        });
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
}

