//! Error type shared by every ZEUS service call.

use rusqlite::Error as SqliteError;
use std::fmt;

/// Every fallible operation in the core returns this.
///
/// The message is surfaced directly to the UI, so it is written to be
/// readable by a business user ("Insufficient stock for Z-D4-SRV-32-2666V: 24
/// available, 30 requested").
pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug)]
pub enum AppError {
    /// Input validation failed - the user can fix this.
    Validation(String),
    /// A business rule blocked the operation (stock, balances, status).
    Business(String),
    /// The record referenced does not exist (or already does).
    NotFound(String),
    Conflict(String),
    /// Database / IO / anything unexpected.
    Internal(String),
}

impl AppError {
    pub fn validation(msg: impl Into<String>) -> Self {
        AppError::Validation(msg.into())
    }
    pub fn business(msg: impl Into<String>) -> Self {
        AppError::Business(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        AppError::NotFound(msg.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        AppError::Conflict(msg.into())
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        AppError::Internal(msg.into())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Validation(m) => write!(f, "{m}"),
            AppError::Business(m) => write!(f, "{m}"),
            AppError::NotFound(m) => write!(f, "{m}"),
            AppError::Conflict(m) => write!(f, "{m}"),
            AppError::Internal(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<SqliteError> for AppError {
    fn from(e: SqliteError) -> Self {
        match e {
            SqliteError::QueryReturnedNoRows => AppError::NotFound("Record not found".into()),
            SqliteError::IntegralValueOutOfRange(..) => {
                AppError::Internal("Numeric value out of range".into())
            }
            SqliteError::InvalidColumnIndex(..) => AppError::Internal("Column index out of range".into()),
            other => AppError::Internal(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

/// Tauri requires command errors to implement `serde::Serialize`.
/// We serialise everything as a plain string so the UI can show it verbatim.
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}