use chrono::Utc;

pub fn now() -> chrono::DateTime<Utc> {
    Utc::now()
}

pub fn now_timestamp_ms() -> i64 {
    Utc::now().timestamp_millis()
}

