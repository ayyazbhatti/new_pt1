use axum::extract::ws::WebSocketUpgrade;
use axum::extract::State;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use std::sync::Arc;
use crate::auth::jwt::JwtAuth;
use crate::config::Config;
use crate::state::call_registry::CallRegistry;
use crate::state::connection_registry::ConnectionRegistry;
use crate::validation::message_validation::MessageValidator;
use crate::ws::session::Session;
use crate::stream::broadcaster::Broadcaster;
use tracing::info;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<ConnectionRegistry>,
    pub validator: Arc<MessageValidator>,
    pub jwt_auth: Arc<JwtAuth>,
    pub broadcaster: Arc<Broadcaster>,
    pub call_registry: Arc<CallRegistry>,
    pub redis_url: String,
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state)
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| async move {
        let mut session = Session::new(
            state.registry.clone(),
            state.validator.clone(),
            state.jwt_auth.clone(),
            state.broadcaster.clone(),
            state.call_registry.clone(),
            state.redis_url.clone(),
        );
        session.handle(socket).await;
    })
}

