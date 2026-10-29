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
        return Err("非法檔案名稱".into());
    }
    let target = skins_dir.join(&filename);
    if target.is_file() {
        fs::remove_file(target).map_err(|e| format!("刪除皮膚失敗: {}", e))?;
    }
    Ok(())
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
