//! Pre-flight topic classifier (Haiku) before main chat completion.

use serde::Deserialize;
use tracing::warn;

use super::anthropic::AnthropicProvider;

const CLASSIFIER_SYSTEM: &str = r#"You are a topic classifier. Return ONLY a JSON object {"relevant": true|false}.
Return true only if the message is about: trading on this platform, account management, deposits/withdrawals, orders/positions, KYC, platform features, market terminology, or how to use the trading terminal.
Return false for general knowledge, coding help, personal advice, news, or anything unrelated to using a trading platform."#;

const CLASSIFIER_MAX_TOKENS: u32 = 20;

#[derive(Debug, Deserialize)]
struct ClassifierResponse {
    relevant: bool,
}

/// Returns `true` if the message is on-topic for the trading platform assistant.
pub async fn is_on_topic(
    api_key: &str,
    classifier_model: &str,
    user_message: &str,
) -> anyhow::Result<bool> {
    let provider = AnthropicProvider::new(api_key.to_string(), classifier_model.to_string());
    let raw = provider
        .complete(CLASSIFIER_SYSTEM, user_message, CLASSIFIER_MAX_TOKENS)
        .await?;

    let trimmed = raw.trim();
    let json_str = extract_json_object(trimmed).unwrap_or(trimmed);

    match serde_json::from_str::<ClassifierResponse>(json_str) {
        Ok(parsed) => Ok(parsed.relevant),
        Err(e) => {
            warn!(
                classifier_response = %raw,
                error = %e,
                "Topic classifier returned unparseable JSON; treating as off-topic"
            );
            Ok(false)
        }
    }
}

fn extract_json_object(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    if end >= start {
        Some(&s[start..=end])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::extract_json_object;

    #[test]
    fn extracts_json_from_fenced_response() {
        let s = r#"Here is the result: {"relevant": true}"#;
        assert_eq!(extract_json_object(s), Some(r#"{"relevant": true}"#));
    }
}
