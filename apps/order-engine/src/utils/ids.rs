use uuid::Uuid;

pub fn generate_order_id() -> Uuid {
    Uuid::new_v4()
}

pub fn generate_position_id() -> Uuid {
    Uuid::new_v4()
}

pub fn generate_correlation_id() -> String {
    Uuid::new_v4().to_string()
}

