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
    base_dir.join("accounts.json")
}

/// Serialises read-modify-write cycles on `accounts.json`, so a background profile refresh cannot
/// overwrite a login, removal or account switch made at the same time.
static ACCOUNTS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn load_account_store() -> AccountStoreFile {
    let path = get_accounts_file_path();
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(decrypted_json) = focusite_auth::dpapi::decrypt_account_data(&bytes) {
            if let Ok(store) = serde_json::from_str::<AccountStoreFile>(&decrypted_json) {
                return store;
            }
        }
        // Unreadable store: move it aside once, so it is kept for recovery and not copied on every read.
        let backup = path.with_extension(format!("json.bad-{}", chrono::Utc::now().timestamp()));
        let _ = fs::rename(&path, &backup);
    }
    AccountStoreFile {
        active_account_id: None,
        accounts: Vec::new(),
    }
}

fn save_account_store(store: &AccountStoreFile) -> Result<(), String> {
    let path = get_accounts_file_path();
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("儲存帳號資料失敗（序列化）：{}", e))?;
    let encrypted = focusite_auth::dpapi::encrypt_account_data(&json)
        .map_err(|e| format!("儲存帳號資料失敗（加密）：{}", e))?;
    super::atomic_write(&path, &encrypted)
        .map_err(|e| format!("儲存帳號資料失敗（寫入）：{}", e))?;
    Ok(())
}

/// Reads the store, applies `change`, and writes it back only when `change` succeeds, all under one lock.
fn update_account_store<T>(
    change: impl FnOnce(&mut AccountStoreFile) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = ACCOUNTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut store = load_account_store();
    let out = change(&mut store)?;
    save_account_store(&store)?;
    Ok(out)
}

/// Skin URL, skin model and the active cape URL of a profile.
fn skin_fields(profile: &xbox::MinecraftProfileResponse) -> (Option<String>, Option<String>, Option<String>) {
    let skin = profile.skins.first();
    let model = if skin.is_some_and(|s| s.is_slim()) { "slim" } else { "default" };
    let cape = profile.capes.iter().find(|c| c.state == "ACTIVE").map(|c| c.url.clone());
    (skin.map(|s| s.url.clone()), Some(model.to_string()), cape)
}

#[tauri::command]
pub fn auth_check_client_id() -> Result<bool, String> {
    Ok(oauth::get_microsoft_client_id().is_ok())
}

const MISSING_CLIENT_ID: &str =
    "缺少 MICROSOFT_CLIENT_ID。開發時請寫在專案根目錄的 .env；發布版需在建置時設定此環境變數。";

