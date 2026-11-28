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

/// Reads every saved skin file, so it runs off the main thread.
#[tauri::command]
pub async fn skin_list_local() -> Result<Vec<SkinItemDto>, String> {
    super::blocking(list_local_skins).await
}

fn list_local_skins() -> Result<Vec<SkinItemDto>, String> {
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
        return Err("E_SKIN_FILE_EMPTY".into());
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
        .map_err(super::ctx("E_SKIN_SAVE_FAILED"))?;

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
        return Err("E_FILE_NAME_INVALID".into());
    }
    let target = skins_dir.join(&filename);
    if target.is_file() {
        fs::remove_file(target).map_err(super::ctx("E_SKIN_DELETE_FAILED"))?;
    }
    Ok(())
}

/// Refreshes the account session and returns a token that is known to be valid.
async fn fresh_token(account_id: &str) -> Result<String, String> {
    let acc = super::auth::auth_refresh_profile(account_id.to_string()).await?;
    if !acc.has_valid_token {
        return Err("E_SESSION_EXPIRED".to_string());
    }
    focusite_auth::keyring_store::CredentialStore::get_credentials(account_id)
        .map_err(super::ctx("E_CREDENTIAL_READ_FAILED"))?
        .map(|(mc_token, _)| mc_token)
        .ok_or_else(|| "E_SESSION_EXPIRED".to_string())
}

#[tauri::command]
pub async fn skin_upload_to_mojang(
    account_id: String,
    skin_bytes: Vec<u8>,
    variant: String,
) -> Result<super::auth::UserAccountDto, String> {
    if skin_bytes.is_empty() {
        return Err("E_SKIN_DATA_EMPTY".into());
    }

    let token = fresh_token(&account_id).await?;

    let client = super::http().clone();
    let profile = focusite_auth::xbox::upload_minecraft_skin(&client, &token, &skin_bytes, &variant)
        .await
        .map_err(super::ctx("E_SKIN_UPLOAD_FAILED"))?;

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

    let client = super::http().clone();
    focusite_auth::xbox::set_active_cape(&client, &token, &cape_id)
        .await
        .map_err(super::ctx("E_CAPE_SET_FAILED"))?;

    super::auth::auth_refresh_profile(account_id).await
}

#[tauri::command]
pub async fn skin_hide_active_cape(
    account_id: String,
) -> Result<super::auth::UserAccountDto, String> {
    let token = fresh_token(&account_id).await?;

    let client = super::http().clone();
    focusite_auth::xbox::hide_active_cape(&client, &token)
        .await
        .map_err(super::ctx("E_CAPE_REMOVE_FAILED"))?;

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

        let list = list_local_skins().expect("List should succeed");
        assert!(list.iter().any(|s| s.filename == item.filename));

        skin_delete_local(item.filename.clone()).expect("Delete should succeed");

        let after_list = list_local_skins().expect("List after delete should succeed");
        assert!(!after_list.iter().any(|s| s.filename == item.filename));
    }
}
