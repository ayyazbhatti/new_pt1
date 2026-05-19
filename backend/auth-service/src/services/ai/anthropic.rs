//! Anthropic Messages API with SSE streaming.

use std::sync::Arc;

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc::Sender;
use tracing::{debug, warn};

use super::provider::{AiDelta, AiMessage, AiProvider, AiUsage};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

pub struct AnthropicProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            model,
        }
    }

    /// Non-streamed completion (topic classifier, admin test).
    pub async fn complete(
        &self,
        system: &str,
        user_content: &str,
        max_tokens: u32,
    ) -> anyhow::Result<String> {
        let body = json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{ "role": "user", "content": user_content }],
            "stream": false,
            "thinking": { "type": "disabled" },
        });

        let mut headers = HeaderMap::new();
        headers.insert("x-api-key", HeaderValue::from_str(&self.api_key)?);
        headers.insert("anthropic-version", HeaderValue::from_static(ANTHROPIC_VERSION));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let resp = self
            .client
            .post(ANTHROPIC_API_URL)
            .headers(headers)
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            anyhow::bail!("Anthropic API error {}: {}", status, text);
        }

        let parsed: AnthropicMessageResponse = serde_json::from_str(&text)
            .map_err(|e| anyhow::anyhow!("Failed to parse Anthropic response: {} body={}", e, text))?;

        let content = parsed
            .content
            .into_iter()
            .find_map(|b| match b {
                AnthropicContentBlock::Text { text } => Some(text),
                AnthropicContentBlock::Other => None,
            })
            .unwrap_or_default();

        Ok(content)
    }

    async fn post_stream(
        &self,
        system: &str,
        messages: &[AiMessage],
        max_tokens: u32,
    ) -> anyhow::Result<reqwest::Response> {
        let api_messages: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();

        let body = json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": api_messages,
            "stream": true,
            "thinking": { "type": "disabled" },
        });

        let mut headers = HeaderMap::new();
        headers.insert("x-api-key", HeaderValue::from_str(&self.api_key)?);
        headers.insert("anthropic-version", HeaderValue::from_static(ANTHROPIC_VERSION));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let resp = self
            .client
            .post(ANTHROPIC_API_URL)
            .headers(headers)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("Anthropic stream error {}: {}", status, text);
        }

        Ok(resp)
    }

    async fn parse_sse_stream(
        response: reqwest::Response,
        tx: &Sender<AiDelta>,
    ) -> anyhow::Result<AiUsage> {
        let mut usage = AiUsage::default();
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut saw_stop = false;
        let mut saw_text = false;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find("\n\n") {
                let block = buffer[..pos].to_string();
                buffer.drain(..pos + 2);

                for line in block.lines() {
                    let line = line.trim();
                    let Some(data) = line.strip_prefix("data: ") else {
                        continue;
                    };
                    if data == "[DONE]" {
                        continue;
                    }

                    let Ok(event) = serde_json::from_str::<AnthropicStreamEvent>(data) else {
                        debug!("Skipping unparseable SSE data: {}", data);
                        continue;
                    };

                    match event.event_type.as_str() {
                        "message_start" => {
                            if let Some(input) = event
                                .message
                                .as_ref()
                                .and_then(|m| m.usage.as_ref())
                                .and_then(|u| u.input_tokens)
                            {
                                usage.tokens_in = input;
                            }
                        }
                        "content_block_delta" => {
                            if let Some(text) = event
                                .delta
                                .as_ref()
                                .and_then(|d| d.text.as_deref())
                                .filter(|t| !t.is_empty())
                            {
                                saw_text = true;
                                let _ = tx.send(AiDelta::Text(text.to_string())).await;
                            } else if let Some(delta) = &event.delta {
                                debug!(
                                    delta_type = ?delta.delta_type,
                                    "content_block_delta without text"
                                );
                            }
                        }
                        "message_delta" => {
                            if let Some(output) =
                                event.usage.as_ref().and_then(|u| u.output_tokens)
                            {
                                usage.tokens_out = output;
                            }
                        }
                        "message_stop" => {
                            saw_stop = true;
                            let _ = tx.send(AiDelta::Done).await;
                        }
                        "error" => {
                            let msg = event
                                .error
                                .and_then(|e| e.message)
                                .unwrap_or_else(|| "Anthropic stream error".to_string());
                            let _ = tx.send(AiDelta::Error(msg)).await;
                        }
                        _ => {}
                    }
                }
            }
        }

        if !saw_stop {
            let _ = tx.send(AiDelta::Done).await;
        }

        if saw_stop && !saw_text {
            warn!("Anthropic stream ended with no text deltas");
            let _ = tx
                .send(AiDelta::Error(
                    "Model returned no text content".to_string(),
                ))
                .await;
        }

        Ok(usage)
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    async fn stream_chat(
        &self,
        system: String,
        messages: Vec<AiMessage>,
        max_tokens: u32,
        tx: Sender<AiDelta>,
    ) -> anyhow::Result<AiUsage> {
        let response = self.post_stream(&system, &messages, max_tokens).await?;
        Self::parse_sse_stream(response, &tx).await
    }
}

#[derive(Debug, Deserialize)]
struct AnthropicMessageResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicContentBlock {
    Text { text: String },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    message: Option<AnthropicStreamMessage>,
    delta: Option<AnthropicStreamDelta>,
    usage: Option<AnthropicStreamUsage>,
    error: Option<AnthropicStreamError>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamMessage {
    usage: Option<AnthropicStreamUsage>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamDelta {
    #[serde(rename = "type")]
    delta_type: Option<String>,
    text: Option<String>,
    thinking: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamUsage {
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamError {
    message: Option<String>,
}

/// Build a shared provider from resolved API key and model.
pub fn provider_from_key(api_key: String, model: String) -> Arc<dyn AiProvider> {
    Arc::new(AnthropicProvider::new(api_key, model))
}
