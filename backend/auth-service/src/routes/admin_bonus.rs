//! Admin bonus grant / revoke and bonus-related transaction history.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, QueryBuilder};
use std::str::FromStr;
use tracing::error;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::routes::deposits::{compute_and_cache_account_summary, publish_wallet_balance_updated, DepositsState};
use crate::services::bonus_service::{self, BonusError, BonusState};
use crate::utils::jwt::Claims;
use crate::utils::permission_check;

fn perm_err(e: permission_check::PermissionDenied) -> (StatusCode, Json<serde_json::Value>) {
    (
        e.status,
        Json(serde_json::json!({
            "success": false,
            "error": { "code": e.code, "message": e.message }
        })),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserBonusResponse {
    pub user_id: String,
    pub balance: String,
    pub locked: String,
    pub revokable: String,
}

async fn get_user_bonus_handler(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<UserBonusResponse>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "bonus:view")
        .await
        .map_err(perm_err)?;
    let exists: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)"#,
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "message": "db error" })),
        )
    })?;
    if !exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "success": false, "message": "user not found" })),
        ));
    }
    let s: BonusState = bonus_service::get_user_bonus(&pool, user_id)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "success": false, "message": "db error" })),
            )
        })?;
    Ok(Json(UserBonusResponse {
        user_id: user_id.to_string(),
        balance: s.balance.to_string(),
        locked: s.locked.to_string(),
        revokable: s.revokable.to_string(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantBonusRequest {
    pub user_id: Uuid,
    pub amount: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantBonusResponse {
    pub success: bool,
    pub new_bonus_balance: String,
}

async fn grant_handler(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(dep): Extension<DepositsState>,
    Json(req): Json<GrantBonusRequest>,
) -> Result<Json<GrantBonusResponse>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "bonus:edit")
        .await
        .map_err(perm_err)?;
    let note = req.note.as_deref().unwrap_or("");
    if note.len() > 500 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "success": false, "message": "note too long" })),
        ));
    }
    let exists: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)"#,
    )
    .bind(req.user_id)
    .fetch_one(&pool)
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "message": "db error" })),
        )
    })?;
    if !exists {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "success": false, "message": "user not found" })),
        ));
    }
    let amount = Decimal::from_str(req.amount.trim()).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "success": false, "message": "invalid amount" })),
        )
    })?;
    let admin_id = claims.sub;
    let new_bal = bonus_service::grant_bonus(&pool, req.user_id, admin_id, amount, req.note.clone())
        .await
        .map_err(|e| match e {
            BonusError::InvalidAmount => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "message": "invalid amount" })),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "success": false, "message": e.to_string() })),
            ),
        })?;
    compute_and_cache_account_summary(&pool, dep.redis.as_ref(), req.user_id).await;
    publish_wallet_balance_updated(&pool, dep.redis.as_ref(), req.user_id).await;
    Ok(Json(GrantBonusResponse {
        success: true,
        new_bonus_balance: new_bal.to_string(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeBonusRequest {
    pub user_id: Uuid,
    pub amount: String,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeBonusResponse {
    pub success: bool,
    pub new_bonus_balance: String,
}

async fn revoke_handler(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(dep): Extension<DepositsState>,
    Json(req): Json<RevokeBonusRequest>,
) -> Result<Json<RevokeBonusResponse>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "bonus:edit")
        .await
        .map_err(perm_err)?;
    let note = req.note.as_deref().unwrap_or("");
    if note.len() > 500 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "success": false, "message": "note too long" })),
        ));
    }
    let amount = Decimal::from_str(req.amount.trim()).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "success": false, "message": "invalid amount" })),
        )
    })?;
    let admin_id = claims.sub;
    let new_bal = bonus_service::revoke_bonus(&pool, req.user_id, admin_id, amount, req.note.clone())
        .await
        .map_err(|e| match e {
            BonusError::InvalidAmount => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "message": "invalid amount" })),
            ),
            BonusError::InsufficientRevokable { revokable } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({
                    "success": false,
                    "message": "amount exceeds revokable",
                    "revokable": revokable.to_string()
                })),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "success": false, "message": e.to_string() })),
            ),
        })?;
    compute_and_cache_account_summary(&pool, dep.redis.as_ref(), req.user_id).await;
    publish_wallet_balance_updated(&pool, dep.redis.as_ref(), req.user_id).await;
    Ok(Json(RevokeBonusResponse {
        success: true,
        new_bonus_balance: new_bal.to_string(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BonusTxQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(rename = "type")]
    pub types: Option<String>,
    pub admin_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BonusTxRow {
    pub id: Uuid,
    pub user_id: Uuid,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub tx_type: String,
    pub amount: String,
    pub net_amount: String,
    pub reference: Option<String>,
    pub method_details: Option<serde_json::Value>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedBonusTx {
    pub items: Vec<BonusTxRow>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

fn append_bonus_filters(
    qb: &mut QueryBuilder<'_, Postgres>,
    q: &BonusTxQuery,
    force_user_id: Option<Uuid>,
) {
    if let Some(uid) = force_user_id.or(q.user_id) {
        qb.push(" AND user_id = ");
        qb.push_bind(uid);
    }
    if let Some(admin) = q.admin_id {
        qb.push(" AND method_details->>'adminUserId' = ");
        qb.push_bind(admin.to_string());
    }
    if let Some(ref from) = q.from {
        qb.push(" AND created_at >= ");
        qb.push_bind(from.clone());
    }
    if let Some(ref to) = q.to {
        qb.push(" AND created_at <= ");
        qb.push_bind(to.clone());
    }
    if let Some(ref t) = q.types {
        let parts: Vec<String> = t
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !parts.is_empty() {
            qb.push(" AND type::text = ANY(");
            qb.push_bind(parts);
            qb.push(")");
        }
    }
}

async fn list_bonus_transactions(
    pool: &PgPool,
    q: &BonusTxQuery,
    force_user_id: Option<Uuid>,
) -> Result<PaginatedBonusTx, sqlx::Error> {
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);

    let base_list = "SELECT id, user_id, type::text AS type, amount::text AS amount, net_amount::text AS net_amount, reference, method_details, created_at FROM transactions WHERE type::text IN ('bonus_grant','bonus_revoke','bonus_loss_absorb','bonus_margin_lock','bonus_margin_release','pnl_credit','pnl_debit')";
    let base_count = "SELECT COUNT(*)::bigint FROM transactions WHERE type::text IN ('bonus_grant','bonus_revoke','bonus_loss_absorb','bonus_margin_lock','bonus_margin_release','pnl_credit','pnl_debit')";

    let mut count_qb = QueryBuilder::<Postgres>::new(base_count);
    append_bonus_filters(&mut count_qb, q, force_user_id);
    let total: i64 = count_qb.build_query_scalar().fetch_one(pool).await?;

    let mut qb = QueryBuilder::<Postgres>::new(base_list);
    append_bonus_filters(&mut qb, q, force_user_id);
    qb.push(" ORDER BY created_at DESC LIMIT ");
    qb.push_bind(limit);
    qb.push(" OFFSET ");
    qb.push_bind(offset);

    let items: Vec<BonusTxRow> = qb.build_query_as().fetch_all(pool).await?;

    Ok(PaginatedBonusTx {
        items,
        total,
        limit,
        offset,
    })
}

async fn transactions_handler(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<BonusTxQuery>,
) -> Result<Json<PaginatedBonusTx>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "bonus:view")
        .await
        .map_err(perm_err)?;
    list_bonus_transactions(&pool, &q, None).await.map(Json).map_err(|e| {
        error!("bonus transactions: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "message": "db error" })),
        )
    })
}

async fn user_history_handler(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<BonusTxQuery>,
) -> Result<Json<PaginatedBonusTx>, (StatusCode, Json<serde_json::Value>)> {
    permission_check::check_permission(&pool, &claims, "bonus:view")
        .await
        .map_err(perm_err)?;
    let mut q = q;
    q.user_id = Some(user_id);
    list_bonus_transactions(&pool, &q, Some(user_id))
        .await
        .map(Json)
        .map_err(|e| {
            error!("bonus user history: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "success": false, "message": "db error" })),
            )
        })
}

pub fn create_admin_bonus_router(pool: PgPool, dep: DepositsState) -> Router<PgPool> {
    Router::new()
        .route("/user/:user_id", get(get_user_bonus_handler))
        .route("/grant", post(grant_handler))
        .route("/revoke", post(revoke_handler))
        .route("/transactions", get(transactions_handler))
        .route("/user/:user_id/history", get(user_history_handler))
        .layer(axum::extract::Extension(dep))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
