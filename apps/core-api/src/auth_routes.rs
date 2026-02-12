use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::post,
    Router,
};
use serde::Serialize;
use crate::AppState;

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Serialize)]
struct ErrorDetail {
    code: String,
    message: String,
}

async fn auth_not_available(
    State(_state): State<AppState>,
) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: "AUTH_SERVICE_REQUIRED".to_string(),
                message: "Auth service must be running separately. Please start backend/auth-service on port 3000, or run core-api on a different port.".to_string(),
            },
        }),
    )
}

pub fn create_auth_router() -> Router<AppState> {
    Router::new()
        .route("/register", post(auth_not_available))
        .route("/login", post(auth_not_available))
        .route("/refresh", post(auth_not_available))
        .route("/logout", post(auth_not_available))
        .route("/me", post(auth_not_available))
}

