use axum::{
    extract::{Path, Query, State, Extension},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use contracts::VersionedMessage;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::error;
use uuid::Uuid;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;
use crate::routes::admin_trading::{AdminTradingState, AdminPosition, PaginatedResponse, ListPositionsQuery, ClosePositionRequest, ModifySltpRequest, ErrorResponse, ErrorDetail, check_admin};

async fn list_admin_positions(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(_params): Query<ListPositionsQuery>,
) -> Result<Json<PaginatedResponse<AdminPosition>>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;
    // TODO: Implement when positions table is available
    Ok(Json(PaginatedResponse {
        items: vec![],
        cursor: None,
        has_more: false,
        total: Some(0),
    }))
}

async fn close_admin_position(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(position_id): Path<Uuid>,
    Json(req): Json<ClosePositionRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;
    let now = Utc::now();
    let close_event = serde_json::json!({
        "positionId": position_id.to_string(),
        "closedSize": req.size.unwrap_or(0.0),
        "timestamp": now.to_rfc3339(),
    });
    let msg = VersionedMessage::new("admin.position.closed", &close_event)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to publish close event".to_string(),
                    },
                }),
            )
        })?;
    let payload = serde_json::to_vec(&msg).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize close event".to_string(),
                },
            }),
        )
    })?;
    admin_state.nats.publish("admin.position.closed".to_string(), payload.into()).await.ok();
    Ok(StatusCode::OK)
}

async fn modify_position_sltp(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(position_id): Path<Uuid>,
    Json(req): Json<ModifySltpRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;
    let now = Utc::now();
    let modify_event = serde_json::json!({
        "positionId": position_id.to_string(),
        "stopLoss": req.stop_loss,
        "takeProfit": req.take_profit,
        "timestamp": now.to_rfc3339(),
    });
    let msg = VersionedMessage::new("admin.position.sltp.modified", &modify_event)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INTERNAL_ERROR".to_string(),
                        message: "Failed to publish modify event".to_string(),
                    },
                }),
            )
        })?;
    let payload = serde_json::to_vec(&msg).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize modify event".to_string(),
                },
            }),
        )
    })?;
    admin_state.nats.publish("admin.position.sltp.modified".to_string(), payload.into()).await.ok();
    Ok(StatusCode::OK)
}

pub fn create_admin_positions_router(
    pool: PgPool,
    admin_state: AdminTradingState,
) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_admin_positions))
        .route("/:id/close", post(close_admin_position))
        .route("/:id/close-partial", post(close_admin_position))
        .route("/:id/modify-sltp", post(modify_position_sltp))
        .route("/:id/liquidate", post(close_admin_position))
        .layer(axum::middleware::from_fn_with_state(
            pool.clone(),
            auth_middleware,
        ))
        .layer(axum::Extension(admin_state))
        .with_state(pool)
}

