//! AI provider trait and shared message/stream types.

use async_trait::async_trait;
use tokio::sync::mpsc::Sender;

#[derive(Debug, Clone)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub enum AiDelta {
    Text(String),
    Done,
    Error(String),
}

#[derive(Debug, Clone, Default)]
pub struct AiUsage {
    pub tokens_in: u32,
    pub tokens_out: u32,
}

#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn stream_chat(
        &self,
        system: String,
        messages: Vec<AiMessage>,
        max_tokens: u32,
        tx: Sender<AiDelta>,
    ) -> anyhow::Result<AiUsage>;
}
