//! Admin bulk operations: config and bulk user creation (sync).
//! See docs/BULK_OPERATIONS_DYNAMIC_SPEC.md.

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Extension,
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;

// ---------- Config (static, matches spec §3.1) ----------

#[derive(Debug, Serialize)]
pub struct BulkUserCreationFields {
    pub count: FieldRule,
    pub username_prefix: FieldRule,
    pub email_domain: FieldRule,
    pub password: PasswordFieldRule,
    pub first_name_prefix: FieldRule,
    pub last_name: FieldRule,
    pub starting_number: FieldRule,
    pub group_id: FieldRuleOptional,
    pub account_mode: FieldRuleEnum,
    #[serde(rename = "initial_balance")]
    pub initial_balance: InitialBalanceFields,
}

#[derive(Debug, Serialize)]
pub struct FieldRule {
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct PasswordFieldRule {
    pub required: bool,
    pub min_length: u32,
    pub require_digit: bool,
}

#[derive(Debug, Serialize)]
pub struct FieldRuleOptional {
    pub required: bool,
}

#[derive(Debug, Serialize)]
pub struct FieldRuleEnum {
    pub required: bool,
    pub r#enum: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct InitialBalanceFields {
    pub enabled: FieldRuleOptional,
    pub amount: FieldRule,
    pub fee: FieldRule,
    pub reference: FieldRule,
}

#[derive(Debug, Serialize)]
pub struct BulkUserCreationConfig {
    pub enabled: bool,
    pub max_users_per_run: u32,
    pub max_users_per_run_per_admin_per_day: u32,
    pub batch_size: u32,
    pub async_threshold: u32,
    pub fields: BulkUserCreationFields,
    pub defaults: BulkConfigDefaults,
}

#[derive(Debug, Serialize)]
pub struct BulkConfigDefaults {
    pub first_name_prefix: String,
    pub last_name: String,
    pub starting_number: i32,
    pub account_mode: String,
}

#[derive(Debug, Serialize)]
pub struct BulkConfigResponse {
    pub bulk_user_creation: BulkUserCreationConfig,
}

fn bulk_config() -> BulkConfigResponse {
    BulkConfigResponse {
        bulk_user_creation: BulkUserCreationConfig {
            enabled: true,
            max_users_per_run: 100_000,
            max_users_per_run_per_admin_per_day: 50_000,
            batch_size: 250,
            async_threshold: 50_000,
            fields: BulkUserCreationFields {
                count: FieldRule {
                    required: true,
                    min: Some(1),
                    max: Some(100_000),
                    max_length: None,
                },
                username_prefix: FieldRule {
                    required: true,
                    min: None,
                    max: None,
                    max_length: Some(50),
                },
                email_domain: FieldRule {
                    required: true,
                    min: None,
                    max: None,
                    max_length: Some(253),
                },
                password: PasswordFieldRule {
                    required: true,
                    min_length: 8,
                    require_digit: true,
                },
                first_name_prefix: FieldRule {
                    required: false,
                    min: None,
                    max: None,
                    max_length: Some(100),
                },
                last_name: FieldRule {
                    required: false,
                    min: None,
                    max: None,
                    max_length: Some(100),
                },
                starting_number: FieldRule {
                    required: false,
                    min: Some(1),
                    max: Some(999_999_999),
                    max_length: None,
                },
                group_id: FieldRuleOptional { required: false },
                account_mode: FieldRuleEnum {
                    required: false,
                    r#enum: vec!["netting".to_string(), "hedging".to_string()],
                },
                initial_balance: InitialBalanceFields {
                    enabled: FieldRuleOptional { required: false },
                    amount: FieldRule {
                        required: false,
                        min: Some(0),
                        max: None,
                        max_length: None,
                    },
                    fee: FieldRule {
                        required: false,
                        min: Some(0),
                        max: None,
                        max_length: None,
                    },
                    reference: FieldRule {
                        required: false,
                        min: None,
                        max: None,
                        max_length: Some(255),
                    },
                },
            },
            defaults: BulkConfigDefaults {
                first_name_prefix: "User".to_string(),
                last_name: "Test".to_string(),
                starting_number: 1,
                account_mode: "hedging".to_string(),
            },
        },
    }
}

// ---------- Request / Response ----------

#[derive(Debug, Deserialize)]
pub struct BulkCreateUsersRequest {
    pub count: u32,
    pub username_prefix: String,
    pub email_domain: String,
    pub password: String,
    pub first_name_prefix: Option<String>,
    pub last_name: Option<String>,
    pub starting_number: Option<i32>,
    pub group_id: Option<Uuid>,
    pub account_mode: Option<String>,
    #[serde(default)]
    pub initial_balance_enabled: bool,
    #[serde(default)]
    pub initial_balance_amount: Option<rust_decimal::Decimal>,
    #[serde(default)]
    pub initial_balance_fee: Option<rust_decimal::Decimal>,
    pub initial_balance_reference: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BulkUserResultRow {
    pub username: String,
    pub email: String,
    pub success: bool,
    pub user_id: Option<Uuid>,
    pub account_id: Option<Uuid>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BulkCreateUsersResponse {
    pub job_id: Option<Uuid>,
    pub sync: bool,
    pub total: u32,
    pub success_count: u32,
    pub failed_count: u32,
    pub results: Vec<BulkUserResultRow>,
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

// ---------- Handlers ----------

pub async fn get_bulk_health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true, "service": "admin/bulk" }))
}

