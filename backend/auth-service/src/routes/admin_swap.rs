use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::services::admin_swap_service::AdminSwapService;
use crate::utils::jwt::Claims;

#[derive(Debug, Deserialize)]
pub struct CreateSwapRuleRequest {
    pub group_id: Uuid,
    pub symbol: String,
    pub market: String,
    pub calc_mode: String,
    pub unit: String,
    pub long_rate: Decimal,
    pub short_rate: Decimal,
    pub rollover_time_utc: String,
    pub weekend_rule: String,
    pub status: String,
    #[serde(default)]
    pub triple_day: Option<String>,
    pub min_charge: Option<Decimal>,
    pub max_charge: Option<Decimal>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSwapRuleRequest {
    pub group_id: Option<Uuid>,
    pub symbol: Option<String>,
    pub market: Option<String>,
    pub calc_mode: Option<String>,
    pub unit: Option<String>,
    pub long_rate: Option<Decimal>,
    pub short_rate: Option<Decimal>,
    pub rollover_time_utc: Option<String>,
    pub weekend_rule: Option<String>,
    pub triple_day: Option<Option<String>>,
    pub min_charge: Option<Option<Decimal>>,
    pub max_charge: Option<Option<Decimal>>,
    pub status: Option<String>,
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Serialize)]
pub struct ListSwapRulesResponse {
    pub items: Vec<serde_json::Value>,
    pub page: i64,
    pub page_size: i64,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorDetail,
}

#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

pub fn create_admin_swap_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/rules", get(list_rules).post(create_rule))
        .route("/rules/:id", get(get_rule).put(update_rule).delete(delete_rule))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

fn check_admin(claims: &Claims) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Admin access required".to_string(),
                },
            }),
        ));
    }
    Ok(())
}

fn rule_to_json(r: &crate::models::swap_rule::SwapRuleWithGroupName) -> serde_json::Value {
    serde_json::json!({
        "id": r.id,
        "group_id": r.group_id,
        "group_name": r.group_name,
        "symbol": r.symbol,
        "market": r.market,
        "calc_mode": r.calc_mode,
        "unit": r.unit,
        "long_rate": r.long_rate,
        "short_rate": r.short_rate,
        "rollover_time_utc": r.rollover_time_utc,
        "triple_day": r.triple_day,
        "weekend_rule": r.weekend_rule,
        "min_charge": r.min_charge,
        "max_charge": r.max_charge,
        "status": r.status,
        "notes": r.notes,
        "updated_at": r.updated_at,
        "updated_by": r.updated_by,
    })
}

async fn list_rules(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ListSwapRulesResponse>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let group_id = params
        .get("group_id")
        .and_then(|s| Uuid::parse_str(s).ok());
    let market = params.get("market").map(|s| s.as_str());
    let symbol = params.get("symbol").map(|s| s.as_str());
    let status = params.get("status").map(|s| s.as_str());
    let calc_mode = params.get("calc_mode").map(|s| s.as_str());
    let page = params.get("page").and_then(|s| s.parse::<i64>().ok());
    let page_size = params.get("page_size").and_then(|s| s.parse::<i64>().ok());

    let service = AdminSwapService::new(pool);
    let (rows, total) = service
        .list_rules(group_id, market, symbol, status, calc_mode, page, page_size)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "LIST_SWAP_RULES_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);

    let items: Vec<serde_json::Value> = rows.iter().map(rule_to_json).collect();

    Ok(Json(ListSwapRulesResponse {
        items,
        page,
        page_size,
        total,
    }))
}

async fn get_rule(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let service = AdminSwapService::new(pool);
    let rule = service.get_rule_by_id(id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "SWAP_RULE_NOT_FOUND".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(Json(rule_to_json(&rule)))
}

async fn create_rule(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<CreateSwapRuleRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let updated_by = Some(claims.email.as_str());

    let service = AdminSwapService::new(pool);
    let rule = service
        .create_rule(
            payload.group_id,
            &payload.symbol,
            &payload.market,
            &payload.calc_mode,
            &payload.unit,
            payload.long_rate,
            payload.short_rate,
            &payload.rollover_time_utc,
            &payload.weekend_rule,
            &payload.status,
            payload.triple_day.as_deref(),
            payload.min_charge,
            payload.max_charge,
            payload.notes.as_deref(),
            updated_by,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "CREATE_SWAP_RULE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    Ok(Json(rule_to_json(&rule)))
}

async fn update_rule(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<UpdateSwapRuleRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let updated_by = Some(claims.email.as_str());

    let triple_day_opt = payload.triple_day.as_ref().map(|o| o.as_deref());
    let notes_opt = payload.notes.as_ref().map(|o| o.as_deref());

    let service = AdminSwapService::new(pool);
    let rule = service
        .update_rule(
            id,
            payload.group_id,
            payload.symbol.as_deref(),
            payload.market.as_deref(),
            payload.calc_mode.as_deref(),
            payload.unit.as_deref(),
            payload.long_rate,
            payload.short_rate,
            payload.rollover_time_utc.as_deref(),
            payload.weekend_rule.as_deref(),
            triple_day_opt,
            payload.min_charge,
            payload.max_charge,
            payload.status.as_deref(),
            notes_opt,
            updated_by,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_SWAP_RULE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    Ok(Json(rule_to_json(&rule)))
}

async fn delete_rule(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;

    let service = AdminSwapService::new(pool);
    service.delete_rule(id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DELETE_SWAP_RULE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}
