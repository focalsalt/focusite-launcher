//! OS Keyring and encrypted credential store interface.
//!
//! Stores and retrieves authentication tokens using the operating system's native
//! secure credential vault (Windows Credential Manager, macOS Keychain, Linux Secret Service)
//! to prevent sensitive tokens from residing in plaintext on disk.

use crate::AuthError;
use keyring::Entry;

pub const SERVICE_NAME: &str = "com.focusite.launcher";

pub struct CredentialStore;

impl CredentialStore {
    /// Saves an authentication token into the OS secure credential store.
    pub fn save_token(account_id: &str, token: &str) -> Result<(), AuthError> {
        let entry = Entry::new(SERVICE_NAME, account_id)
            .map_err(|e| AuthError::KeyringError(format!("Failed to create keyring entry: {}", e)))?;
        entry
            .set_password(token)
            .map_err(|e| AuthError::KeyringError(format!("Failed to set keyring password: {}", e)))?;
        Ok(())
    }

    /// Saves full authentication bundle (Minecraft token and Microsoft refresh token).
    pub fn save_credentials(
        account_id: &str,
        mc_token: &str,
        refresh_token: Option<&str>,
    ) -> Result<(), AuthError> {
        let bundle = serde_json::json!({
            "mc_access_token": mc_token,
            "ms_refresh_token": refresh_token,
        });
        Self::save_token(account_id, &bundle.to_string())
    }

    /// Retrieves an authentication token from the OS secure credential store.
    ///
    /// Returns `Ok(None)` if no entry exists for this account.
    pub fn get_token(account_id: &str) -> Result<Option<String>, AuthError> {
        let entry = Entry::new(SERVICE_NAME, account_id)
            .map_err(|e| AuthError::KeyringError(format!("Failed to create keyring entry: {}", e)))?;
        match entry.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AuthError::KeyringError(format!("Failed to read keyring password: {}", e))),
        }
    }

    /// Retrieves credentials tuple (mc_access_token, Option<ms_refresh_token>).
    pub fn get_credentials(
        account_id: &str,
    ) -> Result<Option<(String, Option<String>)>, AuthError> {
        match Self::get_token(account_id)? {
            Some(val) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&val) {
                    if let Some(mc) = v.get("mc_access_token").and_then(|s| s.as_str()) {
                        let refresh = v.get("ms_refresh_token").and_then(|s| s.as_str()).map(|s| s.to_string());
                        return Ok(Some((mc.to_string(), refresh)));
                    }
                }
                // Legacy plain token
                Ok(Some((val, None)))
            }
            None => Ok(None),
        }
    }

    /// Deletes an authentication token from the OS secure credential store.
    ///
    /// Returns `Ok(())` even if the entry did not exist.
    pub fn delete_token(account_id: &str) -> Result<(), AuthError> {
        let entry = Entry::new(SERVICE_NAME, account_id)
            .map_err(|e| AuthError::KeyringError(format!("Failed to create keyring entry: {}", e)))?;
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AuthError::KeyringError(format!("Failed to delete keyring credential: {}", e))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credential_store_lifecycle() {
        let test_account = format!("test_acc_{}", uuid::Uuid::new_v4());
        let test_token = "secret_mc_token_123456";

        // Initial fetch should return None
        let initial = CredentialStore::get_token(&test_account).expect("Initial read should succeed");
        assert_eq!(initial, None);

        // Save token
        CredentialStore::save_token(&test_account, test_token).expect("Save token should succeed");

        // Read back token
        let retrieved = CredentialStore::get_token(&test_account).expect("Read token should succeed");
        assert_eq!(retrieved, Some(test_token.to_string()));

        // Delete token
        CredentialStore::delete_token(&test_account).expect("Delete token should succeed");

        // Subsequent read should be None again
        let after_delete = CredentialStore::get_token(&test_account).expect("Post-delete read should succeed");
        assert_eq!(after_delete, None);
    }
}
