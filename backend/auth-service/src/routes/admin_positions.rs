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
use rust_decimal::Decimal;
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use tracing::{error, info};
use uuid::Uuid;

use crate::utils::jwt::Claims;
use crate::middleware::auth_middleware;
use crate::utils::permission_check;
use crate::routes::admin_trading::{AdminTradingState, AdminPosition, PaginatedResponse, ListPositionsQuery, ClosePositionRequest, ModifySltpRequest, ReopenWithParamsRequest, UpdatePositionParamsRequest, ErrorResponse, ErrorDetail};
use crate::routes::deposits::get_price_from_redis_conn;
use crate::routes::scoped_access;
use redis_model::keys::Keys;
use std::str::FromStr;

const POS_BY_ID_PREFIX: &str = "pos:by_id:";

async fn list_closed_positions_admin(
    pool: &PgPool,
    params: &ListPositionsQuery,
    allowed_user_ids: &Option<Vec<Uuid>>,
) -> Result<Json<PaginatedResponse<AdminPosition>>, (StatusCode, Json<ErrorResponse>)> {
    let limit = params.limit.unwrap_or(50).min(500);
    let offset = params
        .cursor
        .as_ref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0);
    let search_pat = params.search.as_ref().map(|s| format!("%{}%", s));

    let total_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::bigint FROM positions p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN symbols s ON p.symbol_id = s.id
        WHERE p.status IN ('closed', 'liquidated')
        AND ($1::text IS NULL OR s.code = $1)
        AND ($2::text IS NULL OR p.user_id::text = $2)
        AND ($3::text IS NULL OR u.group_id::text = $3)
        AND ($4::text IS NULL OR (
            s.code ILIKE $4 OR COALESCE(u.email, '') ILIKE $4
            OR COALESCE(u.first_name, '') ILIKE $4 OR COALESCE(u.last_name, '') ILIKE $4
        ))
        AND ($5::uuid[] IS NULL OR p.user_id = ANY($5))
        "#,
    )
    .bind(params.symbol.as_deref())
    .bind(params.user_id.as_deref())
    .bind(params.group_id.as_deref())
    .bind(search_pat.as_deref())
    .bind(allowed_user_ids.as_deref())
    .fetch_one(pool)
    .await
    .map_err(|e| {
        error!("Admin closed positions count: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to list position history".to_string(),
                },
            }),
        )
    })?;

    let rows = sqlx::query(
        r#"
        SELECT
            p.id,
            p.user_id,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) as user_name,
            u.email as user_email,
            COALESCE(ug.id::text, '') as group_id,
            COALESCE(ug.name, '') as group_name,
            p.symbol_id::text as symbol_id,
            s.code as symbol,
            p.side::text as side,
            p.size,
            p.entry_price,
            p.mark_price,
            p.leverage,
            p.margin_used,
            p.liquidation_price,
            p.pnl,
            p.pnl_percent,
            p.status::text as status,
            p.opened_at,
            p.closed_at,
            p.updated_at
        FROM positions p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN user_groups ug ON u.group_id = ug.id
        LEFT JOIN symbols s ON p.symbol_id = s.id
        WHERE p.status IN ('closed', 'liquidated')
        AND ($1::text IS NULL OR s.code = $1)
        AND ($2::text IS NULL OR p.user_id::text = $2)
        AND ($3::text IS NULL OR u.group_id::text = $3)
        AND ($4::text IS NULL OR (
            s.code ILIKE $4 OR COALESCE(u.email, '') ILIKE $4
            OR COALESCE(u.first_name, '') ILIKE $4 OR COALESCE(u.last_name, '') ILIKE $4
        ))
        AND ($5::uuid[] IS NULL OR p.user_id = ANY($5))
        ORDER BY COALESCE(p.closed_at, p.updated_at) DESC NULLS LAST
        LIMIT $6 OFFSET $7
        "#,
    )
    .bind(params.symbol.as_deref())
    .bind(params.user_id.as_deref())
    .bind(params.group_id.as_deref())
    .bind(search_pat.as_deref())
    .bind(allowed_user_ids.as_deref())
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        error!("Admin closed positions list: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to list position history".to_string(),
                },
            }),
        )
    })?;

    let items: Vec<AdminPosition> = rows
        .into_iter()
        .filter_map(|row| {
            let id: Uuid = row.try_get(0).ok()?;
            let user_id: Uuid = row.try_get(1).ok()?;
            let size: Decimal = row.try_get(9).unwrap_or(Decimal::ZERO);
            let entry: Decimal = row.try_get(10).unwrap_or(Decimal::ZERO);
            let mark: Decimal = row.try_get(11).unwrap_or(Decimal::ZERO);
            let margin: Decimal = row.try_get(13).unwrap_or(Decimal::ZERO);
            let liq: Decimal = row.try_get(14).unwrap_or(Decimal::ZERO);
            let pnl: Decimal = row.try_get(15).unwrap_or(Decimal::ZERO);
            let pnl_pct: Decimal = row.try_get(16).unwrap_or(Decimal::ZERO);
            Some(AdminPosition {
                id: id.to_string(),
                user_id: user_id.to_string(),
                user_name: row.try_get(2).unwrap_or_else(|_| "—".to_string()),
                user_email: row.try_get(3).ok(),
                group_id: row.try_get(4).unwrap_or_else(|_| "—".to_string()),
                group_name: row.try_get(5).unwrap_or_else(|_| "—".to_string()),
                symbol_id: row.try_get(6).unwrap_or_else(|_| "—".to_string()),
                symbol: row.try_get(7).unwrap_or_else(|_| "—".to_string()),
                side: row.try_get(8).unwrap_or_else(|_| "LONG".to_string()),
                size: size.to_string().parse().unwrap_or(0.0),
                entry_price: entry.to_string().parse().unwrap_or(0.0),
                mark_price: mark.to_string().parse().unwrap_or(0.0),
                leverage: row.try_get(12).unwrap_or(1),
                margin_used: margin.to_string().parse().unwrap_or(0.0),
                margin_available: None,
                liquidation_price: liq.to_string().parse().unwrap_or(0.0),
                pnl: pnl.to_string().parse().unwrap_or(0.0),
                pnl_percent: pnl_pct.to_string().parse().unwrap_or(0.0),
                status: row.try_get(17).unwrap_or_else(|_| "closed".to_string()),
                stop_loss: None,
                take_profit: None,
                opened_at: row
                    .try_get::<chrono::DateTime<Utc>, _>(18)
                    .map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|_| "—".to_string()),
                closed_at: row
                    .try_get::<Option<chrono::DateTime<Utc>>, _>(19)
                    .ok()
                    .flatten()
                    .map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string()),
                last_updated_at: row
                    .try_get::<chrono::DateTime<Utc>, _>(20)
                    .map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_else(|_| "—".to_string()),
            })
        })
        .collect();

    let total = total_count.0;
    let has_more = offset + (items.len() as i64) < total;
    let next_cursor = if has_more {
        Some((offset + limit).to_string())
    } else {
        None
    };

    Ok(Json(PaginatedResponse {
        items,
        cursor: next_cursor,
        has_more,
        total: Some(total),
        total_margin_used: None,
        total_unrealized_pnl: None,
    }))
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

    if params
        .status
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("closed"))
        .unwrap_or(false)
    {
        return list_closed_positions_admin(&pool, &params, &allowed_user_ids).await;
    }

    let limit = params.limit.unwrap_or(50).min(500);
    let offset = params.cursor.and_then(|c| c.parse::<i64>().ok()).unwrap_or(0);

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

    let mut keyed: Vec<(i64, AdminPosition)> = open_positions
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
            let gid_str = group_id.map(|u| u.to_string()).unwrap_or_else(|| "—".to_string());
            Some((
                opened_at_ms,
                AdminPosition {
                    id: id.clone(),
                    user_id,
                    user_name,
                    user_email,
                    group_id: gid_str.clone(),
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
                },
            ))
        })
        .collect();

    if let Some(ref gid) = params.group_id {
        keyed.retain(|(_, p)| p.group_id == *gid);
    }
    if let Some(ref q) = params.search {
        let s = q.to_lowercase();
        keyed.retain(|(_, p)| {
            p.symbol.to_lowercase().contains(&s)
                || p.user_name.to_lowercase().contains(&s)
                || p
                    .user_email
                    .as_ref()
                    .map(|e| e.to_lowercase().contains(&s))
                    .unwrap_or(false)
        });
    }

    keyed.sort_by(|a, b| b.0.cmp(&a.0));
    let total = keyed.len() as i64;
    let total_margin_used: f64 = keyed.iter().map(|(_, p)| p.margin_used).sum();

    // Compute unrealized PnL from current Redis prices (no polling: prices written by order-engine on each tick)
    let mut price_cache: HashMap<(String, String), (Decimal, Decimal)> = HashMap::new();
    let mut total_unrealized_pnl: f64 = 0.0;
    for (_, p) in keyed.iter_mut() {
        let key = (p.symbol.clone(), p.group_id.clone());
        let (bid, ask) = if let Some(&(b, a)) = price_cache.get(&key) {
            (b, a)
        } else {
            match get_price_from_redis_conn(&mut conn, &p.symbol, &p.group_id).await {
                Some((b, a)) => {
                    price_cache.insert(key.clone(), (b, a));
                    (b, a)
                }
                None => continue,
            }
        };
        let mark = (bid + ask) / Decimal::from(2);
        let size = Decimal::from_str(&p.size.to_string()).unwrap_or(Decimal::ZERO);
        let entry = Decimal::from_str(&p.entry_price.to_string()).unwrap_or(Decimal::ZERO);
        let pnl_decimal = match p.side.as_str() {
            "LONG" => (mark - entry) * size,
            "SHORT" => (entry - mark) * size,
            _ => Decimal::ZERO,
        };
        let pnl_f64: f64 = pnl_decimal.to_string().parse().unwrap_or(0.0);
        total_unrealized_pnl += pnl_f64;
        p.pnl = pnl_f64;
        p.pnl_percent = if p.margin_used > 0.0 {
            (pnl_f64 / p.margin_used) * 100.0
        } else {
            0.0
        };
    }

    let page_items: Vec<AdminPosition> = keyed
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|(_, p)| p)
        .collect();

    let has_more = offset + (page_items.len() as i64) < total;
    let next_cursor = if has_more {
        Some((offset + limit).to_string())
    } else {
        None
    };

    info!(
        "Admin positions API: page {} items, total open={}",
        page_items.len(),
        total
    );

    Ok(Json(PaginatedResponse {
        items: page_items,
        cursor: next_cursor,
        has_more,
        total: Some(total),
        total_margin_used: Some(total_margin_used),
        total_unrealized_pnl: Some(total_unrealized_pnl),
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

/// Re-open a closed position by restoring the same position record to OPEN (no new order).
/// Order-engine handles cmd.position.reopen and runs atomic_reopen_position Lua.
async fn reopen_admin_position(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(position_id): Path<Uuid>,
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
        error!("Admin reopen position: Redis HGETALL failed for {}: {}", position_id, e);
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

    let status = pos_data.get("status").map(|s| s.as_str()).unwrap_or("");
    if !status.eq_ignore_ascii_case("CLOSED") && !status.eq_ignore_ascii_case("LIQUIDATED") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "POSITION_NOT_CLOSED".to_string(),
                    message: format!("Position is not closed (status: {}). Only closed or liquidated positions can be re-opened.", status),
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
    let _user_id = Uuid::parse_str(&user_id_str).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_POSITION".to_string(),
                    message: "Invalid user_id on position".to_string(),
                },
            }),
        )
    })?;

    let original_size = pos_data
        .get("original_size")
        .or_else(|| pos_data.get("size"))
        .cloned()
        .unwrap_or_default();
    if original_size.parse::<f64>().unwrap_or(0.0) <= 0.0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "CANNOT_REOPEN".to_string(),
                    message: "Cannot re-open: original size unknown or zero.".to_string(),
                },
            }),
        ));
    }

    let cmd = serde_json::json!({
        "position_id": position_id.to_string(),
        "user_id": user_id_str,
    });
    let payload = serde_json::to_vec(&cmd).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize reopen command".to_string(),
                },
            }),
        )
    })?;

    admin_state
        .nats
        .publish("cmd.position.reopen".to_string(), payload.into())
        .await
        .map_err(|e| {
            error!("Admin reopen: NATS publish failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NATS_ERROR".to_string(),
                        message: "Failed to send reopen command".to_string(),
                    },
                }),
            )
        })?;

    info!(
        "Re-open position: published cmd.position.reopen, position_id={}, user_id={} (same record restore)",
        position_id, user_id_str
    );
    Ok(StatusCode::NO_CONTENT)
}

