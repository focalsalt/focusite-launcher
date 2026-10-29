//! Focusite Core: Minecraft manifest parsing, JVM argument building, and process management.

pub mod args;
pub mod instance;
pub mod java;
pub mod manifest;
pub mod process;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),

    #[error("Java runtime not found: {0}")]
    JavaNotFound(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_error_formatting() {
        let err = CoreError::InvalidManifest("corrupted json".into());
        assert_eq!(err.to_string(), "Invalid manifest: corrupted json");

        let java_err = CoreError::JavaNotFound("Java 21 required".into());
        assert_eq!(java_err.to_string(), "Java runtime not found: Java 21 required");
    }
}
