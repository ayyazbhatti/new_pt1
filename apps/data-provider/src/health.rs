use axum::{response::Json, extract::State};
use serde_json::json;
use crate::AppState;

pub async fn health(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "data-provider"
    }))
}

