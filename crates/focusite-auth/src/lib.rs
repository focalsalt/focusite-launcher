//! Focusite Auth: Microsoft OAuth 2.0 PKCE, Xbox Live token exchange, and offline entitlement gate.

pub mod keyring_store;
pub mod oauth;
pub mod offline_gate;
pub mod profile;
pub mod xbox;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),

    #[error("JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("User does not own Minecraft Java Edition")]
    NoMinecraftEntitlement,

    #[error("Offline play forbidden: no cached valid Microsoft credentials found")]
    OfflineForbidden,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_error_display() {
        let err = AuthError::NoMinecraftEntitlement;
        assert_eq!(err.to_string(), "User does not own Minecraft Java Edition");

        let offline_err = AuthError::OfflineForbidden;
        assert_eq!(
            offline_err.to_string(),
            "Offline play forbidden: no cached valid Microsoft credentials found"
        );
    }
}
