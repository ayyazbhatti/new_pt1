//! User KYC: get my status, upload documents, submit.

use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::path::PathBuf;
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;
use axum::Extension;
use futures::stream::StreamExt;

/// Extension type for KYC upload directory (set in main when nesting the router).
#[derive(Clone)]
pub struct KycUploadDir(pub PathBuf);

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES: &[&str] = &["image/jpeg", "image/png", "image/webp", "application/pdf"];
const VALID_IDENTITY_TYPES: &[&str] = &["passport", "national_id", "driving_licence"];
const VALID_ADDRESS_TYPES: &[&str] = &["utility", "bank_statement", "tax", "other"];
const VALID_DOC_TYPES: &[&str] = &["identity_front", "identity_back", "proof_of_address"];


#[derive(Debug, Serialize)]
pub struct KycStatusResponse {
    pub id: Uuid,
    pub status: String,
    pub identity_doc_type: Option<String>,
    pub address_doc_type: Option<String>,
    pub rejection_reason: Option<String>,
    pub submitted_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub documents: Vec<KycDocumentResponse>,
}

#[derive(Debug, Serialize)]
pub struct KycDocumentResponse {
    pub id: Uuid,
    pub document_type: String,
    pub file_name: String,
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitKycRequest {
    pub identity_doc_type: String,
    pub address_doc_type: String,
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

fn err_response(code: &str, message: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: ErrorDetail {
                code: code.to_string(),
                message: message.into(),
            },
        }),
    )
}

pub fn create_kyc_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/", get(get_my_kyc))
        .route("/upload", post(upload_document))
        .route("/submit", post(submit_kyc))
        .route("/submissions/:submission_id/documents/:doc_id", get(stream_my_document))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}

async fn get_my_kyc(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Option<KycStatusResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let row = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<String>, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>)>(
        r#"
        SELECT id, status, identity_doc_type, address_doc_type, rejection_reason, submitted_at, reviewed_at
        FROM kyc_submissions
        WHERE user_id = $1
        ORDER BY submitted_at DESC
        LIMIT 1
        "#,
    )
    .bind(claims.sub)
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

    let Some((id, status, identity_doc_type, address_doc_type, rejection_reason, submitted_at, reviewed_at)) = row else {
        return Ok(Json(None));
    };

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
        .map(|(id, document_type, file_name, content_type)| KycDocumentResponse {
            id,
            document_type,
            file_name,
            content_type,
        })
        .collect();

    Ok(Json(Some(KycStatusResponse {
        id,
        status,
        identity_doc_type,
        address_doc_type,
        rejection_reason,
        submitted_at,
        reviewed_at,
        documents,
    })))
}

async fn upload_document(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(upload_dir): Extension<KycUploadDir>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let mut submission_id: Option<Uuid> = None;
    let mut document_type: Option<String> = None;
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name: Option<String> = None;
    let mut content_type: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| err_response("MULTIPART", e.to_string()))? {
        let name = field.name().unwrap_or_default().to_string();
        if name == "submission_id" {
            let t = field.text().await.map_err(|e| err_response("MULTIPART", e.to_string()))?;
            submission_id = Uuid::parse_str(t.trim()).ok();
        } else if name == "document_type" {
            let t = field.text().await.map_err(|e| err_response("MULTIPART", e.to_string()))?;
            let t = t.trim().to_string();
            if VALID_DOC_TYPES.contains(&t.as_str()) {
                document_type = Some(t);
            }
        } else if name == "file" {
            let ct = field.content_type().map(|c| c.to_string());
            if let Some(ref ct) = ct {
                if !ALLOWED_TYPES.iter().any(|a| ct.starts_with(a.trim_end_matches(';'))) {
                    return Err(err_response("INVALID_TYPE", "Allowed: image/jpeg, image/png, image/webp, application/pdf"));
                }
            }
            content_type = ct;
            file_name = field.file_name().map(|s| s.to_string());
            let bytes = field.bytes().await.map_err(|e| err_response("MULTIPART", e.to_string()))?;
            if bytes.len() as u64 > MAX_FILE_BYTES {
                return Err(err_response("FILE_TOO_LARGE", "Max 10 MB per file"));
            }
            file_data = Some(bytes.to_vec());
        }
    }

    let doc_type = document_type.ok_or_else(|| err_response("VALIDATION", "document_type required"))?;
    let data = file_data.ok_or_else(|| err_response("VALIDATION", "file required"))?;
    let fname = file_name.unwrap_or_else(|| "document".to_string());
    let ext = PathBuf::from(&fname).extension().and_then(|e| e.to_str()).unwrap_or("bin").to_string();

    let (sub_id, is_new) = match submission_id {
        Some(id) => {
            let belongs: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM kyc_submissions WHERE id = $1 AND user_id = $2)")
                .bind(id)
                .bind(claims.sub)
                .fetch_one(&pool)
                .await
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
                        }),
                    )
                })?;
            if !belongs {
                return Err((StatusCode::FORBIDDEN, Json(ErrorResponse {
                    error: ErrorDetail { code: "FORBIDDEN".to_string(), message: "Submission not found or not yours".to_string() },
                })));
            }
            let status: String = sqlx::query_scalar("SELECT status FROM kyc_submissions WHERE id = $1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .map_err(|e| {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                        error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
                    }))
                })?;
            if status == "approved" {
                return Err(err_response("VALIDATION", "Cannot add documents to an approved submission"));
            }
            (id, false)
        }
        None => {
            let id = Uuid::new_v4();
            sqlx::query(
                r#"
                INSERT INTO kyc_submissions (id, user_id, status, submitted_at, created_at, updated_at)
                VALUES ($1, $2, 'draft', now(), now(), now())
                "#,
            )
            .bind(id)
            .bind(claims.sub)
            .execute(&pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
                    }),
                )
            })?;
            (id, true)
        }
    };

    std::fs::create_dir_all(upload_dir.0.join(sub_id.to_string()))
        .map_err(|e| err_response("STORAGE", e.to_string()))?;
    let doc_id = Uuid::new_v4();
    let safe_name = format!("{}_{}.{}", doc_type, doc_id, ext);
    let path = upload_dir.0.join(sub_id.to_string()).join(&safe_name);
    std::fs::write(&path, &data).map_err(|e| err_response("STORAGE", e.to_string()))?;
    // Store relative path for portability (relative to upload_dir)
    let path_str = format!("{}/{}", sub_id, safe_name);

    sqlx::query(
        r#"
        INSERT INTO kyc_documents (id, submission_id, document_type, file_name, file_path, file_size_bytes, content_type, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        "#,
    )
    .bind(doc_id)
    .bind(sub_id)
    .bind(&doc_type)
    .bind(&fname)
    .bind(&path_str)
    .bind(data.len() as i64)
    .bind(content_type.as_deref())
    .execute(&pool)
    .await
    .map_err(|e| {
        let _ = std::fs::remove_file(&path);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
            }),
        )
    })?;

    Ok(Json(serde_json::json!({
        "submission_id": sub_id,
        "document_id": doc_id,
        "document_type": doc_type,
        "is_new_submission": is_new,
    })))
}

