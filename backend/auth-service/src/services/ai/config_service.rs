//! Load and update `platform_ai_config` (singleton row).

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformAiConfig {
    pub provider: String,
    pub model: String,
    /// Stored API key; never expose in API responses.
    pub api_key: Option<String>,
    pub system_prompt: Option<String>,
    pub enabled: bool,
    pub max_tokens_per_message: i32,
    pub daily_token_cap_per_user: i32,
    pub rate_limit_per_minute: i32,
    pub include_user_context: bool,
    pub topic_guard_enabled: bool,
    pub classifier_model: String,
}

pub struct AiConfigService;

impl AiConfigService {
    pub async fn ensure_row(pool: &PgPool) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO platform_ai_config (singleton_id)
            VALUES (1)
            ON CONFLICT (singleton_id) DO NOTHING
            "#,
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn get(pool: &PgPool) -> Result<PlatformAiConfig, sqlx::Error> {
        Self::ensure_row(pool).await?;
        let row = sqlx::query_as::<_, PlatformAiConfigRow>(
            r#"
            SELECT provider, model, api_key, system_prompt, enabled,
                   max_tokens_per_message, daily_token_cap_per_user, rate_limit_per_minute,
                   include_user_context, topic_guard_enabled, classifier_model
            FROM platform_ai_config
            WHERE singleton_id = 1
            "#,
        )
        .fetch_one(pool)
        .await?;

        Ok(row.into())
    }

    /// Resolve API key: DB value first, then `ANTHROPIC_API_KEY` env.
    pub fn resolve_api_key(config: &PlatformAiConfig) -> Option<String> {
        config
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                std::env::var("ANTHROPIC_API_KEY")
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
    }

    pub fn api_key_configured(config: &PlatformAiConfig) -> bool {
        Self::resolve_api_key(config).is_some()
    }

    /// Persist platform AI settings. `api_key`: `None` = unchanged, `Some("")` = clear, `Some(key)` = set.
    pub async fn update(pool: &PgPool, req: UpdatePlatformAiConfig) -> Result<PlatformAiConfig, sqlx::Error> {
        Self::ensure_row(pool).await?;
        let current = Self::get(pool).await?;

        let provider = req.provider.unwrap_or(current.provider);
        let model = req.model.unwrap_or(current.model);
        let mut system_prompt = current.system_prompt;
        if let Some(s) = req.system_prompt {
            system_prompt = if s.trim().is_empty() {
                None
            } else {
                Some(s)
            };
        }
        let enabled = req.enabled.unwrap_or(current.enabled);
        let max_tokens_per_message = req
            .max_tokens_per_message
            .unwrap_or(current.max_tokens_per_message);
        let daily_token_cap_per_user = req
            .daily_token_cap_per_user
            .unwrap_or(current.daily_token_cap_per_user);
        let rate_limit_per_minute = req
            .rate_limit_per_minute
            .unwrap_or(current.rate_limit_per_minute);
        let include_user_context = req
            .include_user_context
            .unwrap_or(current.include_user_context);
        let topic_guard_enabled = req
            .topic_guard_enabled
            .unwrap_or(current.topic_guard_enabled);
        let classifier_model = req.classifier_model.unwrap_or(current.classifier_model);

        match req.api_key.as_deref().map(str::trim) {
            Some("") => {
                sqlx::query(
                    r#"
                    UPDATE platform_ai_config SET
                      provider = $1, model = $2, api_key = NULL, system_prompt = $3,
                      enabled = $4, max_tokens_per_message = $5, daily_token_cap_per_user = $6,
                      rate_limit_per_minute = $7, include_user_context = $8,
                      topic_guard_enabled = $9, classifier_model = $10, updated_at = NOW()
                    WHERE singleton_id = 1
                    "#,
                )
                .bind(&provider)
                .bind(&model)
                .bind(&system_prompt)
                .bind(enabled)
                .bind(max_tokens_per_message)
                .bind(daily_token_cap_per_user)
                .bind(rate_limit_per_minute)
                .bind(include_user_context)
                .bind(topic_guard_enabled)
                .bind(&classifier_model)
                .execute(pool)
                .await?;
            }
            Some(api_key) => {
                sqlx::query(
                    r#"
                    UPDATE platform_ai_config SET
                      provider = $1, model = $2, api_key = $3, system_prompt = $4,
                      enabled = $5, max_tokens_per_message = $6, daily_token_cap_per_user = $7,
                      rate_limit_per_minute = $8, include_user_context = $9,
                      topic_guard_enabled = $10, classifier_model = $11, updated_at = NOW()
                    WHERE singleton_id = 1
                    "#,
                )
                .bind(&provider)
                .bind(&model)
                .bind(api_key)
                .bind(&system_prompt)
                .bind(enabled)
                .bind(max_tokens_per_message)
                .bind(daily_token_cap_per_user)
                .bind(rate_limit_per_minute)
                .bind(include_user_context)
                .bind(topic_guard_enabled)
                .bind(&classifier_model)
                .execute(pool)
                .await?;
            }
            None => {
                sqlx::query(
                    r#"
                    UPDATE platform_ai_config SET
                      provider = $1, model = $2, system_prompt = $3,
                      enabled = $4, max_tokens_per_message = $5, daily_token_cap_per_user = $6,
                      rate_limit_per_minute = $7, include_user_context = $8,
                      topic_guard_enabled = $9, classifier_model = $10, updated_at = NOW()
                    WHERE singleton_id = 1
                    "#,
                )
                .bind(&provider)
                .bind(&model)
                .bind(&system_prompt)
                .bind(enabled)
                .bind(max_tokens_per_message)
                .bind(daily_token_cap_per_user)
                .bind(rate_limit_per_minute)
                .bind(include_user_context)
                .bind(topic_guard_enabled)
                .bind(&classifier_model)
                .execute(pool)
                .await?;
            }
        }

        Self::get(pool).await
    }
}

#[derive(Debug, Clone, Default)]
pub struct UpdatePlatformAiConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
    /// `None` = leave unchanged; `Some("")` = clear; `Some(key)` = set.
    pub api_key: Option<String>,
    /// `None` = unchanged; empty string clears the prompt.
    pub system_prompt: Option<String>,
    pub enabled: Option<bool>,
    pub max_tokens_per_message: Option<i32>,
    pub daily_token_cap_per_user: Option<i32>,
    pub rate_limit_per_minute: Option<i32>,
    pub include_user_context: Option<bool>,
    pub topic_guard_enabled: Option<bool>,
    pub classifier_model: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct PlatformAiConfigRow {
    provider: String,
    model: String,
    api_key: Option<String>,
    system_prompt: Option<String>,
    enabled: bool,
    max_tokens_per_message: i32,
    daily_token_cap_per_user: i32,
    rate_limit_per_minute: i32,
    include_user_context: bool,
    topic_guard_enabled: bool,
    classifier_model: String,
}

impl From<PlatformAiConfigRow> for PlatformAiConfig {
    fn from(r: PlatformAiConfigRow) -> Self {
        Self {
            provider: r.provider,
            model: r.model,
            api_key: r.api_key,
            system_prompt: r.system_prompt,
            enabled: r.enabled,
            max_tokens_per_message: r.max_tokens_per_message,
            daily_token_cap_per_user: r.daily_token_cap_per_user,
            rate_limit_per_minute: r.rate_limit_per_minute,
            include_user_context: r.include_user_context,
            topic_guard_enabled: r.topic_guard_enabled,
            classifier_model: r.classifier_model,
        }
    }
}
