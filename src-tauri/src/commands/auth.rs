//! Microsoft Device Code authentication and account persistence commands.

use focusite_auth::oauth::{self, DeviceCodeResponse};
use focusite_auth::xbox;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAccountDto {
    pub id: String,
    pub username: String,
    pub account_type: String,
    pub is_ready: bool,
    pub skin_url: Option<String>,
    pub skin_model: Option<String>,
    pub cape_url: Option<String>,
    #[serde(default)]
    pub capes: Vec<xbox::MinecraftCapeInfo>,
    pub is_active: bool,
    #[serde(default)]
    pub has_valid_token: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountStoreFile {
    pub active_account_id: Option<String>,
    pub accounts: Vec<UserAccountDto>,
}

fn get_accounts_file_path() -> PathBuf {
    let base_dir = super::get_app_data_dir();
    let target = base_dir.join("accounts.json");

    // 平滑遷移舊帳號檔案 (若目標不存在，但舊目錄有 accounts.json 則自動複製保留)
    if !target.exists() {
        let legacy_candidates = vec![
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("accounts.json"),
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("src-tauri")
                .join("accounts.json"),
        ];
        for candidate in legacy_candidates {
            if candidate.is_file() {
                if let Ok(content) = fs::read_to_string(&candidate) {
                    let _ = fs::write(&target, content);
                    break;
                }
            }
        }
    }

    target
}

fn load_account_store() -> AccountStoreFile {
    let path = get_accounts_file_path();
    if path.is_file() {
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(decrypted_json) = focusite_auth::dpapi::decrypt_account_data(&bytes) {
                if let Ok(store) = serde_json::from_str::<AccountStoreFile>(&decrypted_json) {
                    return store;
                }
            }
        }
    }
    AccountStoreFile {
        active_account_id: None,
        accounts: Vec::new(),
    }
}

