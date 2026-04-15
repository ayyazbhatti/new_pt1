#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "auth_service=info,sqlx=warn".into()),
        )
        .init();
    dotenv::dotenv().ok();
    let result = auth_service::run_mmdps_sync().await?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
