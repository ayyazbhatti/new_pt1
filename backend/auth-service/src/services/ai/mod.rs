//! AI chat provider abstraction, config, and topic guard.

pub mod anthropic;
pub mod config_service;
pub mod provider;
pub mod topic_guard;

pub use anthropic::{provider_from_key, AnthropicProvider};
pub use config_service::{AiConfigService, PlatformAiConfig, UpdatePlatformAiConfig};
pub use provider::{AiDelta, AiMessage, AiProvider, AiUsage};
pub use topic_guard::is_on_topic;
