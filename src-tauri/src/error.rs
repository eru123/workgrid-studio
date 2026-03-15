use serde::ser::{Serialize, Serializer};
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    Io(String),
    Database(String),
    Crypto(String),
    Network(String),
    Ssh(String),
    Validation(String),
    Serialization(String),
    State(String),
    External(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn io(message: impl Into<String>) -> Self {
        Self::Io(message.into())
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::Database(message.into())
    }

    pub fn crypto(message: impl Into<String>) -> Self {
        Self::Crypto(message.into())
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::Network(message.into())
    }

    pub fn ssh(message: impl Into<String>) -> Self {
        Self::Ssh(message.into())
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn serialization(message: impl Into<String>) -> Self {
        Self::Serialization(message.into())
    }

    pub fn state(message: impl Into<String>) -> Self {
        Self::State(message.into())
    }

    pub fn external(message: impl Into<String>) -> Self {
        Self::External(message.into())
    }

    pub fn message(&self) -> &str {
        match self {
            Self::Io(message)
            | Self::Database(message)
            | Self::Crypto(message)
            | Self::Network(message)
            | Self::Ssh(message)
            | Self::Validation(message)
            | Self::Serialization(message)
            | Self::State(message)
            | Self::External(message) => message,
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.message())
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self::External(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self::External(value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serialization(value.to_string())
    }
}

impl From<mysql_async::Error> for AppError {
    fn from(value: mysql_async::Error) -> Self {
        Self::Database(value.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        Self::Network(value.to_string())
    }
}

impl From<base64::DecodeError> for AppError {
    fn from(value: base64::DecodeError) -> Self {
        Self::Crypto(value.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(value: keyring::Error) -> Self {
        Self::Crypto(value.to_string())
    }
}

impl From<ssh2::Error> for AppError {
    fn from(value: ssh2::Error) -> Self {
        Self::Ssh(value.to_string())
    }
}

impl From<csv::Error> for AppError {
    fn from(value: csv::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl<T> From<std::sync::PoisonError<T>> for AppError {
    fn from(value: std::sync::PoisonError<T>) -> Self {
        Self::State(value.to_string())
    }
}
