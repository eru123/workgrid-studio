// Structured application error. Serialized as `{ kind, message }` so the
// frontend can branch on error kind (unlike the legacy backend which
// serialized to a bare string, losing the variant).

use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub kind: String,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        Self { kind: kind.to_string(), message: message.into() }
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::new("database", message)
    }
    pub fn ssh(message: impl Into<String>) -> Self {
        Self::new("ssh", message)
    }
    pub fn crypto(message: impl Into<String>) -> Self {
        Self::new("crypto", message)
    }
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new("validation", message)
    }
    pub fn state(message: impl Into<String>) -> Self {
        Self::new("state", message)
    }
    pub fn network(message: impl Into<String>) -> Self {
        Self::new("network", message)
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::new("io", message)
    }
    pub fn serialization(message: impl Into<String>) -> Self {
        Self::new("serialization", message)
    }
    pub fn not_implemented(message: impl Into<String>) -> Self {
        Self::new("not_implemented", message)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.kind, self.message)
    }
}

impl std::error::Error for AppError {}

// Convenience constructors from common error types.

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self::new("external", value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self::new("external", value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::io(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::serialization(value.to_string())
    }
}

impl From<mysql_async::Error> for AppError {
    fn from(value: mysql_async::Error) -> Self {
        Self::database(value.to_string())
    }
}

impl From<russh::Error> for AppError {
    fn from(value: russh::Error) -> Self {
        Self::ssh(value.to_string())
    }
}

impl From<russh::keys::ssh_key::Error> for AppError {
    fn from(value: russh::keys::ssh_key::Error) -> Self {
        Self::ssh(value.to_string())
    }
}

impl From<base64::DecodeError> for AppError {
    fn from(value: base64::DecodeError) -> Self {
        Self::crypto(value.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(value: keyring::Error) -> Self {
        Self::crypto(value.to_string())
    }
}

impl<T> From<std::sync::PoisonError<T>> for AppError {
    fn from(value: std::sync::PoisonError<T>) -> Self {
        Self::state(value.to_string())
    }
}
