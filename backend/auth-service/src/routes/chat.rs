//! Support chat: user GET/POST /v1/users/me/chat, admin GET/POST conversations and messages.
//! NATS: user message -> chat.support (+ chat.user.{user_id} for echo); support reply -> chat.user.{user_id}.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{error, info};
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::routes::deposits::DepositsState;
use crate::utils::jwt::Claims;

// ---------- User: my chat ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRow {
    pub id: String,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct PostChatRequest {
    pub message: String,
}

/// GET /me/chat — list messages for current user
async fn get_my_chat(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<ChatMessageRow>>, (StatusCode, Json<serde_json::Value>)> {
    let user_id = claims.sub;
    let rows = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, String, DateTime<Utc>)>(
        r#"
        SELECT id, sender_type, sender_id, body, created_at
        FROM support_messages
        WHERE user_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch chat for user {}: {}", user_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "CHAT_FETCH_FAILED", "message": e.to_string() } })),
        )
    })?;

    let list: Vec<ChatMessageRow> = rows
        .into_iter()
        .map(|(id, sender_type, sender_id, body, created_at)| ChatMessageRow {
            id: id.to_string(),
            sender_type,
            sender_id: sender_id.map(|u| u.to_string()),
            body,
            created_at: created_at.to_rfc3339(),
        })
        .collect();
    Ok(Json(list))
}

/// POST /me/chat — send message, insert then publish to NATS chat.support and chat.user.{user_id}
async fn post_my_chat(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(deposits_state): Extension<DepositsState>,
    Json(body): Json<PostChatRequest>,
) -> Result<Json<ChatMessageRow>, (StatusCode, Json<serde_json::Value>)> {
    let user_id = claims.sub;
    let message = body.message.trim();
    if message.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": { "code": "EMPTY_MESSAGE", "message": "Message cannot be empty" } })),
        ));
    }

    let row = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, String, DateTime<Utc>)>(
        r#"
        INSERT INTO support_messages (user_id, sender_type, sender_id, body)
        VALUES ($1, 'user', NULL, $2)
        RETURNING id, sender_type, sender_id, body, created_at
        "#,
    )
    .bind(user_id)
    .bind(message)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        error!("Failed to insert chat message for user {}: {}", user_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "CHAT_SEND_FAILED", "message": e.to_string() } })),
        )
    })?;

    let msg = ChatMessageRow {
        id: row.0.to_string(),
        sender_type: row.1,
        sender_id: row.2.map(|u| u.to_string()),
        body: row.3,
        created_at: row.4.to_rfc3339(),
    };

    let payload = serde_json::json!({
        "type": "chat.message",
        "payload": {
            "id": msg.id,
            "userId": user_id.to_string(),
            "senderType": msg.sender_type,
            "senderId": msg.sender_id,
            "body": msg.body,
            "createdAt": msg.created_at,
        }
    });
    let payload_bytes = match serde_json::to_vec(&payload) {
        Ok(b) => b,
        Err(e) => {
            error!("Failed to serialize chat message for NATS: {}", e);
            return Ok(Json(msg));
        }
    };

    // Notify support (all admins subscribed to chat.support)
    let sub_support = "chat.support".to_string();
    if let Err(e) = deposits_state
        .nats
        .publish(sub_support.clone(), payload_bytes.clone().into())
        .await
    {
        error!("Failed to publish to {}: {}", sub_support, e);
    } else {
        info!("Published user chat message to {} for user {} (size {} bytes)", sub_support, user_id, payload_bytes.len());
    }
    // Echo to user's own channel so their WS gets it immediately
    let sub_user = format!("chat.user.{}", user_id);
    if let Err(e) = deposits_state
        .nats
        .publish(sub_user.clone(), payload_bytes.into())
        .await
    {
        error!("Failed to publish to {}: {}", sub_user, e);
    } else {
        info!("Published user chat message to {} (echo to user)", sub_user);
    }
    if let Err(e) = deposits_state.nats.flush().await {
        error!("Failed to flush NATS after chat publish: {}", e);
    }

    Ok(Json(msg))
}

// ---------- Admin: conversations and messages ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub user_id: String,
    pub user_name: String,
    pub user_email: String,
    pub last_message: String,
    pub last_time: String,
}

#[derive(Debug, Deserialize)]
pub struct PostAdminChatRequest {
    pub message: String,
}

fn check_admin(claims: &Claims) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if claims.role != "admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": { "code": "FORBIDDEN", "message": "Admin access required" } })),
        ));
    }
    Ok(())
}

