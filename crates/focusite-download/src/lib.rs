//! Focusite Download: High-performance concurrent chunked downloader with official CDN priority and dynamic mirror fallback.

pub mod chunked;
pub mod downloader;
pub mod mirror;
pub mod validator;

pub use chunked::{DownloadProgress, DownloadTask};
pub use downloader::Downloader;
pub use mirror::{MirrorManager, MirrorProvider};
pub use validator::ChecksumValidator;

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("All download sources failed for {url}")]
    AllSourcesFailed { url: String },

    #[error("SHA-1 validation failed for {path}: expected {expected}, got {actual}")]
    ValidationFailed {
        path: String,
        expected: String,
        actual: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_error_display() {
        let err = DownloadError::AllSourcesFailed {
            url: "https://launchermeta.mojang.com".into(),
        };
        assert_eq!(
            err.to_string(),
            "All download sources failed for https://launchermeta.mojang.com"
        );

        let val_err = DownloadError::ValidationFailed {
            path: "game.jar".into(),
            expected: "abc".into(),
            actual: "def".into(),
        };
        assert_eq!(
            val_err.to_string(),
            "SHA-1 validation failed for game.jar: expected abc, got def"
        );
    }
}
