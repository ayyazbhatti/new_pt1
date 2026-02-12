use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Redis error: {0}")]
    Redis(String),

    #[error("NATS error: {0}")]
    Nats(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

#[cfg(feature = "sqlx")]
impl From<sqlx::Error> for Error {
    fn from(err: sqlx::Error) -> Self {
        Error::Database(err.to_string())
    }
}

#[cfg(feature = "redis")]
impl From<redis::RedisError> for Error {
    fn from(err: redis::RedisError) -> Self {
        Error::Redis(err.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::Serialization(err.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Error::Io(err.to_string())
    }
}

