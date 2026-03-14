//! Admin KYC: list submissions, get detail, stream document, approve, reject.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::routes::kyc::KycUploadDir;
use crate::routes::scoped_access;
use crate::utils::jwt::Claims;
use crate::utils::permission_check;
use axum::Extension;

#[derive(Debug, Serialize)]
pub struct KycSubmissionRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_name: String,
    pub user_email: String,
    pub status: String,
    pub identity_doc_type: Option<String>,
    pub address_doc_type: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ListKycResponse {
    pub items: Vec<KycSubmissionRow>,
    pub total: i64,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListKycQuery {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub status: Option<String>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct KycSubmissionDetail {
    pub id: Uuid,
    pub user_id: Uuid,
    pub user_name: String,
    pub user_email: String,
    pub status: String,
    pub identity_doc_type: Option<String>,
    pub address_doc_type: Option<String>,
    pub rejection_reason: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub documents: Vec<KycDocumentRow>,
}

#[derive(Debug, Serialize)]
pub struct KycDocumentRow {
    pub id: Uuid,
    pub document_type: String,
    pub file_name: String,
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RejectKycRequest {
    pub rejection_reason: String,
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

fn scoped_err_to_response(e: (StatusCode, Json<scoped_access::ErrorResponse>)) -> (StatusCode, Json<ErrorResponse>) {
    (
        e.0,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: e.1.error.code.clone(),
                message: e.1.error.message.clone(),
            },
        }),
    )
}

pub fn create_admin_kyc_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(list_kyc))
        .route("/:id", get(get_kyc_submission))
        .route("/:id/approve", post(approve_kyc))
        .route("/:id/reject", post(reject_kyc))
        .route("/:submission_id/documents/:doc_id", get(stream_document))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn list_kyc(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<ListKycQuery>,
) -> Result<Json<ListKycResponse>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "kyc:view").await.map_err(permission_denied_to_response)?;

    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims).await.map_err(scoped_err_to_response)?;
    if let Some(ref ids) = allowed_user_ids {
        if ids.is_empty() {
            return Ok(Json(ListKycResponse {
                items: vec![],
                total: 0,
            }));
        }
    }

    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).min(100).max(1);
    let offset = (page - 1) * page_size;

    let status_filter = q.status.as_deref().filter(|s| !s.is_empty());
    let search = q.search.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());

    let count_sql = r#"
        SELECT COUNT(*)::bigint
        FROM kyc_submissions s
        JOIN users u ON u.id = s.user_id
        WHERE ($1::text IS NULL OR s.status = $1)
        AND ($2::text IS NULL OR u.email ILIKE '%' || $2 || '%' OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE '%' || $2 || '%')
        AND ($3::uuid[] IS NULL OR s.user_id = ANY($3))
    "#;
    let total: i64 = sqlx::query_scalar(count_sql)
        .bind(status_filter)
        .bind(search)
        .bind(allowed_user_ids.as_deref())
        .fetch_one(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let list_sql = r#"
        SELECT s.id, s.user_id, (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))::text AS user_name, u.email AS user_email,
               s.status, s.identity_doc_type, s.address_doc_type, s.submitted_at, s.reviewed_at
        FROM kyc_submissions s
        JOIN users u ON u.id = s.user_id
        WHERE ($1::text IS NULL OR s.status = $1)
        AND ($2::text IS NULL OR u.email ILIKE '%' || $2 || '%' OR (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) ILIKE '%' || $2 || '%')
        AND ($3::uuid[] IS NULL OR s.user_id = ANY($3))
        ORDER BY s.submitted_at DESC
        LIMIT $4 OFFSET $5
    "#;
    let rows = sqlx::query_as::<_, (Uuid, Uuid, String, String, String, Option<String>, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>)>(
        list_sql,
    )
    .bind(status_filter)
    .bind(search)
    .bind(allowed_user_ids.as_deref())
    .bind(page_size as i64)
    .bind(offset as i64)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let items = rows
        .into_iter()
        .map(
            |(id, user_id, user_name, user_email, status, identity_doc_type, address_doc_type, submitted_at, reviewed_at)| {
                KycSubmissionRow {
                    id,
                    user_id,
                    user_name,
                    user_email,
                    status,
                    identity_doc_type,
                    address_doc_type,
                    submitted_at,
                    reviewed_at,
                }
            },
        )
        .collect();

    Ok(Json(ListKycResponse { items, total }))
}

async fn get_kyc_submission(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<KycSubmissionDetail>, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "kyc:view").await.map_err(permission_denied_to_response)?;

    let row: Option<(
        Uuid,
        Uuid,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
        Option<DateTime<Utc>>,
    )> = sqlx::query_as(
        r#"
        SELECT s.id, s.user_id,
               TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_name,
               u.email, s.status,
               s.identity_doc_type, s.address_doc_type, s.rejection_reason, s.submitted_at, s.reviewed_at
        FROM kyc_submissions s
        JOIN users u ON u.id = s.user_id
        WHERE s.id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let Some((id, user_id, user_name, user_email, status, identity_doc_type, address_doc_type, rejection_reason, submitted_at, reviewed_at)) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Submission not found".to_string(),
                },
            }),
        ));
    };

    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims).await.map_err(scoped_err_to_response)?;
    if let Some(ref ids) = allowed_user_ids {
        if !ids.contains(&user_id) {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NOT_FOUND".to_string(),
                        message: "Submission not found".to_string(),
                    },
                }),
            ));
        }
    }

    let docs = sqlx::query_as::<_, (Uuid, String, String, Option<String>)>(
        "SELECT id, document_type, file_name, content_type FROM kyc_documents WHERE submission_id = $1 ORDER BY created_at",
    )
    .bind(id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let documents = docs
        .into_iter()
        .map(|(id, document_type, file_name, content_type)| KycDocumentRow {
            id,
            document_type,
            file_name,
            content_type,
        })
        .collect();

    Ok(Json(KycSubmissionDetail {
        id,
        user_id,
        user_name,
        user_email,
        status,
        identity_doc_type,
        address_doc_type,
        rejection_reason,
        submitted_at,
        reviewed_at,
        documents,
    }))
}