#[tauri::command]
pub async fn auth_start_device_code() -> Result<DeviceCodeResponse, String> {
    let client_id = oauth::get_microsoft_client_id().map_err(|_| MISSING_CLIENT_ID.to_string())?;
    oauth::start_device_code(super::http(), &client_id)
        .await
        .map_err(|e| format!("啟動裝置登入失敗: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicePollResult {
    pub status: String, // "pending" | "slow_down" | "success" | "expired" | "error"
    pub account: Option<UserAccountDto>,
    pub error_message: Option<String>,
}

impl DevicePollResult {
    fn waiting(status: &str, error_message: Option<String>) -> Self {
        Self { status: status.into(), account: None, error_message }
    }
}

#[tauri::command]
pub async fn auth_poll_device_code(device_code: String) -> Result<DevicePollResult, String> {
    let client_id = oauth::get_microsoft_client_id().map_err(|_| MISSING_CLIENT_ID.to_string())?;
    let client = super::http();
    let (status, maybe_token) = oauth::poll_device_code_once(client, &client_id, &device_code)
        .await
        .map_err(|e| format!("輪詢認證失敗: {}", e))?;

    let token_resp = match status {
        oauth::DeviceCodePollStatus::Pending => return Ok(DevicePollResult::waiting("pending", None)),
        oauth::DeviceCodePollStatus::SlowDown => return Ok(DevicePollResult::waiting("slow_down", None)),
        oauth::DeviceCodePollStatus::Expired => {
            return Ok(DevicePollResult::waiting("expired", Some("裝置登入代碼已逾時，請重新獲取代碼".into())))
        }
        oauth::DeviceCodePollStatus::Error(err) => return Ok(DevicePollResult::waiting("error", Some(err))),
        oauth::DeviceCodePollStatus::Success => maybe_token.ok_or("登入回應缺少憑證，請重試")?,
    };

    let (mc_auth, profile) = xbox::login_chain(client, &token_resp.access_token)
        .await
        .map_err(|e| format!("Minecraft 登入流程失敗：{}", e))?;

    if let Err(e) = focusite_auth::keyring_store::CredentialStore::save_credentials(
        &profile.id,
        &mc_auth.access_token,
        token_resp.refresh_token.as_deref(),
    ) {
        tracing::warn!("Failed to save credentials to keyring: {}", e);
    }

    let (skin_url, skin_model, cape_url) = skin_fields(&profile);
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

    update_account_store(|store| {
        for acc in &mut store.accounts {
            acc.is_active = false;
        }
        match store.accounts.iter_mut().find(|a| a.id == new_account.id) {
            Some(existing) => *existing = new_account.clone(),
            None => store.accounts.push(new_account.clone()),
        }
        store.active_account_id = Some(new_account.id.clone());
        Ok(())
    })?;

    Ok(DevicePollResult { status: "success".into(), account: Some(new_account), error_message: None })
}

#[tauri::command]
pub async fn auth_list_accounts() -> Result<Vec<UserAccountDto>, String> {
    tokio::task::spawn_blocking(|| {
        let store = load_account_store();
        Ok(store.accounts)
    })
    .await
    .map_err(|e| format!("背景工作執行失敗：{}", e))?
}

#[tauri::command]
pub fn auth_remove_account(id: String) -> Result<(), String> {
    let _ = focusite_auth::keyring_store::CredentialStore::delete_token(&id);
    update_account_store(|store| {
        store.accounts.retain(|a| a.id != id);
        if store.active_account_id.as_deref() == Some(&id) {
            store.active_account_id = store.accounts.first().map(|a| a.id.clone());
            for acc in &mut store.accounts {
                acc.is_active = store.active_account_id.as_deref() == Some(&acc.id);
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub fn auth_set_active_account(id: String) -> Result<(), String> {
    update_account_store(|store| {
        for acc in &mut store.accounts {
            acc.is_active = acc.id == id;
        }
        store.active_account_id = Some(id);
        Ok(())
    })
}

#[tauri::command]
pub fn auth_update_account_skin(
    id: String,
    skin_url: Option<String>,
    cape_url: Option<String>,
) -> Result<(), String> {
    update_account_store(|store| {
        if let Some(acc) = store.accounts.iter_mut().find(|a| a.id == id) {
            if skin_url.is_some() {
                acc.skin_url = skin_url;
            }
            acc.cape_url = cape_url;
        }
        Ok(())
    })
}

/// Trades a refresh token for a new Minecraft token and profile, saving the new credentials.
async fn silent_refresh(
    client: &reqwest::Client,
    id: &str,
    old_mc_token: &str,
    refresh_token: &str,
) -> Result<xbox::MinecraftProfileResponse, String> {
    let client_id = oauth::get_microsoft_client_id().map_err(|e| e.to_string())?;
    let new_oauth = oauth::refresh_oauth_token(client, &client_id, refresh_token)
        .await
        .map_err(|e| e.to_string())?;
    let refresh = new_oauth.refresh_token.as_deref().unwrap_or(refresh_token);
    // Microsoft rotates refresh tokens: keep the new one now, so a failure in a later step cannot lose it.
    let _ = focusite_auth::keyring_store::CredentialStore::save_credentials(id, old_mc_token, Some(refresh));
    let (mc, profile) = xbox::login_chain(client, &new_oauth.access_token)
        .await
        .map_err(|e| e.to_string())?;
    let _ = focusite_auth::keyring_store::CredentialStore::save_credentials(id, &mc.access_token, Some(refresh));
    Ok(profile)
}

#[tauri::command]
pub async fn auth_refresh_profile(id: String) -> Result<UserAccountDto, String> {
    let client = super::http();
    let maybe_creds = focusite_auth::keyring_store::CredentialStore::get_credentials(&id)
        .map_err(|e| format!("讀取憑證失敗: {}", e))?;
    let had_creds = maybe_creds.is_some();

    // 1. The cached Minecraft token; when it has expired, a silent refresh with the Microsoft refresh token.
    let mut profile = None;
    if let Some((mc_token, maybe_refresh)) = maybe_creds {
        match xbox::fetch_minecraft_profile(client, &mc_token).await {
            Ok(p) => profile = Some(p),
            Err(_) => {
                if let Some(refresh_token) = maybe_refresh {
                    match silent_refresh(client, &id, &mc_token, &refresh_token).await {
                        Ok(p) => profile = Some(p),
                        Err(e) => tracing::warn!("帳號 {} 靜默刷新失敗：{}", id, e),
                    }
                }
            }
        }
    }
    let has_token = profile.is_some();

    // 2. Without a working token, refresh the public skin and cape from the Mojang session server.
    let public_profile = match profile {
        Some(_) => None,
        None => xbox::fetch_public_session_profile(client, &id).await.ok(),
    };

    // The store is read after every network wait, under the lock, so changes made meanwhile are kept.
    update_account_store(|store| {
        let acc = store
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "找不到對應帳號".to_string())?;
        if let Some(p) = profile {
            let (skin_url, skin_model, active_cape) = skin_fields(&p);
            acc.username = p.name;
            acc.skin_url = skin_url;
            acc.skin_model = skin_model;
            if acc.cape_url.is_none() {
                acc.cape_url = active_cape;
            }
            acc.capes = p.capes;
        } else if let Some(pub_p) = public_profile {
            acc.username = pub_p.name;
            if pub_p.skin_url.is_some() {
                acc.skin_url = pub_p.skin_url;
            }
            if pub_p.skin_model.is_some() {
                acc.skin_model = pub_p.skin_model;
            }
            if pub_p.cape_url.is_some() && acc.cape_url.is_none() {
                acc.cape_url = pub_p.cape_url;
            }
        }
        // Stored credentials that could not be checked (offline) are not proof of a dead login:
        // report "no valid token" for this launch, but do not write it to disk.
        if has_token || !had_creds {
            acc.has_valid_token = has_token;
        }
        let mut updated = acc.clone();
        updated.has_valid_token = has_token;
        Ok(updated)
    })
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

/// Ensures valid credentials exist for launching: auto-refreshes tokens if needed,
/// returns (player_name, uuid, access_token, user_type).
pub async fn ensure_valid_minecraft_token(
    account_id: Option<&str>,
) -> Result<(String, String, String, String), String> {
    let store = load_account_store();
    let target_acc = if let Some(id) = account_id {
        store.accounts.iter().find(|a| a.id == id)
    } else if let Some(ref active_id) = store.active_account_id {
        store.accounts.iter().find(|a| &a.id == active_id)
    } else {
        store.accounts.first()
    };

    let acc = match target_acc {
        Some(a) => a,
        None => {
            return Err("未配置有效的微軟帳號，請先登入帳號".into());
        }
    };

    // Attempt token refresh and profile sync
    let refreshed = auth_refresh_profile(acc.id.clone()).await;
    match refreshed {
        Ok(refreshed_acc) => {
            // A stale keyring token must not be passed off as a valid session.
            let token = if refreshed_acc.has_valid_token {
                focusite_auth::keyring_store::CredentialStore::get_token(&refreshed_acc.id)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "0".into())
            } else {
                "0".into()
            };
            let user_type = if token == "0" { "legacy" } else { "msa" };
            Ok((
                refreshed_acc.username,
                refreshed_acc.id,
                token,
                user_type.to_string(),
            ))
        }
        Err(_) => {
            // Offline fallback: verified account is allowed offline play
            if acc.is_ready {
                Ok((
                    acc.username.clone(),
                    acc.id.clone(),
                    "0".into(),
                    "legacy".into(),
                ))
            } else {
                Err("無法驗證微軟帳號，請檢查網路連線或重新登入".into())
            }
        }
    }
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
}
