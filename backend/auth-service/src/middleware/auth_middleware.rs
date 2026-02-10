use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use crate::utils::jwt::verify_access_token;

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

