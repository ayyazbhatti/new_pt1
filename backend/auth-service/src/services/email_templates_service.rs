//! Service for platform email templates (welcome, password_reset, etc.).

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EmailTemplateRow {
    pub template_id: String,
    pub subject: String,
    pub body: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Map of template_id -> { subject, body } for API response.
pub type EmailTemplatesMap = HashMap<String, EmailTemplatePayload>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailTemplatePayload {
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEmailTemplateRequest {
    pub subject: String,
    pub body: String,
}

pub struct EmailTemplatesService {
    pool: PgPool,
}

impl EmailTemplatesService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get all email templates as a map template_id -> { subject, body }.
    pub async fn get_all(&self) -> Result<EmailTemplatesMap, anyhow::Error> {
        let rows: Vec<EmailTemplateRow> = sqlx::query_as(
            "SELECT template_id, subject, body, updated_at FROM platform_email_templates ORDER BY template_id",
        )
        .fetch_all(&self.pool)
        .await?;
        let map = rows
            .into_iter()
            .map(|r| {
                (
                    r.template_id,
                    EmailTemplatePayload {
                        subject: r.subject,
                        body: r.body,
                    },
                )
            })
            .collect();
        Ok(map)
    }

    /// Upsert one template by id.
    pub async fn upsert(
        &self,
        template_id: &str,
        subject: &str,
        body: &str,
    ) -> Result<EmailTemplatePayload, anyhow::Error> {
        let now = chrono::Utc::now();
        sqlx::query(
            r#"
            INSERT INTO platform_email_templates (template_id, subject, body, updated_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (template_id) DO UPDATE SET
                subject = EXCLUDED.subject,
                body = EXCLUDED.body,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(template_id)
        .bind(subject)
        .bind(body)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(EmailTemplatePayload {
            subject: subject.to_string(),
            body: body.to_string(),
        })
    }
}