/// Re-open the same closed position with edited fields (size, entry_price, side, sl, tp). No new order/position.
async fn reopen_admin_position_with_params(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(position_id): Path<Uuid>,
    Json(req): Json<ReopenWithParamsRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&_pool, &claims, "trading:create_order")
        .await
        .map_err(permission_denied_to_response)?;

    if req.size <= 0.0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_SIZE".to_string(),
                    message: "size must be greater than 0".to_string(),
                },
            }),
        ));
    }

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
        error!("Admin reopen_with_params: Redis HGETALL failed for {}: {}", position_id, e);
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

    let status = pos_data.get("status").map(|s| s.as_str()).unwrap_or("");
    if !status.eq_ignore_ascii_case("CLOSED") && !status.eq_ignore_ascii_case("LIQUIDATED") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "POSITION_NOT_CLOSED".to_string(),
                    message: format!("Position is not closed (status: {}). Only closed or liquidated positions can be re-opened with params.", status),
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

    let side_value = req
        .side
        .as_ref()
        .map(|s| {
            let u = s.to_uppercase();
            if u == "SELL" || u == "SHORT" {
                "SHORT"
            } else {
                "LONG"
            }
        });

    let cmd = serde_json::json!({
        "position_id": position_id.to_string(),
        "user_id": user_id_str,
        "size": req.size,
        "entry_price": req.entry_price,
        "side": side_value,
        "stop_loss": req.stop_loss,
        "take_profit": req.take_profit,
    });
    let payload = serde_json::to_vec(&cmd).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize reopen_with_params command".to_string(),
                },
            }),
        )
    })?;

    admin_state
        .nats
        .publish("cmd.position.reopen_with_params".to_string(), payload.into())
        .await
        .map_err(|e| {
            error!("Admin reopen_with_params: NATS publish failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NATS_ERROR".to_string(),
                        message: "Failed to send reopen_with_params command".to_string(),
                    },
                }),
            )
        })?;

    info!(
        "Re-open with params: published cmd.position.reopen_with_params, position_id={}, user_id={}",
        position_id, user_id_str
    );
    Ok(StatusCode::NO_CONTENT)
}

