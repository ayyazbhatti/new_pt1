//! User-scoped preferences: terminal settings (chart options) persisted per user.

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, put},
    Router,
    Extension,
};
use serde::{Deserialize, Serialize};
use sqlx::types::Json as SqlxJson;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::middleware::auth_middleware;
use crate::utils::jwt::Claims;

/// Default preferences when no row exists or a key is missing.
fn default_preferences() -> TerminalPreferences {
    TerminalPreferences {
        chart_show_ask_price: true,
        chart_show_position_marker: true,
        chart_show_closed_position_marker: true,
        enable_liquidation_email: false,
        enable_sltp_email: false,
        favourite_symbol_ids: vec![],
    }
}

/// Normalize DB JSON (or request body) into a full preferences struct. Missing keys → default.
fn normalize_preferences(value: &serde_json::Value) -> TerminalPreferences {
    let def = default_preferences();
    let obj = value.as_object();
    let favourite_symbol_ids: Vec<String> = obj
        .and_then(|o| o.get("favouriteSymbolIds"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| def.favourite_symbol_ids.clone());
    TerminalPreferences {
        chart_show_ask_price: obj
            .and_then(|o| o.get("chartShowAskPrice"))
            .and_then(|v| v.as_bool())
            .unwrap_or(def.chart_show_ask_price),
        chart_show_position_marker: obj
            .and_then(|o| o.get("chartShowPositionMarker"))
            .and_then(|v| v.as_bool())
            .unwrap_or(def.chart_show_position_marker),
        chart_show_closed_position_marker: obj
            .and_then(|o| o.get("chartShowClosedPositionMarker"))
            .and_then(|v| v.as_bool())
            .unwrap_or(def.chart_show_closed_position_marker),
        enable_liquidation_email: obj
            .and_then(|o| o.get("enableLiquidationEmail"))
            .and_then(|v| v.as_bool())
            .unwrap_or(def.enable_liquidation_email),
        enable_sltp_email: obj
            .and_then(|o| o.get("enableSlTpEmail"))
            .and_then(|v| v.as_bool())
            .unwrap_or(def.enable_sltp_email),
        favourite_symbol_ids,
    }
}

/// Merge incoming (partial) with existing (or defaults). Incoming keys override.
fn merge_preferences(existing: &TerminalPreferences, incoming: &serde_json::Value) -> TerminalPreferences {
    let obj = incoming.as_object();
    let favourite_symbol_ids: Vec<String> = obj
        .and_then(|o| o.get("favouriteSymbolIds"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| existing.favourite_symbol_ids.clone());
    TerminalPreferences {
        chart_show_ask_price: obj
            .and_then(|o| o.get("chartShowAskPrice"))
            .and_then(|v| v.as_bool())
            .unwrap_or(existing.chart_show_ask_price),
        chart_show_position_marker: obj
            .and_then(|o| o.get("chartShowPositionMarker"))
            .and_then(|v| v.as_bool())
            .unwrap_or(existing.chart_show_position_marker),
        chart_show_closed_position_marker: obj
            .and_then(|o| o.get("chartShowClosedPositionMarker"))
            .and_then(|v| v.as_bool())
            .unwrap_or(existing.chart_show_closed_position_marker),
        enable_liquidation_email: obj
            .and_then(|o| o.get("enableLiquidationEmail"))
            .and_then(|v| v.as_bool())
            .unwrap_or(existing.enable_liquidation_email),
        enable_sltp_email: obj
            .and_then(|o| o.get("enableSlTpEmail"))
            .and_then(|v| v.as_bool())
            .unwrap_or(existing.enable_sltp_email),
        favourite_symbol_ids,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalPreferences {
    chart_show_ask_price: bool,
    chart_show_position_marker: bool,
    chart_show_closed_position_marker: bool,
    enable_liquidation_email: bool,
    enable_sltp_email: bool,
    favourite_symbol_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalPreferencesResponse {
    preferences: TerminalPreferences,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutTerminalPreferencesRequest {
    preferences: Option<serde_json::Value>,
}

async fn get_terminal_preferences(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<TerminalPreferencesResponse>, StatusCode> {
    let user_id = claims.sub;

    let row = sqlx::query("SELECT preferences FROM user_terminal_preferences WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let prefs = match row {
        Some(row) => {
            let value: SqlxJson<serde_json::Value> = row.get("preferences");
            normalize_preferences(&value.0)
        }
        None => default_preferences(),
    };

    Ok(Json(TerminalPreferencesResponse { preferences: prefs }))
}

async fn put_terminal_preferences(
    State(pool): State<PgPool>,
    Extension(claims): Extension<Claims>,
    axum::Json(body): axum::Json<PutTerminalPreferencesRequest>,
) -> Result<Json<TerminalPreferencesResponse>, StatusCode> {
    let user_id = claims.sub;

    let incoming = body.preferences.unwrap_or(serde_json::json!({}));
    if !incoming.is_object() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Load existing or use defaults
    let existing = sqlx::query("SELECT preferences FROM user_terminal_preferences WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let existing_prefs = match &existing {
        Some(row) => {
            let value: SqlxJson<serde_json::Value> = row.get("preferences");
            normalize_preferences(&value.0)
        }
        None => default_preferences(),
    };

    let merged = merge_preferences(&existing_prefs, &incoming);
    let merged_json = serde_json::to_value(&merged).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query(
        r#"
        INSERT INTO user_terminal_preferences (user_id, preferences, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          preferences = EXCLUDED.preferences,
          updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(&merged_json)
    .execute(&pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TerminalPreferencesResponse {
        preferences: merged,
    }))
}

/// Returns whether the user has liquidation email enabled. Used when sending liquidation
/// notification email. Defaults to false if no row exists or on error (opt-in).
pub async fn get_enable_liquidation_email(pool: &PgPool, user_id: Uuid) -> bool {
    let row = match sqlx::query("SELECT preferences FROM user_terminal_preferences WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) | Err(_) => return false,
    };
    let value: SqlxJson<serde_json::Value> = row.get("preferences");
    normalize_preferences(&value.0).enable_liquidation_email
}

/// Returns whether the user has SL/TP email enabled. Used when sending SL/TP
/// notification email. Defaults to false if no row exists or on error (opt-in).
pub async fn get_enable_sltp_email(pool: &PgPool, user_id: Uuid) -> bool {
    let row = match sqlx::query("SELECT preferences FROM user_terminal_preferences WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
    {
        Ok(Some(r)) => r,
        Ok(None) | Err(_) => return false,
    };
    let value: SqlxJson<serde_json::Value> = row.get("preferences");
    normalize_preferences(&value.0).enable_sltp_email
}

pub fn create_user_preferences_router(pool: PgPool) -> Router<PgPool> {
    Router::new()
        .route("/terminal-preferences", get(get_terminal_preferences).put(put_terminal_preferences))
        .layer(axum::middleware::from_fn(auth_middleware))
        .with_state(pool)
}
