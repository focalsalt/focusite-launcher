//! Local skin file management under %APPDATA%/focusite_launcher/skins/.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinItemDto {
    pub id: String,
    pub filename: String,
    pub name: String,
    pub path: String,
    pub bytes: Vec<u8>,
}

pub fn get_skins_dir() -> PathBuf {
    let base = super::get_app_data_dir();
    let dir = base.join("skins");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

#[tauri::command]
pub fn skin_list_local() -> Result<Vec<SkinItemDto>, String> {
    let skins_dir = get_skins_dir();
    let mut items = Vec::new();

    if let Ok(entries) = fs::read_dir(&skins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.to_string_lossy().to_lowercase() == "png" {
                        let filename = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        let name = path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        if let Ok(bytes) = fs::read(&path) {
                            items.push(SkinItemDto {
                                id: filename.clone(),
                                filename,
                                name,
                                path: path.to_string_lossy().to_string(),
                                bytes,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(items)
}

#[tauri::command]
pub fn skin_save_local(name: String, bytes: Vec<u8>) -> Result<SkinItemDto, String> {
    let skins_dir = get_skins_dir();

    if bytes.is_empty() {
        return Err("皮膚檔案不可為空".into());
    }

    let safe_stem = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>();
    let clean_stem = if safe_stem.is_empty() {
        "skin".to_string()
    } else {
        safe_stem
    };
    let filename = format!("{}_{}.png", clean_stem, uuid::Uuid::new_v4().simple());
    let target_path = skins_dir.join(&filename);

    fs::write(&target_path, &bytes)
        .map_err(|e| format!("儲存皮膚檔案失敗: {}", e))?;

    Ok(SkinItemDto {
        id: filename.clone(),
        filename,
        name: clean_stem,
        path: target_path.to_string_lossy().to_string(),
        bytes,
    })
}

#[tauri::command]
pub fn skin_delete_local(filename: String) -> Result<(), String> {
    let skins_dir = get_skins_dir();
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("無效的檔案名稱".into());
    }
    let target = skins_dir.join(&filename);
    if target.is_file() {
        fs::remove_file(target).map_err(|e| format!("刪除皮膚失敗: {}", e))?;
    }
    Ok(())
}

/// Refreshes the account session and returns a token that is known to be valid.
async fn fresh_token(account_id: &str) -> Result<String, String> {
    let acc = super::auth::auth_refresh_profile(account_id.to_string()).await?;
    if !acc.has_valid_token {
        return Err("此帳號登入已過期，請重新登入".to_string());
    }
    focusite_auth::keyring_store::CredentialStore::get_token(account_id)
        .map_err(|e| format!("讀取認證 Token 失敗: {}", e))?
        .ok_or_else(|| "找不到此帳號的有效登入憑證，請重新登入".to_string())
}

#[tauri::command]
pub async fn skin_upload_to_mojang(
    account_id: String,
    skin_bytes: Vec<u8>,
    variant: String,
) -> Result<super::auth::UserAccountDto, String> {
    if skin_bytes.is_empty() {
        return Err("皮膚資料不可為空".into());
    }

    let token = fresh_token(&account_id).await?;

    let client = reqwest::Client::new();
    let profile = focusite_auth::xbox::upload_minecraft_skin(&client, &token, &skin_bytes, &variant)
        .await
        .map_err(|e| format!("上傳外觀至 Mojang 失敗: {}", e))?;

    // Also cache skin file locally
    let _ = skin_save_local(format!("cloud_{}", profile.name), skin_bytes);

    // Refresh profile in accounts.json
    super::auth::auth_refresh_profile(account_id).await
}

#[tauri::command]
pub async fn skin_set_active_cape(
    account_id: String,
    cape_id: String,
) -> Result<super::auth::UserAccountDto, String> {
    let token = fresh_token(&account_id).await?;

    let client = reqwest::Client::new();
    focusite_auth::xbox::set_active_cape(&client, &token, &cape_id)
        .await
        .map_err(|e| format!("切換披風失敗: {}", e))?;

    super::auth::auth_refresh_profile(account_id).await
}

#[tauri::command]
pub async fn skin_hide_active_cape(
    account_id: String,
) -> Result<super::auth::UserAccountDto, String> {
    let token = fresh_token(&account_id).await?;

    let client = reqwest::Client::new();
    focusite_auth::xbox::hide_active_cape(&client, &token)
        .await
        .map_err(|e| format!("卸下披風失敗: {}", e))?;

    super::auth::auth_refresh_profile(account_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skin_save_and_delete() {
        let test_name = "test_custom_skin".to_string();
        let dummy_bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; // PNG magic header

        let item = skin_save_local(test_name, dummy_bytes.clone()).expect("Save should succeed");
        assert!(item.filename.ends_with(".png"));
        assert_eq!(item.bytes, dummy_bytes);

        let list = skin_list_local().expect("List should succeed");
        assert!(list.iter().any(|s| s.filename == item.filename));

        skin_delete_local(item.filename.clone()).expect("Delete should succeed");

        let after_list = skin_list_local().expect("List after delete should succeed");
        assert!(!after_list.iter().any(|s| s.filename == item.filename));
    }
}
