//! OS Keyring and encrypted credential store interface.

pub const SERVICE_NAME: &str = "com.focusite.launcher";

pub struct CredentialStore;

impl CredentialStore {
    pub fn save_token(account_id: &str, token: &str) -> Result<(), std::io::Error> {
        // Will interface with OS keyring in Phase 3
        let _ = (account_id, token);
        Ok(())
    }

    pub fn get_token(account_id: &str) -> Result<Option<String>, std::io::Error> {
        let _ = account_id;
        Ok(None)
    }
}
