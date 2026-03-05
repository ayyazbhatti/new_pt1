use jsonwebtoken::{decode, DecodingKey, EncodingKey, Validation, Algorithm};
use serde::{Deserialize, Serialize, Deserializer};
use std::time::{SystemTime, UNIX_EPOCH};
use anyhow::Result;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    #[serde(deserialize_with = "deserialize_sub")]
    pub sub: String, // user_id (can be UUID string)
    pub email: String,
    pub role: String,
    /// Group ID from token; accept both "group_id" and "groupId" (camelCase). Missing field defaults to None (e.g. admin tokens).
    #[serde(default, alias = "groupId", deserialize_with = "deserialize_optional_group_id", skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub exp: i64,
    pub iat: i64,
}

// Helper to deserialize sub field which can be UUID or string
fn deserialize_sub<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Sub {
        Uuid(uuid::Uuid),
        String(String),
    }
    
    match Sub::deserialize(deserializer)? {
        Sub::Uuid(uuid) => Ok(uuid.to_string()),
        Sub::String(s) => Ok(s),
    }
}

/// Deserialize group_id from JWT (string or UUID); ensures we always get a normalized string for matching price ticks.
fn deserialize_optional_group_id<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum GroupId {
        Uuid(uuid::Uuid),
        Str(String),
    }
    let opt = Option::<GroupId>::deserialize(deserializer)?;
    Ok(opt.map(|g| match g {
        GroupId::Uuid(u) => u.to_string(),
        GroupId::Str(s) => s,
    }))
}

#[derive(Clone)]
pub struct JwtAuth {
    decoding_key: DecodingKey,
    validation: Validation,
}

impl JwtAuth {
    pub fn new(secret: &str, issuer: &str) -> Self {
        let mut validation = Validation::new(Algorithm::HS256);
        // Only validate issuer if it's not empty/default
        if !issuer.is_empty() && issuer != "newpt" {
            validation.set_issuer(&[issuer]);
        }
        validation.validate_exp = true;
        validation.validate_nbf = false;

        Self {
            decoding_key: DecodingKey::from_secret(secret.as_ref()),
            validation,
        }
    }

    pub fn validate_token(&self, token: &str) -> Result<Claims> {
        let token_data = decode::<Claims>(token, &self.decoding_key, &self.validation)?;
        Ok(token_data.claims)
    }

    pub fn is_expired(&self, claims: &Claims) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        claims.exp < now
    }
}