async fn submit_kyc(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SubmitKycRequest>,
) -> Result<Json<KycStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let identity_doc_type = body.identity_doc_type.trim();
    let address_doc_type = body.address_doc_type.trim();
    if identity_doc_type.is_empty() || !VALID_IDENTITY_TYPES.contains(&identity_doc_type) {
        return Err(err_response("VALIDATION", "identity_doc_type must be one of: passport, national_id, driving_licence"));
    }
    if address_doc_type.is_empty() || !VALID_ADDRESS_TYPES.contains(&address_doc_type) {
        return Err(err_response("VALIDATION", "address_doc_type must be one of: utility, bank_statement, tax, other"));
    }

    let submission: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, status FROM kyc_submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1",
    )
    .bind(claims.sub)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
            }),
        )
    })?;

    let sub_id = match submission {
        Some((id, status)) => {
            if status == "approved" {
                return Err(err_response("VALIDATION", "You are already verified"));
            }
            if status == "pending" || status == "under_review" {
                return Err(err_response("VALIDATION", "Submission already under review"));
            }
            id
        }
        None => {
            return Err(err_response("VALIDATION", "Upload at least one identity and one proof-of-address document first, then submit"));
        }
    };

    let has_identity: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM kyc_documents WHERE submission_id = $1 AND document_type IN ('identity_front', 'identity_back'))",
    )
    .bind(sub_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
            }),
        )
    })?;
    let has_address: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM kyc_documents WHERE submission_id = $1 AND document_type = 'proof_of_address')",
    )
    .bind(sub_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
            }),
        )
    })?;
    if !has_identity || !has_address {
        return Err(err_response(
            "VALIDATION",
            "Upload at least one identity document and one proof-of-address document before submitting",
        ));
    }

    sqlx::query(
        r#"
        UPDATE kyc_submissions
        SET status = 'pending', identity_doc_type = $1, address_doc_type = $2, submitted_at = now(), updated_at = now()
        WHERE id = $3 AND user_id = $4
        "#,
    )
    .bind(identity_doc_type)
    .bind(address_doc_type)
    .bind(sub_id)
    .bind(claims.sub)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
            }),
        )
    })?;

    let row: (DateTime<Utc>, Option<DateTime<Utc>>) = sqlx::query_as(
        "SELECT submitted_at, reviewed_at FROM kyc_submissions WHERE id = $1",
    )
    .bind(sub_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
            }),
        )
    })?;

    let docs = sqlx::query_as::<_, (Uuid, String, String, Option<String>)>(
        "SELECT id, document_type, file_name, content_type FROM kyc_documents WHERE submission_id = $1 ORDER BY created_at",
    )
    .bind(sub_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
            }),
        )
    })?;

    Ok(Json(KycStatusResponse {
        id: sub_id,
        status: "pending".to_string(),
        identity_doc_type: Some(identity_doc_type.to_string()),
        address_doc_type: Some(address_doc_type.to_string()),
        rejection_reason: None,
        submitted_at: row.0,
        reviewed_at: row.1,
        documents: docs
            .into_iter()
            .map(|(id, document_type, file_name, content_type)| KycDocumentResponse {
                id,
                document_type,
                file_name,
                content_type,
            })
            .collect(),
    }))
}

async fn stream_my_document(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(upload_dir): Extension<KycUploadDir>,
    axum::extract::Path((submission_id, doc_id)): axum::extract::Path<(Uuid, Uuid)>,
) -> Result<axum::body::Bytes, (StatusCode, Json<ErrorResponse>)> {
    let belongs: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM kyc_submissions WHERE id = $1 AND user_id = $2)")
        .bind(submission_id)
        .bind(claims.sub)
        .fetch_one(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
                }),
            )
        })?;
    if !belongs {
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
    let row: Option<(String,)> = sqlx::query_as("SELECT file_path FROM kyc_documents WHERE id = $1 AND submission_id = $2")
        .bind(doc_id)
        .bind(submission_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: ErrorDetail { code: "DB_ERROR".to_string(), message: e.to_string() },
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
