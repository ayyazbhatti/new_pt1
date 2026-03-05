use dashmap::DashMap;
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq)]
pub enum CallStatus {
    Ringing,
    Accepted,
}

#[derive(Debug, Clone)]
pub struct CallState {
    pub call_id: String,
    pub admin_user_id: String,
    pub target_user_id: String,
    pub status: CallStatus,
    pub created_at: Instant,
}

pub struct CallRegistry {
    calls: Arc<DashMap<String, CallState>>,
}

impl CallRegistry {
    pub fn new() -> Self {
        Self {
            calls: Arc::new(DashMap::new()),
        }
    }

    pub fn insert(&self, state: CallState) {
        self.calls.insert(state.call_id.clone(), state);
    }

    pub fn get(&self, call_id: &str) -> Option<CallState> {
        self.calls.get(call_id).map(|e| e.clone())
    }

    pub fn get_mut(&self, call_id: &str) -> Option<dashmap::mapref::one::RefMut<'_, String, CallState>> {
        self.calls.get_mut(call_id)
    }

    /// Remove and return the call only if status is still Ringing (for timeout).
    pub fn remove_if_ringing(&self, call_id: &str) -> Option<CallState> {
        if let Some(mut entry) = self.calls.get_mut(call_id) {
            if entry.status == CallStatus::Ringing {
                let state = entry.clone();
                drop(entry);
                self.calls.remove(call_id);
                return Some(state);
            }
        }
        None
    }

    pub fn remove(&self, call_id: &str) -> Option<CallState> {
        self.calls.remove(call_id).map(|(_, s)| s)
    }
}

impl Default for CallRegistry {
    fn default() -> Self {
        Self::new()
    }
}
