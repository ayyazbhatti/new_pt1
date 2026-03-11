use axum::{
    extract::{Path, Query, State, Extension},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use contracts::VersionedMessage;
use redis::AsyncCommands;
use sqlx::PgPool;
use std::collections::HashMap;
use tracing::{error, info};
use uuid::Uuid;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;
use crate::utils::permission_check;
use crate::routes::admin_trading::{AdminTradingState, AdminPosition, PaginatedResponse, ListPositionsQuery, ClosePositionRequest, ModifySltpRequest, ErrorResponse, ErrorDetail};
use crate::routes::scoped_access;
use redis_model::keys::Keys;

const POS_BY_ID_PREFIX: &str = "pos:by_id:";

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

async fn list_admin_positions(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Query(params): Query<ListPositionsQuery>,
) -> Result<Json<PaginatedResponse<AdminPosition>>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "trading:view")
        .await
        .map_err(permission_denied_to_response)?;

    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims)
        .await
        .map_err(|(status, Json(se))| (status, Json(ErrorResponse { error: ErrorDetail { code: se.error.code, message: se.error.message } })))?;

    let mut conn = admin_state.redis.get().await.map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "REDIS_ERROR".to_string(),
                    message: "Cache unavailable".to_string(),
                },
            }),
        )
    })?;

    let keys: Vec<String> = conn.keys(format!("{}*", POS_BY_ID_PREFIX)).await.map_err(|e| {
        error!("Admin positions: Redis KEYS failed: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "REDIS_ERROR".to_string(),
                    message: "Failed to list position keys".to_string(),
                },
            }),
        )
    })?;

    info!("Admin positions API: Redis keys (pos:by_id:*) count = {}", keys.len());

    let mut open_positions: Vec<(String, HashMap<String, String>)> = Vec::new();
    for key in keys {
        if !key.starts_with(POS_BY_ID_PREFIX) {
            continue;
        }
        let position_id = key.trim_start_matches(POS_BY_ID_PREFIX).to_string();
        let pos_data: HashMap<String, String> = match conn.hgetall(&key).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let status = pos_data.get("status").map(|s| s.as_str()).unwrap_or("");
        if !status.eq_ignore_ascii_case("OPEN") {
            continue;
        }
        if let Some(ref sym) = params.symbol {
            if pos_data.get("symbol").map(|s| s.as_str()) != Some(sym.as_str()) {
                continue;
            }
        }
        if let Some(ref uid) = params.user_id {
            if pos_data.get("user_id").map(|s| s.as_str()) != Some(uid.as_str()) {
                continue;
            }
        }
        if let Some(ref allowed) = allowed_user_ids {
            let pos_user_id = match pos_data.get("user_id").and_then(|s| Uuid::parse_str(s).ok()) {
                Some(u) => u,
                None => continue,
            };
            if !allowed.contains(&pos_user_id) {
                continue;
            }
        }
        open_positions.push((position_id, pos_data));
    }

    info!(
        "Admin positions API: open positions (status=OPEN) count = {}",
        open_positions.len()
    );

    let user_ids: Vec<Uuid> = open_positions
        .iter()
        .filter_map(|(_, m)| m.get("user_id").and_then(|s| Uuid::parse_str(s).ok()))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let user_map: HashMap<Uuid, (String, Option<String>, Option<Uuid>, String)> = if user_ids.is_empty() {
        HashMap::new()
    } else {
        let rows = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<Uuid>)>(
            r#"SELECT id, COALESCE(TRIM(first_name || ' ' || last_name), '') as name, email, group_id FROM users WHERE id = ANY($1)"#,
        )
        .bind(&user_ids)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            error!("Admin positions: user fetch failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: "Failed to load user info".to_string(),
                    },
                }),
            )
        })?;
        let group_ids: Vec<Uuid> = rows.iter().filter_map(|(_, _, _, g)| *g).collect::<std::collections::HashSet<_>>().into_iter().collect();
        let group_names: HashMap<Uuid, String> = if group_ids.is_empty() {
            HashMap::new()
        } else {
            sqlx::query_as::<_, (Uuid, String)>(
                r#"SELECT id, name FROM user_groups WHERE id = ANY($1)"#,
            )
            .bind(&group_ids)
            .fetch_all(&pool)
            .await
            .ok()
            .map(|rows| rows.into_iter().map(|(id, name)| (id, name)).collect())
            .unwrap_or_default()
        };
        let mut map = HashMap::new();
        for (id, name, email, group_id) in rows {
            let group_name = group_id
                .and_then(|gid| group_names.get(&gid).cloned())
                .unwrap_or_else(|| "—".to_string());
            map.insert(id, (name, email, group_id, group_name));
        }
        map
    };

    let items: Vec<AdminPosition> = open_positions
        .into_iter()
        .filter_map(|(id, m)| {
            let user_id = m.get("user_id").cloned().unwrap_or_default();
            let user_uuid = Uuid::parse_str(&user_id).ok()?;
            let (user_name, user_email, group_id, group_name) = user_map
                .get(&user_uuid)
                .cloned()
                .unwrap_or(("—".to_string(), None, None, "—".to_string()));
            let symbol = m.get("symbol").cloned().unwrap_or_else(|| "—".to_string());
            let side = m.get("side").cloned().unwrap_or_else(|| "LONG".to_string());
            let size: f64 = m.get("size").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let entry_price: f64 = m.get("entry_price").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let avg_price: f64 = m.get("avg_price").and_then(|s| s.parse().ok()).unwrap_or(entry_price);
            let leverage: i32 = m.get("leverage").and_then(|s| s.parse().ok()).unwrap_or(1);
            let margin: f64 = m.get("margin").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let unrealized_pnl: f64 = m.get("unrealized_pnl").and_then(|s| s.parse().ok()).unwrap_or(0.0);
            let sl: Option<f64> = m.get("sl").and_then(|s| s.parse().ok());
            let tp: Option<f64> = m.get("tp").and_then(|s| s.parse().ok());
            let opened_at_ms: i64 = m.get("opened_at").and_then(|s| s.parse().ok()).unwrap_or(0);
            let updated_at_ms: i64 = m.get("updated_at").and_then(|s| s.parse().ok()).unwrap_or(0);
            let opened_at = format_ts_ms(opened_at_ms);
            let last_updated_at = format_ts_ms(updated_at_ms);
            let pnl_pct = if margin > 0.0 {
                (unrealized_pnl / margin) * 100.0
            } else {
                0.0
            };
            Some(AdminPosition {
                id: id.clone(),
                user_id,
                user_name,
                user_email,
                group_id: group_id.map(|u| u.to_string()).unwrap_or_else(|| "—".to_string()),
                group_name,
                symbol_id: symbol.clone(),
                symbol,
                side,
                size,
                entry_price,
                mark_price: avg_price,
                leverage,
                margin_used: margin,
                margin_available: None,
                liquidation_price: 0.0,
                pnl: unrealized_pnl,
                pnl_percent: pnl_pct,
                status: "OPEN".to_string(),
                stop_loss: sl,
                take_profit: tp,
                opened_at,
                closed_at: None,
                last_updated_at,
            })
        })
        .collect();

    let total = items.len() as i64;
    info!("Admin positions API: returning {} items (total={})", items.len(), total);

    Ok(Json(PaginatedResponse {
        items,
        cursor: None,
        has_more: false,
        total: Some(total),
    }))
}

