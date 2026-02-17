use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::env;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid, // user_id
    pub email: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<Uuid>,
    pub exp: i64,
    pub iat: i64,
}

impl Claims {
    pub fn new(user_id: Uuid, email: String, role: String, group_id: Option<Uuid>) -> Self {
        let now = Utc::now();
        let exp = now + Duration::seconds(get_access_token_ttl());
        Self {
            sub: user_id,
            email,
            role,
            group_id,
            exp: exp.timestamp(),
            iat: now.timestamp(),
        }
    }
}

pub fn get_jwt_secret() -> String {
    env::var("JWT_SECRET").expect("JWT_SECRET must be set")
}

pub fn get_access_token_ttl() -> i64 {
    env::var("ACCESS_TOKEN_TTL_SECONDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(900) // 15 minutes default
}

pub fn get_refresh_token_ttl() -> i64 {
    env::var("REFRESH_TOKEN_TTL_SECONDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2_592_000) // 30 days default
}

pub fn generate_access_token(claims: &Claims) -> anyhow::Result<String> {
    let secret = get_jwt_secret();
    let token = encode(
        &Header::default(),
        claims,
        &EncodingKey::from_secret(secret.as_ref()),
    )?;
    Ok(token)
}

pub fn verify_access_token(token: &str) -> anyhow::Result<Claims> {
    let secret = get_jwt_secret();
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}

pub fn generate_refresh_token() -> String {
    use base64::Engine;
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

