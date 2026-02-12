use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::env;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid, // user_id
    pub email: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
}

pub fn get_jwt_secret() -> String {
    env::var("JWT_SECRET").unwrap_or_else(|_| {
        // Default secret for development - should be set in production
        "your-secret-key-change-in-production".to_string()
    })
}

pub fn verify_access_token(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let secret = get_jwt_secret();
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}

pub async fn auth_middleware(
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Get Authorization header
    let auth_header = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Extract token
    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Verify token
    let claims = verify_access_token(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Attach claims to request extensions
    req.extensions_mut().insert(claims);

    Ok(next.run(req).await)
}