fn save_account_store(store: &AccountStoreFile) -> Result<(), String> {
    let path = get_accounts_file_path();
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize accounts: {}", e))?;
    let encrypted = focusite_auth::dpapi::encrypt_account_data(&json)
        .map_err(|e| format!("Failed to DPAPI encrypt accounts: {}", e))?;
    fs::write(path, encrypted).map_err(|e| format!("Failed to write accounts.json: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn auth_check_client_id() -> Result<bool, String> {
    let _ = dotenvy::dotenv();
    Ok(oauth::get_microsoft_client_id().is_ok())
}

#[tauri::command]
pub async fn auth_start_device_code() -> Result<DeviceCodeResponse, String> {
    let _ = dotenvy::dotenv();
    let client_id = oauth::get_microsoft_client_id().map_err(|_| {
        "未於 .env 設定 MICROSOFT_CLIENT_ID。請在專案根目錄建立 .env 並填寫 Azure Client ID。"
            .to_string()
    })?;

    let client = reqwest::Client::new();
    oauth::start_device_code(&client, &client_id)
        .await
        .map_err(|e| format!("啟動裝置登入失敗: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePollResult {
    pub status: String, // "pending" | "slow_down" | "success" | "expired" | "error"
    pub account: Option<UserAccountDto>,
    pub error_message: Option<String>,
}

#[tauri::command]
pub async fn auth_poll_device_code(device_code: String) -> Result<DevicePollResult, String> {
    let client_id = match oauth::get_microsoft_client_id() {
        Ok(id) => id,
        Err(_) => return Err("未於 .env 設定 MICROSOFT_CLIENT_ID".into()),
    };

    let client = reqwest::Client::new();
    let (status, maybe_token) = oauth::poll_device_code_once(&client, &client_id, &device_code)
        .await
        .map_err(|e| format!("輪詢認證失敗: {}", e))?;

    match status {
        oauth::DeviceCodePollStatus::Pending => Ok(DevicePollResult {
            status: "pending".into(),
            account: None,
            error_message: None,
        }),
        oauth::DeviceCodePollStatus::SlowDown => Ok(DevicePollResult {
            status: "slow_down".into(),
            account: None,
            error_message: None,
        }),
        oauth::DeviceCodePollStatus::Expired => Ok(DevicePollResult {
            status: "expired".into(),
            account: None,
            error_message: Some("裝置登入代碼已逾時，請重新獲取代碼".into()),
        }),
        oauth::DeviceCodePollStatus::Error(err) => Ok(DevicePollResult {
            status: "error".into(),
            account: None,
            error_message: Some(err),
        }),
        oauth::DeviceCodePollStatus::Success => {
            let token_resp = match maybe_token {
                Some(t) => t,
                None => return Err("Missing token in success response".into()),
            };

            // Full Minecraft chain
            let (xbl_token, _) = xbox::authenticate_xbox_live(&client, &token_resp.access_token)
                .await
                .map_err(|e| format!("Xbox Live 登入失敗: {}", e))?;

            let (xsts_token, uhs) = xbox::obtain_xsts_token(&client, &xbl_token)
                .await
                .map_err(|e| format!("XSTS 權限交換失敗: {}", e))?;

            let mc_auth = xbox::login_minecraft_with_xbox(&client, &uhs, &xsts_token)
                .await
                .map_err(|e| format!("Minecraft 服務驗證失敗: {}", e))?;

            let profile = xbox::fetch_minecraft_profile(&client, &mc_auth.access_token)
                .await
                .map_err(|e| format!("獲取 Minecraft 個人檔案失敗: {}", e))?;

            let skin_url = profile.skins.first().map(|s| s.url.clone());
            let skin_model = if profile.skins.first().is_some_and(|s| s.is_slim()) {
                Some("slim".to_string())
            } else {
                Some("default".to_string())
            };
            let cape_url = profile
                .capes
                .iter()
                .find(|c| c.state == "ACTIVE")
                .map(|c| c.url.clone());

            // Save access token AND refresh token into OS native Keyring
            if let Err(e) = focusite_auth::keyring_store::CredentialStore::save_credentials(
                &profile.id,
                &mc_auth.access_token,
                token_resp.refresh_token.as_deref(),
            ) {
                tracing::warn!("Failed to save credentials to keyring: {}", e);
            }

            let mut store = load_account_store();
            let new_account = UserAccountDto {
                id: profile.id.clone(),
                username: profile.name,
                account_type: "microsoft".into(),
                is_ready: true,
                skin_url,
                skin_model,
                cape_url,
                capes: profile.capes,
                is_active: true,
                has_valid_token: true,
            };

            // Set all existing accounts to inactive, then upsert
            for acc in &mut store.accounts {
                acc.is_active = false;
            }
            if let Some(pos) = store.accounts.iter().position(|a| a.id == new_account.id) {
                store.accounts[pos] = new_account.clone();
            } else {
                store.accounts.push(new_account.clone());
            }
            store.active_account_id = Some(new_account.id.clone());
            save_account_store(&store)?;

            Ok(DevicePollResult {
                status: "success".into(),
                account: Some(new_account),
                error_message: None,
            })
        }
    }
}

#[tauri::command]
pub async fn auth_list_accounts() -> Result<Vec<UserAccountDto>, String> {
    tokio::task::spawn_blocking(|| {
        let store = load_account_store();
        Ok(store.accounts)
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?
}

#[tauri::command]
pub fn auth_remove_account(id: String) -> Result<(), String> {
    // Delete token from OS native Keyring
    let _ = focusite_auth::keyring_store::CredentialStore::delete_token(&id);

    let mut store = load_account_store();
    store.accounts.retain(|a| a.id != id);
    if store.active_account_id.as_deref() == Some(&id) {
        store.active_account_id = store.accounts.first().map(|a| a.id.clone());
        if let Some(ref first_id) = store.active_account_id {
            for acc in &mut store.accounts {
                acc.is_active = acc.id == *first_id;
            }
        }
    }
    save_account_store(&store)
}

#[tauri::command]
pub fn auth_set_active_account(id: String) -> Result<(), String> {
    let mut store = load_account_store();
    for acc in &mut store.accounts {
        acc.is_active = acc.id == id;
    }
    store.active_account_id = Some(id);
    save_account_store(&store)
}

#[tauri::command]
pub fn auth_update_account_skin(
    id: String,
    skin_url: Option<String>,
    cape_url: Option<String>,
) -> Result<(), String> {
    let mut store = load_account_store();
    if let Some(acc) = store.accounts.iter_mut().find(|a| a.id == id) {
        if skin_url.is_some() {
            acc.skin_url = skin_url;
        }
        acc.cape_url = cape_url;
        save_account_store(&store)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn auth_refresh_profile(id: String) -> Result<UserAccountDto, String> {
    let client = reqwest::Client::new();
    let maybe_creds = focusite_auth::keyring_store::CredentialStore::get_credentials(&id)
        .map_err(|e| format!("讀取憑證失敗: {}", e))?;

    let mut final_profile: Option<xbox::MinecraftProfileResponse> = None;
    let mut has_token = false;

    if let Some((mc_token, maybe_refresh)) = maybe_creds {
        // 1. 嘗試以快取的 Minecraft Access Token 查詢官方完整個人檔案與持有披風
        match xbox::fetch_minecraft_profile(&client, &mc_token).await {
            Ok(p) => {
                final_profile = Some(p);
                has_token = true;
            }
            Err(_) => {
                // Token 已過期：若持有微軟 Refresh Token 則執行全自動靜默刷新
                if let Some(refresh_token) = maybe_refresh {
                    let _ = dotenvy::dotenv();
                    if let Ok(client_id) = oauth::get_microsoft_client_id() {
                        if let Ok(new_oauth) = oauth::refresh_oauth_token(&client, &client_id, &refresh_token).await {
                            if let Ok((new_xbl, _)) = xbox::authenticate_xbox_live(&client, &new_oauth.access_token).await {
                                if let Ok((new_xsts, uhs)) = xbox::obtain_xsts_token(&client, &new_xbl).await {
                                    if let Ok(new_mc) = xbox::login_minecraft_with_xbox(&client, &uhs, &new_xsts).await {
                                        if let Ok(p) = xbox::fetch_minecraft_profile(&client, &new_mc.access_token).await {
                                            // 自動保存新憑證至 Keyring
                                            let _ = focusite_auth::keyring_store::CredentialStore::save_credentials(
                                                &id,
                                                &new_mc.access_token,
                                                new_oauth.refresh_token.as_deref().or(Some(&refresh_token)),
                                            );
                                            final_profile = Some(p);
                                            has_token = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut store = load_account_store();
    let acc_pos = store.accounts.iter().position(|a| a.id == id);

    if let Some(profile) = final_profile {
        let skin_url = profile.skins.first().map(|s| s.url.clone());
        let skin_model = if profile.skins.first().is_some_and(|s| s.is_slim()) {
            Some("slim".to_string())
        } else {
            Some("default".to_string())
        };
        let active_cape_url = profile
            .capes
            .iter()
            .find(|c| c.state == "ACTIVE")
            .map(|c| c.url.clone());

        if let Some(pos) = acc_pos {
            store.accounts[pos].username = profile.name;
            store.accounts[pos].skin_url = skin_url;
            store.accounts[pos].skin_model = skin_model;
            if store.accounts[pos].cape_url.is_none() {
                store.accounts[pos].cape_url = active_cape_url;
            }
            store.accounts[pos].capes = profile.capes;
            store.accounts[pos].has_valid_token = true;
            let updated = store.accounts[pos].clone();
            save_account_store(&store)?;
            return Ok(updated);
        }
    }

    // 2. 查無 Token 或 Token 已完全過期無法自動刷新：從 Mojang Session Server 自動刷新公開資訊 (Skin & Model & Active Cape)
    let public_profile = xbox::fetch_public_session_profile(&client, &id).await;

    if let Some(pos) = acc_pos {
        if let Ok(pub_p) = public_profile {
            store.accounts[pos].username = pub_p.name;
            if pub_p.skin_url.is_some() {
                store.accounts[pos].skin_url = pub_p.skin_url;
            }
            if pub_p.skin_model.is_some() {
                store.accounts[pos].skin_model = pub_p.skin_model;
            }
            if pub_p.cape_url.is_some() && store.accounts[pos].cape_url.is_none() {
                store.accounts[pos].cape_url = pub_p.cape_url;
            }
        }
        store.accounts[pos].has_valid_token = has_token;
        let updated = store.accounts[pos].clone();
        save_account_store(&store)?;
        return Ok(updated);
    }

    Err("找不到對應帳號".to_string())
}

#[tauri::command]
pub fn auth_verify_offline_launch(id: String) -> Result<bool, String> {
    let store = load_account_store();
    let account = store
        .accounts
        .iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "帳號不存在於本機帳號清單中".to_string())?;

    // Check if token exists in Keyring
    let has_stored_token = focusite_auth::keyring_store::CredentialStore::get_token(&id)
        .map_err(|e| format!("查詢安全憑證庫失敗: {}", e))?
        .is_some();

    // Verify offline entitlement gate
    focusite_auth::offline_gate::OfflineGate::verify_offline_launch(
        account.is_ready,
        true,
        has_stored_token,
    )
    .map_err(|e| format!("離線遊玩權限校驗失敗: {}", e))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dpapi_store_roundtrip_logic() {
        let store = AccountStoreFile {
            active_account_id: Some("test_acc_123".into()),
            accounts: vec![UserAccountDto {
                id: "test_acc_123".into(),
                username: "Tester".into(),
                account_type: "microsoft".into(),
                is_ready: true,
                skin_url: None,
                skin_model: Some("slim".into()),
                cape_url: None,
                capes: Vec::new(),
                is_active: true,
                has_valid_token: false,
            }],
        };

        let json = serde_json::to_string(&store).unwrap();
        let encrypted = focusite_auth::dpapi::encrypt_account_data(&json).unwrap();
        assert!(encrypted.starts_with(focusite_auth::dpapi::MAGIC_HEADER));

        let decrypted = focusite_auth::dpapi::decrypt_account_data(&encrypted).unwrap();
        let restored: AccountStoreFile = serde_json::from_str(&decrypted).unwrap();
        assert_eq!(restored.active_account_id.as_deref(), Some("test_acc_123"));
        assert_eq!(restored.accounts[0].username, "Tester");
        assert_eq!(restored.accounts[0].skin_model.as_deref(), Some("slim"));
    }

    #[test]
    fn test_migrate_and_encrypt_existing_accounts_file() {
        let store = load_account_store();
        if !store.accounts.is_empty() {
            save_account_store(&store).unwrap();
            let path = get_accounts_file_path();
            let bytes = fs::read(&path).unwrap();
            assert!(bytes.starts_with(focusite_auth::dpapi::MAGIC_HEADER));
        }
    }
}
