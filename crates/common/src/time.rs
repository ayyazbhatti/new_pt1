use chrono::{DateTime, Utc};

pub fn now() -> DateTime<Utc> {
    Utc::now()
}

pub fn timestamp_ms() -> i64 {
    Utc::now().timestamp_millis()
}

