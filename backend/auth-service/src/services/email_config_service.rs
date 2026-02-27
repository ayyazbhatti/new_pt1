//! Service for platform email (SMTP) configuration. Single row in platform_email_config.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailConfig {
    pub id: Uuid,
    pub smtp_host: String,
    pub smtp_port: i32,
    pub smtp_encryption: String,
    pub smtp_username: String,
    /// Never serialized in API response; only used when updating or sending test.
    #[serde(skip_serializing)]
    pub smtp_password: Option<String>,
    pub from_email: String,
    pub from_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Response DTO: same as EmailConfig but password is never included (masked for "has password" if needed).
#[derive(Debug, Serialize)]
pub struct EmailConfigResponse {
    pub id: Uuid,
    pub smtp_host: String,
    pub smtp_port: i32,
    pub smtp_encryption: String,
    pub smtp_username: String,
    pub from_email: String,
    pub from_name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmailConfigRequest {
    pub smtp_host: Option<String>,
    pub smtp_port: Option<i32>,
    pub smtp_encryption: Option<String>,
    pub smtp_username: Option<String>,
    /// If Some(""), treat as "do not change". If Some(non_empty), update password.
    pub smtp_password: Option<String>,
    pub from_email: Option<String>,
    pub from_name: Option<String>,
}

pub struct EmailConfigService {
    pool: PgPool,
}

impl EmailConfigService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get the single email config row. Returns default values if table is empty (e.g. before migration).
    pub async fn get(&self) -> Result<EmailConfigResponse, anyhow::Error> {
        let row = sqlx::query_as::<_, EmailConfigRow>(
            r#"
            SELECT id, smtp_host, smtp_port, smtp_encryption, smtp_username,
                   from_email, from_name, created_at, updated_at
            FROM platform_email_config
            ORDER BY created_at ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await?;

        let r = match row {
            Some(x) => EmailConfigResponse {
                id: x.id,
                smtp_host: x.smtp_host,
                smtp_port: x.smtp_port,
                smtp_encryption: x.smtp_encryption,
                smtp_username: x.smtp_username,
                from_email: x.from_email,
                from_name: x.from_name,
                created_at: x.created_at,
                updated_at: x.updated_at,
            },
            None => EmailConfigResponse {
                id: Uuid::nil(),
                smtp_host: "smtp.example.com".to_string(),
                smtp_port: 587,
                smtp_encryption: "tls".to_string(),
                smtp_username: String::new(),
                from_email: "noreply@example.com".to_string(),
                from_name: "Platform".to_string(),
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            },
        };
        Ok(r)
    }

    /// Get full config including password (for sending test email or internal use).
    pub async fn get_with_password(&self) -> Result<Option<EmailConfig>, anyhow::Error> {
        let row = sqlx::query_as::<_, EmailConfigRowWithPassword>(
            r#"
            SELECT id, smtp_host, smtp_port, smtp_encryption, smtp_username, smtp_password,
                   from_email, from_name, created_at, updated_at
            FROM platform_email_config
            ORDER BY created_at ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|x| EmailConfig {
            id: x.id,
            smtp_host: x.smtp_host,
            smtp_port: x.smtp_port,
            smtp_encryption: x.smtp_encryption,
            smtp_username: x.smtp_username,
            smtp_password: x.smtp_password,
            from_email: x.from_email,
            from_name: x.from_name,
            created_at: x.created_at,
            updated_at: x.updated_at,
        }))
    }

