use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::models::leverage_profile::LeverageProfileTier;
use crate::services::auth_service::AuthService;
use crate::utils::jwt::Claims;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub password: String,
    pub country: Option<String>,
    pub referral_code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_login_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_leverage: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_leverage: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leverage_profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_positions_count: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    pub access_token: String,
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

#[derive(Debug, Deserialize)]
pub struct SymbolLeverageQuery {
    pub symbol_code: String,
}

#[derive(Debug, Serialize)]
pub struct SymbolLeverageResponse {
    pub leverage_profile_name: Option<String>,
    pub leverage_profile_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tiers: Option<Vec<LeverageProfileTier>>,
}

pub fn create_auth_router(pool: PgPool) -> Router<PgPool> {
    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh));
    
    // Protected routes (auth required) – more specific /me/symbol-leverage before /me
    let protected_routes = Router::new()
        .route("/logout", post(logout))
        .route("/me/symbol-leverage", get(symbol_leverage))
        .route("/me", get(me))
        .route("/users", get(list_users))
        .layer(axum::middleware::from_fn(auth_middleware));
    
    // Combine both route groups
    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .with_state(pool)
}

async fn register(
    State(pool): State<PgPool>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let service = AuthService::new(pool);

    match service
        .register(
            &payload.first_name,
            &payload.last_name,
            &payload.email,
            &payload.password,
            payload.country.as_deref(),
            payload.referral_code.as_deref(),
        )
        .await
    {
        Ok((user, access_token, refresh_token)) => Ok(Json(AuthResponse {
            access_token,
            refresh_token,
            user: UserResponse {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                status: user.status.into(),
                phone: user.phone.clone(),
                country: user.country.clone(),
                created_at: Some(user.created_at),
                last_login_at: user.last_login_at,
                referral_code: user.referral_code.clone(),
                group_id: user.group_id,
                group_name: None, // Will be populated if needed
                min_leverage: user.min_leverage,
                max_leverage: user.max_leverage,
                price_profile_name: None,
                leverage_profile_name: None,
                account_type: user.account_type.or_else(|| Some("hedging".to_string())),
                open_positions_count: None,
            },
        })),
        Err(e) => {
            let code = if e.to_string().contains("already registered") {
                "EMAIL_EXISTS"
            } else if e.to_string().contains("Password") {
                "INVALID_PASSWORD"
            } else {
                "REGISTRATION_FAILED"
            };
            Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: code.to_string(),
                        message: e.to_string(),
                    },
                }),
            ))
        }
    }
}

