use axum::{
    extract::{Query, State, Extension},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;
use crate::routes::admin_trading::{AdminAuditLog, PaginatedResponse, ListAuditQuery, ErrorResponse, ErrorDetail, check_admin};

async fn list_admin_audit(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(_params): Query<ListAuditQuery>,
) -> Result<Json<PaginatedResponse<AdminAuditLog>>, (StatusCode, Json<ErrorResponse>)> {
    check_admin(&claims)?;
    // TODO: Implement when audit_events table is available
    Ok(Json(PaginatedResponse {
        items: vec![],
        cursor: None,
        has_more: false,
        total: Some(0),
    }))
}

pub fn create_admin_audit_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_admin_audit))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