async fn stream_document(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(upload_dir): Extension<KycUploadDir>,
    Path((submission_id, doc_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::body::Bytes, (StatusCode, Json<ErrorResponse>)> {
    permission_check::check_permission(&pool, &claims, "kyc:view").await.map_err(permission_denied_to_response)?;

    let submission_user_id: Option<Uuid> = sqlx::query_scalar("SELECT user_id FROM kyc_submissions WHERE id = $1")
        .bind(submission_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;
    let Some(submission_user_id) = submission_user_id else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Submission not found".to_string(),
                },
            }),
        ));
    };
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims).await.map_err(scoped_err_to_response)?;
    if let Some(ref ids) = allowed_user_ids {
        if !ids.contains(&submission_user_id) {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NOT_FOUND".to_string(),
                        message: "Document not found".to_string(),
                    },
                }),
            ));
        }
    }

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT file_path FROM kyc_documents WHERE id = $1 AND submission_id = $2",
    )
    .bind(doc_id)
    .bind(submission_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    let Some((file_path,)) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Document not found".to_string(),
                },
            }),
        ));
    };

    let path = upload_dir.0.join(&file_path);
    if !path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "File not found".to_string(),
                },
            }),
        ));
    }
    let data = std::fs::read(&path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "IO_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;
    Ok(axum::body::Bytes::from(data))
}

async fn approve_kyc(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Require kyc:approve in profile (no bypass for admin; only super_admin bypasses)
    permission_check::check_permission_profile_only(&pool, &claims, "kyc:approve")
        .await
        .map_err(permission_denied_to_response)?;

    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT user_id, status FROM kyc_submissions WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let Some((submission_user_id, status)) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Submission not found".to_string(),
                },
            }),
        ));
    };
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims).await.map_err(scoped_err_to_response)?;
    if let Some(ref ids) = allowed_user_ids {
        if !ids.contains(&submission_user_id) {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NOT_FOUND".to_string(),
                        message: "Submission not found".to_string(),
                    },
                }),
            ));
        }
    }

    match status.as_str() {
        "pending" | "under_review" => {}
        "approved" => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "ALREADY_APPROVED".to_string(),
                        message: "Submission is already approved".to_string(),
                    },
                }),
            ));
        }
        "rejected" | "draft" | _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_STATUS".to_string(),
                        message: "Submission cannot be approved in current status".to_string(),
                    },
                }),
            ));
        }
    }

    sqlx::query(
        "UPDATE kyc_submissions SET status = 'approved', reviewed_at = now(), reviewed_by_id = $1, updated_at = now() WHERE id = $2",
    )
    .bind(claims.sub)
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

async fn reject_kyc(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(body): Json<RejectKycRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    // Require kyc:approve in profile (no bypass for admin; only super_admin bypasses)
    permission_check::check_permission_profile_only(&pool, &claims, "kyc:approve")
        .await
        .map_err(permission_denied_to_response)?;

    let reason = body.rejection_reason.trim();
    if reason.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "VALIDATION".to_string(),
                    message: "rejection_reason is required".to_string(),
                },
            }),
        ));
    }

    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT user_id, status FROM kyc_submissions WHERE id = $1")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "DB_ERROR".to_string(),
                        message: e.to_string(),
                    },
                }),
            )
        })?;

    let Some((submission_user_id, status)) = row else {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "NOT_FOUND".to_string(),
                    message: "Submission not found".to_string(),
                },
            }),
        ));
    };
    let allowed_user_ids = scoped_access::resolve_allowed_user_ids_for_trading(&pool, &claims).await.map_err(scoped_err_to_response)?;
    if let Some(ref ids) = allowed_user_ids {
        if !ids.contains(&submission_user_id) {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "NOT_FOUND".to_string(),
                        message: "Submission not found".to_string(),
                    },
                }),
            ));
        }
    }

    match status.as_str() {
        "pending" | "under_review" => {}
        "rejected" => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "ALREADY_REJECTED".to_string(),
                        message: "Submission is already rejected".to_string(),
                    },
                }),
            ));
        }
        "approved" | "draft" | _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: ErrorDetail {
                        code: "INVALID_STATUS".to_string(),
                        message: "Submission cannot be rejected in current status".to_string(),
                    },
                }),
            ));
        }
    }

    sqlx::query(
        r#"
        UPDATE kyc_submissions
        SET status = 'rejected', rejection_reason = $1, reviewed_at = now(), reviewed_by_id = $2, updated_at = now()
        WHERE id = $3
        "#,
    )
    .bind(reason)
    .bind(claims.sub)
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail {
                    code: "DB_ERROR".to_string(),
                    message: e.to_string(),
                },
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}
