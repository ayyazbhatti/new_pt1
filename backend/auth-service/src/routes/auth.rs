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

pub fn create_auth_router(pool: PgPool) -> Router<PgPool> {
    // Public routes (no auth required)
    let public_routes = Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh));
    
    // Protected routes (auth required)
    let protected_routes = Router::new()
        .route("/logout", post(logout))
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
            // Fetch group name if user has a group
            let group_name: Option<String> = if let Some(group_id) = user.group_id {
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
            // Fetch group names for all users
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