/// Update an open position's size, entry_price, stop_loss, take_profit (Redis via order-engine).
async fn update_admin_position_params(
    State(_pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(admin_state): Extension<AdminTradingState>,
    Path(position_id): Path<Uuid>,
    Json(req): Json<UpdatePositionParamsRequest>,
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
        error!("Admin update_params: Redis HGETALL failed for {}: {}", position_id, e);
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

    let status = pos_data.get("status").map(|s| s.as_str()).unwrap_or("");
    if !status.eq_ignore_ascii_case("OPEN") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "POSITION_NOT_OPEN".to_string(),
                    message: format!("Position is not open (status: {}). Only open positions can be updated.", status),
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

    if req.size.map(|s| s <= 0.0).unwrap_or(false) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_SIZE".to_string(),
                    message: "size must be greater than 0".to_string(),
                },
            }),
        ));
    }

    let cmd = serde_json::json!({
        "position_id": position_id.to_string(),
        "user_id": user_id_str,
        "size": req.size,
        "entry_price": req.entry_price,
        "stop_loss": req.stop_loss,
        "take_profit": req.take_profit,
    });
    let payload = serde_json::to_vec(&cmd).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INTERNAL_ERROR".to_string(),
                    message: "Failed to serialize update_params command".to_string(),
                },
            }),
        )
    })?;

    admin_state
        .nats
        .publish("cmd.position.update_params".to_string(), payload.into())
        .await
        .map_err(|e| {
            error!("Admin update_params: NATS publish failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NATS_ERROR".to_string(),
                        message: "Failed to send update_params command".to_string(),
                    },
                }),
            )
        })?;

    info!(
        "Update position params: published cmd.position.update_params, position_id={}, user_id={}",
        position_id, user_id_str
    );
    Ok(StatusCode::NO_CONTENT)
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
        .route("/:id/reopen", post(reopen_admin_position))
        .route("/:id/reopen-with-params", post(reopen_admin_position_with_params))
        .route("/:id/update-params", post(update_admin_position_params))
        .layer(axum::middleware::from_fn_with_state(
            pool.clone(),
            auth_middleware,
        ))
        .layer(axum::Extension(admin_state))
        .with_state(pool)
}