/// GET /conversations — list conversations (user_id, name, email, last message, time)
async fn get_admin_conversations(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<ConversationSummary>>, (StatusCode, Json<serde_json::Value>)> {
    check_admin(&claims)?;

    #[derive(sqlx::FromRow)]
    struct Row {
        user_id: Uuid,
        first_name: String,
        last_name: String,
        email: String,
        last_body: String,
        last_created_at: DateTime<Utc>,
    }

    let rows = sqlx::query_as::<_, Row>(
        r#"
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email, sm.body AS last_body, sm.created_at AS last_created_at
        FROM (
            SELECT DISTINCT ON (user_id) user_id, body, created_at
            FROM support_messages
            ORDER BY user_id, created_at DESC
        ) sm
        JOIN users u ON u.id = sm.user_id
        ORDER BY sm.created_at DESC
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch admin conversations: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "CONVERSATIONS_FAILED", "message": e.to_string() } })),
        )
    })?;

    let list: Vec<ConversationSummary> = rows
        .into_iter()
        .map(|r| ConversationSummary {
            user_id: r.user_id.to_string(),
            user_name: format!("{} {}", r.first_name, r.last_name).trim().to_string(),
            user_email: r.email,
            last_message: r.last_body,
            last_time: r.last_created_at.format("%H:%M").to_string(),
        })
        .collect();
    Ok(Json(list))
}

/// GET /conversations/:user_id/messages
async fn get_admin_conversation_messages(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Vec<ChatMessageRow>>, (StatusCode, Json<serde_json::Value>)> {
    check_admin(&claims)?;

    let rows = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, String, DateTime<Utc>)>(
        r#"
        SELECT id, sender_type, sender_id, body, created_at
        FROM support_messages
        WHERE user_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        error!("Failed to fetch messages for user {}: {}", user_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "MESSAGES_FETCH_FAILED", "message": e.to_string() } })),
        )
    })?;

    let list: Vec<ChatMessageRow> = rows
        .into_iter()
        .map(|(id, sender_type, sender_id, body, created_at)| ChatMessageRow {
            id: id.to_string(),
            sender_type,
            sender_id: sender_id.map(|u| u.to_string()),
            body,
            created_at: created_at.to_rfc3339(),
        })
        .collect();
    Ok(Json(list))
}

/// POST /conversations/:user_id/messages — support reply, insert then publish to chat.user.{user_id}
async fn post_admin_message(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    Extension(deposits_state): Extension<DepositsState>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<PostAdminChatRequest>,
) -> Result<Json<ChatMessageRow>, (StatusCode, Json<serde_json::Value>)> {
    check_admin(&claims)?;
    let sender_id = claims.sub;
    let message = body.message.trim();
    if message.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": { "code": "EMPTY_MESSAGE", "message": "Message cannot be empty" } })),
        ));
    }

    let row = sqlx::query_as::<_, (Uuid, String, Option<Uuid>, String, DateTime<Utc>)>(
        r#"
        INSERT INTO support_messages (user_id, sender_type, sender_id, body)
        VALUES ($1, 'support', $2, $3)
        RETURNING id, sender_type, sender_id, body, created_at
        "#,
    )
    .bind(user_id)
    .bind(sender_id)
    .bind(message)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        error!("Failed to insert support message for user {}: {}", user_id, e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "code": "CHAT_SEND_FAILED", "message": e.to_string() } })),
        )
    })?;

    let msg = ChatMessageRow {
        id: row.0.to_string(),
        sender_type: row.1,
        sender_id: row.2.map(|u| u.to_string()),
        body: row.3,
        created_at: row.4.to_rfc3339(),
    };

    let payload = serde_json::json!({
        "type": "chat.message",
        "payload": {
            "id": msg.id,
            "userId": user_id.to_string(),
            "senderType": msg.sender_type,
            "senderId": msg.sender_id,
            "body": msg.body,
            "createdAt": msg.created_at,
        }
    });
    let payload_bytes = match serde_json::to_vec(&payload) {
        Ok(b) => b,
        Err(e) => {
            error!("Failed to serialize support message for NATS: {}", e);
            return Ok(Json(msg));
        }
    };

    if let Err(e) = deposits_state
        .nats
        .publish(format!("chat.user.{}", user_id), payload_bytes.into())
        .await
    {
        error!("Failed to publish to chat.user.{}: {}", user_id, e);
    } else {
        info!("Published support reply to chat.user.{}", user_id);
    }
    if let Err(e) = deposits_state.nats.flush().await {
        error!("Failed to flush NATS after chat publish: {}", e);
    }

    Ok(Json(msg))
}

/// User chat router: mount at /v1/users so /me/chat -> /v1/users/me/chat
pub fn create_user_chat_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/me/chat", get(get_my_chat).post(post_my_chat))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(move |mut req: axum::extract::Request, next: axum::middleware::Next| {
            let state = deposits_state.clone();
            async move {
                req.extensions_mut().insert(state);
                next.run(req).await
            }
        }))
        .with_state(pool)
}

/// Admin chat router: mount at /api/admin/chat
pub fn create_admin_chat_router(
    pool: PgPool,
    deposits_state: DepositsState,
) -> Router<PgPool> {
    Router::new()
        .route("/conversations", get(get_admin_conversations))
        .route("/conversations/:user_id/messages", get(get_admin_conversation_messages).post(post_admin_message))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(move |mut req: axum::extract::Request, next: axum::middleware::Next| {
            let state = deposits_state.clone();
            async move {
                req.extensions_mut().insert(state);
                next.run(req).await
            }
        }))
        .with_state(pool)
}