fn format_ts_ms(ms: i64) -> String {
    if ms <= 0 {
        return "—".to_string();
    }
    let secs = ms / 1000;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    match DateTime::from_timestamp(secs, nsecs) {
        Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => "—".to_string(),
    }
}

async fn close_admin_position(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(position_id): Path<Uuid>,
    Json(req): Json<ClosePositionRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&_pool, &claims, "trading:close_position")
        .await
        .map_err(permission_denied_to_response)?;

    let mut conn = admin_state.redis.get().await.map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "REDIS_ERROR".to_string(),
                    message: "Cache unavailable".to_string(),
                },
            }),
        )
    })?;

    let pos_key = Keys::position_by_id(position_id);
    let pos_data: HashMap<String, String> = conn.hgetall(&pos_key).await.map_err(|e| {
        error!("Admin close position: Redis HGETALL failed for {}: {}", position_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "REDIS_ERROR".to_string(),
                    message: "Failed to read position".to_string(),
                },
            }),
        )
    })?;

    if pos_data.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Position not found".to_string(),
                },
            }),
        ));
    }

    let user_id_str = pos_data.get("user_id").cloned().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_POSITION".to_string(),
                    message: "Position missing user_id".to_string(),
                },
            }),
        )
    })?;

    let status = pos_data.get("status").map(|s| s.as_str()).unwrap_or("");
    if !status.eq_ignore_ascii_case("OPEN") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "POSITION_NOT_OPEN".to_string(),
                    message: format!("Position is not open (status: {})", status),
                },
            }),
        ));
    }

    let now = Utc::now();
    let correlation_id = Uuid::new_v4().to_string();
    let close_size_str = req.size.map(|s| s.to_string());
    let cmd = serde_json::json!({
        "position_id": position_id.to_string(),
        "user_id": user_id_str,
        "size": close_size_str,
        "correlation_id": correlation_id,
        "ts": now.to_rfc3339(),
    });

    if let Err(e) = admin_state
        .nats
        .publish("cmd.position.close".to_string(), cmd.to_string().into())
        .await
    {
        error!("Admin close position: failed to publish cmd.position.close: {}", e);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NATS_ERROR".to_string(),
                    message: "Failed to send close command".to_string(),
                },
            }),
        ));
    }
    info!(
        "Admin close position: published cmd.position.close position_id={}, user_id={}, size={:?}",
        position_id, user_id_str, req.size
    );

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
    Ok(StatusCode::NO_CONTENT)
}

async fn modify_position_sltp(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(position_id): Path<Uuid>,
    Json(req): Json<ModifySltpRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "trading:view")
        .await
        .map_err(permission_denied_to_response)?;
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

