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
use crate::models::fee_rule::FeeRuleWithGroupName;
use crate::services::admin_fees_service::AdminFeesService;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

#[derive(Debug, Deserialize)]
pub struct CreateFeeRuleRequest {
    pub group_id: Uuid,
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub market: Option<String>,
    pub fee_percent: Decimal,
    pub min_fee: Decimal,
    pub max_fee: Option<Decimal>,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateFeeRuleRequest {
    pub group_id: Option<Uuid>,
    pub symbol: Option<Option<String>>,
    pub market: Option<Option<String>>,
    pub fee_percent: Option<Decimal>,
    pub min_fee: Option<Decimal>,
    pub max_fee: Option<Option<Decimal>>,
    pub status: Option<String>,
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Serialize)]
pub struct ListFeeRulesResponse {
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

pub fn create_admin_fees_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_fee_rules).post(create_fee_rule))
        .route("/:id", get(get_fee_rule).put(update_fee_rule).delete(delete_fee_rule))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

fn permission_denied_to_response(e: permission_check::PermissionDenied) -> (StatusCode, Json<ErrorResponse>) {
    (
        e.status,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: e.code,
                message: e.message,
            },
        }),
    )
}

fn rule_to_json(r: &FeeRuleWithGroupName) -> serde_json::Value {
    serde_json::json!({
        "id": r.id,
        "group_id": r.group_id,
        "group_name": r.group_name,
        "symbol": r.symbol,
        "market": r.market,
        "fee_percent": r.fee_percent,
        "min_fee": r.min_fee,
        "max_fee": r.max_fee,
        "status": r.status,
        "notes": r.notes,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
        "updated_by": r.updated_by,
        "created_by_user_id": r.created_by_user_id,
        "created_by_email": r.created_by_email,
    })
}

async fn list_fee_rules(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<ListFeeRulesResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "fees:view")
        .await
        .map_err(permission_denied_to_response)?;

    let group_id = params
        .get("group_id")
        .and_then(|s| Uuid::parse_str(s).ok());
    let symbol = params.get("symbol").map(|s| s.as_str());
    let status = params.get("status").map(|s| s.as_str());
    let page = params.get("page").and_then(|s| s.parse::<i64>().ok());
    let page_size = params.get("page_size").and_then(|s| s.parse::<i64>().ok());

    let service = AdminFeesService::new(pool);
    let (rows, total) = service
        .list_fee_rules(group_id, symbol, status, page, page_size)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "LIST_FEE_RULES_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(20);
    let items: Vec<serde_json::Value> = rows.iter().map(rule_to_json).collect();

    Ok(Json(ListFeeRulesResponse {
        items,
        page,
        page_size,
        total,
    }))
}

async fn get_fee_rule(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "fees:view")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminFeesService::new(pool);
    let rule = service.get_fee_rule(id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_FEE_RULE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let rule = rule.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FEE_RULE_NOT_FOUND".to_string(),
                    message: "Fee rule not found".to_string(),
                },
            }),
        )
    })?;

    Ok(Json(rule_to_json(&rule)))
}

async fn create_fee_rule(
    State(pool): State<PgPool>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<CreateFeeRuleRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "fees:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let updated_by = Some(claims.email.as_str());
    let created_by_user_id = Some(claims.sub);

    let service = AdminFeesService::new(pool);
    let row = service
        .create_fee_rule(
            payload.group_id,
            payload.symbol.as_deref(),
            payload.market.as_deref(),
            payload.fee_percent,
            payload.min_fee,
            payload.max_fee,
            &payload.status,
            payload.notes.as_deref(),
            updated_by,
            created_by_user_id,
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "CREATE_FEE_RULE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let rule = service
        .get_fee_rule(row.id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "GET_FEE_RULE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "GET_FEE_RULE_FAILED".to_string(),
                        message: "Fee rule missing after create".to_string(),
                    },
                }),
            )
        })?;

    Ok(Json(rule_to_json(&rule)))
}

async fn update_fee_rule(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
    Json(payload): Json<UpdateFeeRuleRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "fees:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let updated_by = Some(claims.email.as_str());

    let symbol_opt = payload.symbol.as_ref().map(|o| o.as_deref());
    let market_opt = payload.market.as_ref().map(|o| o.as_deref());
    let notes_opt = payload.notes.as_ref().map(|o| o.as_deref());

    let service = AdminFeesService::new(pool);
    service
        .update_fee_rule(
            id,
            payload.group_id,
            symbol_opt,
            market_opt,
            payload.fee_percent,
            payload.min_fee,
            payload.max_fee,
            payload.status.as_deref(),
            notes_opt,
            updated_by,
        )
        .await
        .map_err(|e| {
            let status = if e.to_string().contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            };
            (
                status,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "UPDATE_FEE_RULE_FAILED".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let rule = service.get_fee_rule(id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "GET_FEE_RULE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let rule = rule.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FEE_RULE_NOT_FOUND".to_string(),
                    message: "Fee rule not found".to_string(),
                },
            }),
        )
    })?;

    Ok(Json(rule_to_json(&rule)))
}

async fn delete_fee_rule(
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    claims: axum::extract::Extension<Claims>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "fees:edit")
        .await
        .map_err(permission_denied_to_response)?;

    let service = AdminFeesService::new(pool);
    service.delete_fee_rule(id).await.map_err(|e| {
        let status = if e.to_string().contains("not found") {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::BAD_REQUEST
        };
        (
            status,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DELETE_FEE_RULE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}
