//! JWT validation for WebSocket auth. Uses the same secret and claim shape as auth-service
//! so that tokens issued by auth-service are accepted and session.user_id matches
//! the userId in NATS events (e.g. wallet.balance.updated).

use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::Deserialize;
use uuid::Uuid;

/// Claims we need from the JWT (must match auth-service token shape).
/// exp/iat are validated by jsonwebtoken; sub = user_id, group_id used for per-group price.
#[derive(Debug, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    #[serde(default)]
    pub group_id: Option<Uuid>,
    #[allow(dead_code)]
    pub exp: i64,
    #[allow(dead_code)]
    pub iat: i64,
}

/// Result of successful auth: user_id and optional group_id (for per-group marked-up prices).
pub struct AuthResult {
    pub user_id: Uuid,
    pub group_id: Option<Uuid>,
}

/// Verify the access token and return user_id and group_id if valid.
/// Returns an error string suitable for sending as auth_error to the client.
/// Strips "Bearer " prefix if present so clients can send either raw token or "Bearer <token>".
pub fn verify_access_token(token: &str, secret: &str) -> Result<AuthResult, String> {
    let token = token.trim().strip_prefix("Bearer ").unwrap_or(token.trim());
    if token.is_empty() {
        return Err("No token provided".to_string());
    }
    let key = DecodingKey::from_secret(secret.as_bytes());
    let validation = Validation::default();
    let token_data = decode::<Claims>(token, &key, &validation).map_err(|e| {
        let msg = match e.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => "Token expired",
            jsonwebtoken::errors::ErrorKind::InvalidToken => "Invalid token",
            jsonwebtoken::errors::ErrorKind::InvalidSignature => {
                "Token validation failed (invalid signature — ensure gateway-ws and auth-service use the same JWT_SECRET)"
            }
            _ => "Token validation failed",
        };
        msg.to_string()
    })?;
    Ok(AuthResult {
        user_id: token_data.claims.sub,
        group_id: token_data.claims.group_id,
    })
}
