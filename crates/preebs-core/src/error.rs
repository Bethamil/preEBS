use std::io;

/// Library result.
pub type Result<T> = std::result::Result<T, Error>;

/// Recoverable failure. [`Error::code`] and [`Error::exit_code`] are the CLI contract.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Validation(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Ambiguous(String),
    #[error("{0}")]
    Io(#[from] io::Error),
    #[error("{0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    /// Stable machine code used in `--json` error objects.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "validation",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::Ambiguous(_) => "ambiguous",
            Self::Io(_) | Self::Db(_) => "io",
            Self::Json(_) => "validation",
        }
    }

    /// Process exit code for the CLI.
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Validation(_) | Self::Json(_) => 2,
            Self::NotFound(_) => 3,
            Self::Conflict(_) => 4,
            Self::Ambiguous(_) => 5,
            Self::Io(_) | Self::Db(_) => 1,
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    pub fn ambiguous(message: impl Into<String>) -> Self {
        Self::Ambiguous(message.into())
    }
}