async fn login(
    State(pool): State<PgPool>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let service = AuthService::new(pool);

    // Extract user agent and IP
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok());
    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|h| h.to_str().ok());

    match service
        .login(&payload.email, &payload.password, user_agent, ip.as_deref())
        .await
    {
        Ok((user, access_token, refresh_token)) => Ok(Json(AuthResponse {
            access_token,
            refresh_token,
            user: UserResponse {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                status: user.status.into(),
                phone: user.phone.clone(),
                country: user.country.clone(),
                created_at: Some(user.created_at),
                last_login_at: user.last_login_at,
                referral_code: user.referral_code.clone(),
                group_id: user.group_id,
                group_name: None, // Will be populated if needed
                min_leverage: user.min_leverage,
                max_leverage: user.max_leverage,
                price_profile_name: None,
                leverage_profile_name: None,
                account_type: user.account_type.or_else(|| Some("hedging".to_string())),
                open_positions_count: None,
            },
        })),
        Err(e) => Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_CREDENTIALS".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn refresh(
    State(pool): State<PgPool>,
    Json(payload): Json<RefreshRequest>,
) -> Result<Json<RefreshResponse>, (StatusCode, Json<ErrorResponse>)> {
    let service = AuthService::new(pool);

    match service.refresh(&payload.refresh_token).await {
        Ok(access_token) => Ok(Json(RefreshResponse { access_token })),
        Err(e) => Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_REFRESH_TOKEN".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn logout(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Json(payload): Json<LogoutRequest>,
) -> Result<axum::http::StatusCode, (StatusCode, Json<ErrorResponse>)> {

    let service = AuthService::new(pool);

    match service.logout(claims.sub, &payload.refresh_token).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LOGOUT_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn me(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
) -> Result<Json<UserResponse>, (StatusCode, Json<ErrorResponse>)> {

    let service = AuthService::new(pool.clone());

    match service.get_user_by_id(claims.sub).await {
        Ok(user) => {
            // Fetch group name and profile names if user has a group
            let (group_name, price_profile_name, leverage_profile_name): (Option<String>, Option<String>, Option<String>) =
                if let Some(group_id) = user.group_id {
                    #[derive(sqlx::FromRow)]
                    struct GroupProfileRow {
                        group_name: Option<String>,
                        price_profile_name: Option<String>,
                        leverage_profile_name: Option<String>,
                    }
                    let row = sqlx::query_as::<_, GroupProfileRow>(
                        r#"
                        SELECT ug.name AS group_name, psp.name AS price_profile_name, lp.name AS leverage_profile_name
                        FROM user_groups ug
                        LEFT JOIN price_stream_profiles psp ON ug.default_price_profile_id = psp.id
                        LEFT JOIN leverage_profiles lp ON ug.default_leverage_profile_id = lp.id
                        WHERE ug.id = $1
                        "#,
                    )
                    .bind(group_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten();
                    (
                        row.as_ref().and_then(|r| r.group_name.clone()),
                        row.as_ref().and_then(|r| r.price_profile_name.clone()),
                        row.as_ref().and_then(|r| r.leverage_profile_name.clone()),
                    )
                } else {
                    (None, None, None)
                };

            Ok(Json(UserResponse {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role,
                status: user.status.into(),
                phone: user.phone,
                country: user.country,
                created_at: Some(user.created_at),
                last_login_at: user.last_login_at,
                referral_code: user.referral_code,
                group_id: user.group_id,
                group_name,
                min_leverage: user.min_leverage,
                max_leverage: user.max_leverage,
                price_profile_name,
                leverage_profile_name,
                account_type: user.account_type.or_else(|| Some("hedging".to_string())),
                open_positions_count: None,
            }))
        },
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "USER_NOT_FOUND".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

async fn symbol_leverage(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    Query(params): Query<SymbolLeverageQuery>,
) -> Result<Json<SymbolLeverageResponse>, (StatusCode, Json<ErrorResponse>)> {
    let symbol_code = params.symbol_code.trim();
    if symbol_code.is_empty() {
        return Ok(Json(SymbolLeverageResponse {
            leverage_profile_name: None,
            leverage_profile_id: None,
            tiers: None,
        }));
    }

    #[derive(sqlx::FromRow)]
    struct Row {
        leverage_profile_id: Option<Uuid>,
        leverage_profile_name: Option<String>,
    }

    // Case-insensitive symbol match; COALESCE gives per-symbol override else group default
    let row = sqlx::query_as::<_, Row>(
        r#"
        SELECT
            COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id) AS leverage_profile_id,
            (SELECT lp2.name FROM leverage_profiles lp2 WHERE lp2.id = COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id)) AS leverage_profile_name
        FROM users u
        INNER JOIN user_groups ug ON ug.id = u.group_id
        INNER JOIN symbols s ON LOWER(TRIM(s.code)) = LOWER(TRIM($2))
        LEFT JOIN group_symbols gs ON gs.symbol_id = s.id AND gs.group_id = ug.id
        WHERE u.id = $1
        "#,
    )
    .bind(claims.sub)
    .bind(symbol_code)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "SYMBOL_LEVERAGE_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let profile_id = row.as_ref().and_then(|r| r.leverage_profile_id);
    let tiers: Option<Vec<LeverageProfileTier>> = match profile_id {
        Some(pid) => {
            let tiers_result = sqlx::query_as::<_, LeverageProfileTier>(
                r#"
                SELECT id, profile_id, tier_index,
                    notional_from::text AS notional_from, notional_to::text AS notional_to,
                    max_leverage, initial_margin_percent::text AS initial_margin_percent,
                    maintenance_margin_percent::text AS maintenance_margin_percent,
                    created_at, updated_at
                FROM leverage_profile_tiers
                WHERE profile_id = $1
                ORDER BY tier_index ASC
                "#,
            )
            .bind(pid)
            .fetch_all(&pool)
            .await;
            tiers_result.ok()
        }
        None => None,
    };

    Ok(Json(SymbolLeverageResponse {
        leverage_profile_name: row.as_ref().and_then(|r| r.leverage_profile_name.clone()),
        leverage_profile_id: profile_id,
        tiers,
    }))
}

async fn list_users(
    State(pool): State<PgPool>,
    axum::extract::Extension(claims): axum::extract::Extension<Claims>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<UserResponse>>, (StatusCode, Json<ErrorResponse>)> {
    // Only admins can list users
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can list users".to_string(),
                },
            }),
        ));
    }

    let service = AuthService::new(pool.clone());

    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok());
    let offset = params
        .get("offset")
        .and_then(|s| s.parse::<i64>().ok());

    match service.list_users(limit, offset).await {
        Ok(users) => {
            let user_ids: Vec<Uuid> = users.iter().map(|u| u.id).collect();
            // Batch query: open position count per user (positions table, status = 'open')
            let open_counts: std::collections::HashMap<Uuid, i32> = if user_ids.is_empty() {
                std::collections::HashMap::new()
            } else {
                #[derive(sqlx::FromRow)]
                struct PosCountRow {
                    user_id: Uuid,
                    count: i64,
                }
                let rows = sqlx::query_as::<_, PosCountRow>(
                    "SELECT user_id, COUNT(*) AS count FROM positions WHERE status = 'open'::position_status AND user_id = ANY($1) GROUP BY user_id",
                )
                .bind(&user_ids)
                .fetch_all(&pool)
                .await
                .unwrap_or_default();
                rows.into_iter()
                    .map(|r| (r.user_id, r.count as i32))
                    .collect()
            };

            let mut user_responses: Vec<UserResponse> = Vec::new();
            for u in users {
                let group_name: Option<String> = if let Some(group_id) = u.group_id {
                    sqlx::query_scalar::<_, String>(
                        "SELECT name FROM user_groups WHERE id = $1"
                    )
                    .bind(group_id)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten()
                } else {
                    None
                };

                let account_type = u
                    .account_type
                    .filter(|s| s == "hedging" || s == "netting")
                    .or_else(|| Some("hedging".to_string()));
                let open_positions_count = open_counts.get(&u.id).copied();

                user_responses.push(UserResponse {
                    id: u.id,
                    email: u.email,
                    first_name: u.first_name,
                    last_name: u.last_name,
                    role: u.role,
                    status: u.status.into(),
                    phone: u.phone,
                    country: u.country,
                    created_at: Some(u.created_at),
                    last_login_at: u.last_login_at,
                    referral_code: u.referral_code,
                    group_id: u.group_id,
                    group_name,
                    min_leverage: u.min_leverage,
                    max_leverage: u.max_leverage,
                    price_profile_name: None,
                    leverage_profile_name: None,
                    account_type,
                    open_positions_count,
                });
            }
            Ok(Json(user_responses))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "LIST_USERS_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )),
    }
}

