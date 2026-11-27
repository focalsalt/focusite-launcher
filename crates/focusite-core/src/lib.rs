//! Focusite Core: Minecraft manifest parsing, JVM argument building, and process management.

pub mod args;
pub mod instance;
pub mod installer;
pub mod java;
pub mod manifest;
pub mod mod_side;
pub mod process;
pub mod server;
pub mod slp;
pub mod world;

pub use args::{build_launch_arguments, LaunchContext, QuickPlayTarget};
pub use server::{read_servers_dat, write_servers_dat, ServerEntry};
pub use slp::{ping_minecraft_server, ServerPingResult};
pub use world::{backup_world, delete_world, list_instance_worlds, parse_level_dat, rename_world, WorldSummary};

/// HTTP client for metadata requests. Connect and read time limits only: a total limit would fail
/// the large version manifest on a slow connection even while data keeps arriving.
pub(crate) fn http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .user_agent(concat!("Focusite-Launcher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
}

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

    #[error("Resource not found: {0}")]
    NotFound(String),

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
