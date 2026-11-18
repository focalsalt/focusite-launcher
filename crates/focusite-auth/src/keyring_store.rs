//! OS Keyring and encrypted credential store interface.
//!
//! Stores and retrieves authentication tokens using the operating system's native
//! secure credential vault (Windows Credential Manager, macOS Keychain, Linux Secret Service)
//! to prevent sensitive tokens from residing in plaintext on disk.

use crate::AuthError;
use keyring::Entry;

pub const SERVICE_NAME: &str = "com.focusite.launcher";

/// Max characters per keyring entry (Windows allows 2560); kept well below it.
const CHUNK_SIZE: usize = 1000;
/// Prefix of the main entry's value when the real value is split across `{id}#0`, `{id}#1`, ...
const CHUNK_MARKER: &str = "\u{1}chunks:";

pub struct CredentialStore;

impl CredentialStore {
    fn entry(name: &str) -> Result<Entry, AuthError> {
        Entry::new(SERVICE_NAME, name)
            .map_err(|e| AuthError::KeyringError(format!("Failed to create keyring entry: {}", e)))
    }

    fn read_entry(name: &str) -> Result<Option<String>, AuthError> {
        match Self::entry(name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AuthError::KeyringError(format!("Failed to read keyring password: {}", e))),
        }
    }

    fn write_entry(name: &str, value: &str) -> Result<(), AuthError> {
        Self::entry(name)?
            .set_password(value)
            .map_err(|e| AuthError::KeyringError(format!("Failed to set keyring password: {}", e)))
    }

    /// Number of extra chunk entries a stored value was split into (0 when it fits in one entry).
    fn chunk_count(main: &str) -> usize {
        main.strip_prefix(CHUNK_MARKER).and_then(|n| n.parse().ok()).unwrap_or(0)
    }

    /// Removes the chunk entries recorded in the main entry's value.
    fn delete_chunks(account_id: &str, main: &str) {
        for i in 0..Self::chunk_count(main) {
            if let Ok(e) = Self::entry(&format!("{account_id}#{i}")) {
                let _ = e.delete_credential();
            }
        }
    }

    /// Saves an authentication token into the OS secure credential store.
    ///
    /// Windows Credential Manager rejects values over 2560 characters, and a Minecraft token plus a
    /// Microsoft refresh token exceeds that, so longer values are split across several entries.
    pub fn save_token(account_id: &str, token: &str) -> Result<(), AuthError> {
        if let Ok(Some(old)) = Self::read_entry(account_id) {
            Self::delete_chunks(account_id, &old);
        }
        let chars: Vec<char> = token.chars().collect();
        if chars.len() <= CHUNK_SIZE {
            return Self::write_entry(account_id, token);
        }
        let chunks: Vec<String> = chars.chunks(CHUNK_SIZE).map(|c| c.iter().collect()).collect();
        for (i, chunk) in chunks.iter().enumerate() {
            Self::write_entry(&format!("{account_id}#{i}"), chunk)?;
        }
        Self::write_entry(account_id, &format!("{CHUNK_MARKER}{}", chunks.len()))
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
        let Some(main) = Self::read_entry(account_id)? else {
            return Ok(None);
        };
        let n = Self::chunk_count(&main);
        if n == 0 {
            return Ok(Some(main));
        }
        let mut out = String::new();
        for i in 0..n {
            match Self::read_entry(&format!("{account_id}#{i}"))? {
                Some(part) => out.push_str(&part),
                // A missing part means the value is incomplete; treat it as not stored.
                None => return Ok(None),
            }
        }
        Ok(Some(out))
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
        if let Ok(Some(main)) = Self::read_entry(account_id) {
            Self::delete_chunks(account_id, &main);
        }
        let entry = Self::entry(account_id)?;
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

    #[test]
    fn test_long_credentials_roundtrip() {
        // A Minecraft token plus a Microsoft refresh token is far larger than one Windows credential allows.
        let test_account = format!("test_acc_{}", uuid::Uuid::new_v4());
        let mc = "m".repeat(1500);
        let refresh = "r".repeat(1800);
        CredentialStore::save_credentials(&test_account, &mc, Some(&refresh)).expect("Save should succeed");
        let (got_mc, got_refresh) = CredentialStore::get_credentials(&test_account)
            .expect("Read should succeed")
            .expect("Credentials should exist");
        assert_eq!(got_mc, mc);
        assert_eq!(got_refresh.as_deref(), Some(refresh.as_str()));
        CredentialStore::delete_token(&test_account).expect("Delete should succeed");
        assert_eq!(CredentialStore::get_token(&test_account).unwrap(), None);
    }
}