pub async fn get_bulk_config(
    Extension(claims): Extension<Claims>,
) -> Result<Json<BulkConfigResponse>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can access bulk config".to_string(),
                },
            }),
        ));
    }
    Ok(Json(bulk_config()))
}

pub async fn post_bulk_users(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<BulkCreateUsersRequest>,
) -> Result<Json<BulkCreateUsersResponse>, (StatusCode, Json<ErrorResponse>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "FORBIDDEN".to_string(),
                    message: "Only admins can run bulk user creation".to_string(),
                },
            }),
        ));
    }

    let config = bulk_config().bulk_user_creation;

    // Validation (server-side, match config)
    if body.count == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: "Please enter a valid number of users to create".to_string(),
                },
            }),
        ));
    }
    if body.count > config.max_users_per_run {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: format!(
                        "Maximum {} users can be created at once",
                        config.max_users_per_run
                    ),
                },
            }),
        ));
    }
    let username_prefix = body.username_prefix.trim();
    if username_prefix.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: "Username prefix is required".to_string(),
                },
            }),
        ));
    }
    let email_domain = body.email_domain.trim();
    if email_domain.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: "Email domain is required".to_string(),
                },
            }),
        ));
    }
    if body.password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: "Password must be at least 8 characters".to_string(),
                },
            }),
        ));
    }
    if !body.password.chars().any(|c| c.is_ascii_digit()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "INVALID_INPUT".to_string(),
                    message: "Password must contain at least one number".to_string(),
                },
            }),
        ));
    }
    if body.initial_balance_enabled {
        let amt = body.initial_balance_amount.unwrap_or(rust_decimal::Decimal::ZERO);
        if amt <= rust_decimal::Decimal::ZERO {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_INPUT".to_string(),
                        message: "Initial balance amount must be greater than 0".to_string(),
                    },
                }),
            ));
        }
        let fee = body.initial_balance_fee.unwrap_or(rust_decimal::Decimal::ZERO);
        if fee > amt {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_INPUT".to_string(),
                        message: "Fee cannot exceed amount".to_string(),
                    },
                }),
            ));
        }
    }

    // Async threshold: for now we only implement sync. If count > threshold return 501 or run sync anyway with a cap.
    let run_sync = body.count <= config.async_threshold;
    if !run_sync {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "ASYNC_NOT_IMPLEMENTED".to_string(),
                    message: format!(
                        "Runs over {} users will use async jobs (coming soon). Please use {} or fewer for now.",
                        config.async_threshold, config.async_threshold
                    ),
                },
            }),
        ));
    }

    let first_name_prefix = body
        .first_name_prefix
        .as_deref()
        .unwrap_or(&config.defaults.first_name_prefix)
        .trim();
    let last_name = body
        .last_name
        .as_deref()
        .unwrap_or(&config.defaults.last_name)
        .trim();
    let starting_number = body.starting_number.unwrap_or(config.defaults.starting_number);
    let account_mode = body
        .account_mode
        .as_deref()
        .unwrap_or(&config.defaults.account_mode)
        .to_string();

    let auth_service = crate::services::auth_service::AuthService::new(pool.clone());
    let result = auth_service
        .bulk_create_users(
            body.count,
            username_prefix,
            email_domain,
            &body.password,
            first_name_prefix,
            last_name,
            starting_number,
            body.group_id,
            &account_mode,
            body.initial_balance_enabled,
            body.initial_balance_amount,
            body.initial_balance_fee,
            body.initial_balance_reference.as_deref(),
        )
        .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "BULK_CREATE_FAILED".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let results_cap = 500;
    let results: Vec<BulkUserResultRow> = result
        .results
        .into_iter()
        .take(results_cap)
        .map(|r| BulkUserResultRow {
            username: r.username,
            email: r.email,
            success: r.success,
            user_id: r.user_id,
            account_id: r.account_id,
            error: r.error,
        })
        .collect();

    Ok(Json(BulkCreateUsersResponse {
        job_id: None,
        sync: true,
        total: result.total,
        success_count: result.success_count,
        failed_count: result.failed_count,
        results,
    }))
}
