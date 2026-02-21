//! CRM Leads API routes. Uses AppState and auth Claims.

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use crm_leads::{LeadStatus, LeadsService};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::Claims;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/leads", get(list_leads).post(create_lead))
        .route("/leads/:id", get(get_lead))
        .route("/leads/:id/activities", get(list_activities))
        .route("/leads/:id/tasks", get(list_tasks))
        .route("/leads/:id/messages", get(list_messages))
        .route("/lead-stages", get(list_stages))
        .route("/email-templates", get(list_templates))
}

fn team_id_from_claims(claims: &Claims) -> Uuid {
    claims.team_id.unwrap_or_else(Uuid::nil)
}

fn for_agent(claims: &Claims) -> Option<Uuid> {
    let r = claims.role.to_lowercase();
    if r == "agent" {
        Some(claims.sub)
    } else {
        None
    }
}

#[derive(Debug, Deserialize)]
struct ListLeadsQueryParams {
    page: Option<u32>,
    page_size: Option<u32>,
    status: Option<String>,
    stage_id: Option<String>,
    owner_user_id: Option<String>,
    search: Option<String>,
    source: Option<String>,
    country: Option<String>,
    score_min: Option<i32>,
    score_max: Option<i32>,
}

async fn list_leads(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
    Query(params): Query<ListLeadsQueryParams>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let service = LeadsService::new(state.db.clone());
    let status = params.status.as_deref().and_then(|s| match s.to_lowercase().as_str() {
        "open" => Some(LeadStatus::Open),
        "converted" => Some(LeadStatus::Converted),
        "lost" => Some(LeadStatus::Lost),
        "junk" => Some(LeadStatus::Junk),
        _ => None,
    });
    let stage_id = params.stage_id.and_then(|s| Uuid::parse_str(&s).ok());
    let owner_user_id = params.owner_user_id.and_then(|s| Uuid::parse_str(&s).ok());
    let query = crm_leads::ListLeadsQuery {
        status,
        stage_id,
        owner_user_id,
        source: params.source,
        country: params.country,
        score_min: params.score_min,
        score_max: params.score_max,
        search: params.search,
        page: Some(params.page.unwrap_or(1)),
        page_size: Some(params.page_size.unwrap_or(20)),
    };
    let (items, total) = service
        .list_leads(team_id, query, for_agent(&claims))
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let items_json = serde_json::to_value(items).map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "items": items_json, "total": total })))
}

async fn get_lead(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let service = LeadsService::new(state.db.clone());
    let lead = service
        .get_lead(id, team_id, for_agent(&claims))
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    match lead {
        Some(l) => Ok(Json(serde_json::to_value(l).unwrap_or(serde_json::Value::Null))),
        None => Err((axum::http::StatusCode::NOT_FOUND, "Lead not found".to_string())),
    }
}

async fn create_lead(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let input: crm_leads::CreateLeadInput = serde_json::from_value(body)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e.to_string()))?;
    let service = LeadsService::new(state.db.clone());
    let lead = service
        .create_lead(team_id, input)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::to_value(lead).unwrap_or(serde_json::Value::Null)))
}

async fn list_activities(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let service = LeadsService::new(state.db.clone());
    let list = service
        .list_activities(id, team_id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::to_value(list).unwrap_or(serde_json::Value::Array(vec![]))))
}

async fn list_tasks(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let service = LeadsService::new(state.db.clone());
    let list = service
        .list_tasks(id, team_id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::to_value(list).unwrap_or(serde_json::Value::Array(vec![]))))
}

async fn list_messages(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let service = LeadsService::new(state.db.clone());
    let list = service
        .list_messages(id, team_id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::to_value(list).unwrap_or(serde_json::Value::Array(vec![]))))
}

async fn list_stages(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let service = LeadsService::new(state.db.clone());
    let list = service
        .list_stages(team_id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::to_value(list).unwrap_or(serde_json::Value::Array(vec![]))))
}

async fn list_templates(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, String)> {
    let team_id = team_id_from_claims(&claims);
    let service = LeadsService::new(state.db.clone());
    let list = service
        .list_templates(team_id)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::to_value(list).unwrap_or(serde_json::Value::Array(vec![]))))
}