    pub async fn update(&self, req: UpdateEmailConfigRequest) -> Result<EmailConfigResponse, anyhow::Error> {
        let mut cfg = self.get_with_password().await?.unwrap_or_else(|| EmailConfig {
            id: Uuid::nil(),
            smtp_host: "smtp.example.com".to_string(),
            smtp_port: 587,
            smtp_encryption: "tls".to_string(),
            smtp_username: String::new(),
            smtp_password: None,
            from_email: "noreply@example.com".to_string(),
            from_name: "Platform".to_string(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        });

        if let Some(s) = req.smtp_host {
            cfg.smtp_host = s;
        }
        if let Some(p) = req.smtp_port {
            cfg.smtp_port = p;
        }
        if let Some(s) = req.smtp_encryption {
            cfg.smtp_encryption = s;
        }
        if let Some(s) = req.smtp_username {
            cfg.smtp_username = s;
        }
        if let Some(pass) = req.smtp_password {
            if !pass.is_empty() {
                cfg.smtp_password = Some(pass);
            }
        }
        if let Some(s) = req.from_email {
            cfg.from_email = s;
        }
        if let Some(s) = req.from_name {
            cfg.from_name = s;
        }

        let now = chrono::Utc::now();

        if cfg.id.is_nil() {
            let id = Uuid::new_v4();
            sqlx::query(
                r#"
                INSERT INTO platform_email_config (id, smtp_host, smtp_port, smtp_encryption, smtp_username, smtp_password, from_email, from_name, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
                "#,
            )
            .bind(id)
            .bind(&cfg.smtp_host)
            .bind(cfg.smtp_port)
            .bind(&cfg.smtp_encryption)
            .bind(&cfg.smtp_username)
            .bind(&cfg.smtp_password)
            .bind(&cfg.from_email)
            .bind(&cfg.from_name)
            .bind(now)
            .execute(&self.pool)
            .await?;
        } else {
            if cfg.smtp_password.is_some() {
                sqlx::query(
                    r#"
                    UPDATE platform_email_config
                    SET smtp_host = $1, smtp_port = $2, smtp_encryption = $3, smtp_username = $4, smtp_password = $5, from_email = $6, from_name = $7, updated_at = $8
                    WHERE id = $9
                    "#,
                )
                .bind(&cfg.smtp_host)
                .bind(cfg.smtp_port)
                .bind(&cfg.smtp_encryption)
                .bind(&cfg.smtp_username)
                .bind(&cfg.smtp_password)
                .bind(&cfg.from_email)
                .bind(&cfg.from_name)
                .bind(now)
                .bind(cfg.id)
                .execute(&self.pool)
                .await?;
            } else {
                sqlx::query(
                    r#"
                    UPDATE platform_email_config
                    SET smtp_host = $1, smtp_port = $2, smtp_encryption = $3, smtp_username = $4, from_email = $5, from_name = $6, updated_at = $7
                    WHERE id = $8
                    "#,
                )
                .bind(&cfg.smtp_host)
                .bind(cfg.smtp_port)
                .bind(&cfg.smtp_encryption)
                .bind(&cfg.smtp_username)
                .bind(&cfg.from_email)
                .bind(&cfg.from_name)
                .bind(now)
                .bind(cfg.id)
                .execute(&self.pool)
                .await?;
            }
        }

        self.get().await
    }
}

/// Sends an email with the given subject and body. Blocking; run inside `spawn_blocking`.
pub fn send_email_sync(
    config: &EmailConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), anyhow::Error> {
    let to = to.trim();
    if to.is_empty() {
        anyhow::bail!("Recipient address is empty");
    }
    let from_addr = format!("{} <{}>", config.from_name, config.from_email);
    let from_mailbox = from_addr
        .parse()
        .map_err(|e: lettre::address::AddressError| anyhow::anyhow!("Invalid from address: {}", e))?;
    let to_mailbox = to
        .parse()
        .map_err(|e: lettre::address::AddressError| anyhow::anyhow!("Invalid to address: {}", e))?;

    let email = Message::builder()
        .from(from_mailbox)
        .to(to_mailbox)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| anyhow::anyhow!("Failed to build message: {}", e))?;

    let port: u16 = config
        .smtp_port
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid SMTP port"))?;
    let host = config.smtp_host.as_str();
    let encryption = config.smtp_encryption.to_lowercase();

    // 30s timeout so slow/hung SMTP doesn't block the thread for minutes
    const SMTP_TIMEOUT: Duration = Duration::from_secs(30);

    let mailer = match encryption.as_str() {
        "ssl" => {
            let mut builder = SmtpTransport::relay(host).map_err(|e| anyhow::anyhow!("SMTP relay: {}", e))?;
            builder = builder.port(port).timeout(Some(SMTP_TIMEOUT));
            if !config.smtp_username.is_empty() {
                let password = config.smtp_password.as_deref().unwrap_or("");
                builder = builder.credentials(Credentials::new(
                    config.smtp_username.clone(),
                    password.to_string(),
                ));
            }
            builder.build()
        }
        "tls" | "starttls" => {
            let mut builder =
                SmtpTransport::starttls_relay(host).map_err(|e| anyhow::anyhow!("SMTP STARTTLS: {}", e))?;
            builder = builder.port(port).timeout(Some(SMTP_TIMEOUT));
            if !config.smtp_username.is_empty() {
                let password = config.smtp_password.as_deref().unwrap_or("");
                builder = builder.credentials(Credentials::new(
                    config.smtp_username.clone(),
                    password.to_string(),
                ));
            }
            builder.build()
        }
        _ => {
            let mut builder = SmtpTransport::builder_dangerous(host)
                .port(port)
                .timeout(Some(SMTP_TIMEOUT));
            if !config.smtp_username.is_empty() {
                let password = config.smtp_password.as_deref().unwrap_or("");
                builder = builder.credentials(Credentials::new(
                    config.smtp_username.clone(),
                    password.to_string(),
                ));
            }
            builder.build()
        }
    };

    mailer
        .send(&email)
        .map_err(|e| anyhow::anyhow!("SMTP send failed: {}", e))?;
    Ok(())
}

/// Sends a single test email using the given config. Blocking; run inside `spawn_blocking`.
pub fn send_test_email_sync(config: &EmailConfig, to: &str) -> Result<(), anyhow::Error> {
    send_email_sync(
        config,
        to,
        "Test email from platform",
        "This is a test email. Your SMTP configuration is working correctly.",
    )
}

#[derive(Debug, FromRow)]
struct EmailConfigRow {
    id: Uuid,
    smtp_host: String,
    smtp_port: i32,
    smtp_encryption: String,
    smtp_username: String,
    from_email: String,
    from_name: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, FromRow)]
struct EmailConfigRowWithPassword {
    id: Uuid,
    smtp_host: String,
    smtp_port: i32,
    smtp_encryption: String,
    smtp_username: String,
    smtp_password: Option<String>,
    from_email: String,
    from_name: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}
