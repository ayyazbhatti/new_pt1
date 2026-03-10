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
use crate::utils::permission_check;
use crate::routes::admin_trading::{AdminAuditLog, PaginatedResponse, ListAuditQuery, ErrorResponse, ErrorDetail};

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

async fn list_admin_audit(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(_params): Query<ListAuditQuery>,
) -> Result<Json<PaginatedResponse<AdminAuditLog>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "risk:view")
        .await
        .map_err(permission_denied_to_response)?;
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

