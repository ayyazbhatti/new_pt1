use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Json, Router,
};
use sqlx::PgPool;
use uuid::Uuid;

/// Auth context for leads API (injected by core-api from JWT Claims).
#[derive(Clone, Debug)]
pub struct LeadsAuth {
    pub user_id: Uuid,
    pub team_id: Uuid,
    pub role: String,
}

pub fn create_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/leads", get(list_leads).post(create_lead))
        .route("/leads/:id", get(get_lead).patch(update_lead))
        .route("/leads/:id/activities", get(list_activities))
        .route("/leads/:id/tasks", get(list_tasks).post(create_task))
        .route("/leads/:id/messages", get(list_messages))
        .route("/lead-stages", get(list_stages))
        .route("/email-templates", get(list_templates))
        .with_state(pool)
}

async fn list_leads(State(pool): State<PgPool>) -> axum::response::Json<serde_json::Value> {
    // TODO: extract LeadsAuth from extensions, call service
    axum::response::Json(serde_json::json!({ "items": [], "total": 0 }))
}

async fn get_lead(State(_pool): State<PgPool>, Path(_id): Path<Uuid>) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::Value::Null)
}

async fn create_lead(State(_pool): State<PgPool>, Json(_body): Json<serde_json::Value>) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::Value::Null)
}

async fn update_lead(
    State(_pool): State<PgPool>,
    Path(_id): Path<Uuid>,
    Json(_body): Json<serde_json::Value>,
) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::Value::Null)
}

async fn list_activities(
    State(_pool): State<PgPool>,
    Path(_id): Path<Uuid>,
) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!([]))
}

async fn list_tasks(State(_pool): State<PgPool>, Path(_id): Path<Uuid>) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!([]))
}

async fn create_task(
    State(_pool): State<PgPool>,
    Path(_id): Path<Uuid>,
    Json(_body): Json<serde_json::Value>,
) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::Value::Null)
}

async fn list_messages(
    State(_pool): State<PgPool>,
    Path(_id): Path<Uuid>,
) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!([]))
}

async fn list_stages(State(_pool): State<PgPool>) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!([]))
}

async fn list_templates(State(_pool): State<PgPool>) -> axum::response::Json<serde_json::Value> {
    axum::response::Json(serde_json::json!([]))
}
