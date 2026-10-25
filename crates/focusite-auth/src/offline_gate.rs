//! Enforces the product policy: offline mode is only permitted if a valid Microsoft account was previously verified.

use crate::profile::AuthProfile;
use crate::AuthError;

pub struct OfflineGate;

impl OfflineGate {
    /// Validates whether the given profile qualifies for offline play.
    pub fn check_offline_permission(profile: Option<&AuthProfile>) -> Result<(), AuthError> {
        match profile {
            Some(p) if p.has_entitlement && p.is_offline_ready => Ok(()),
            _ => Err(AuthError::OfflineForbidden),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_offline_gate_blocks_unverified() {
        assert!(OfflineGate::check_offline_permission(None).is_err());

        let invalid = AuthProfile {
            id: "1".into(),
            username: "Fake".into(),
            xbox_gamertag: "Fake".into(),
            access_token: "".into(),
            refresh_token: None,
            expires_at: 0,
            has_entitlement: false,
            skin_url: None,
            is_offline_ready: false,
        };
        assert!(OfflineGate::check_offline_permission(Some(&invalid)).is_err());
    }

    #[test]
    fn test_offline_gate_allows_verified() {
        let valid = AuthProfile {
            id: "1".into(),
            username: "Steve".into(),
            xbox_gamertag: "SteveGT".into(),
            access_token: "cached_token".into(),
            refresh_token: None,
            expires_at: 9999999999,
            has_entitlement: true,
            skin_url: None,
            is_offline_ready: true,
        };
        assert!(OfflineGate::check_offline_permission(Some(&valid)).is_ok());
    }
}
