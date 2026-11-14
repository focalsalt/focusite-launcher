//! Tauri commands for Minecraft world saves management (NBT reading, rename, backup, delete).

use std::path::PathBuf;
use tauri::command;
use focusite_core::world::{
    backup_world, delete_world, list_instance_worlds, rename_world, WorldSummary,
};
use super::instance::{get_instances_dir, validate_safe_id};

#[command]
pub fn list_instance_worlds_cmd(instance_id: String) -> Result<Vec<WorldSummary>, String> {
    // Read-only listing is safe while the game is running.
    validate_safe_id(&instance_id)?;
    let instance_dir = get_instances_dir().join(&instance_id);
    if !instance_dir.is_dir() {
        return Err(format!("找不到實例 '{}'", instance_id));
    }

    list_instance_worlds(&instance_dir).map_err(|e| format!("讀取世界清單失敗：{}", e))
}

#[command]
pub fn rename_instance_world_cmd(
    instance_id: String,
    folder_name: String,
    new_name: String,
) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    if super::instance::is_instance_busy(&instance_id) {
        return Err(format!("實例 '{}' 正在運行或安裝中，無法重新命名存檔", instance_id));
    }
    let instance_dir = get_instances_dir().join(&instance_id);
    rename_world(&instance_dir, &folder_name, &new_name).map_err(|e| format!("重新命名存檔失敗：{}", e))
}

#[command]
pub fn delete_instance_world_cmd(instance_id: String, folder_name: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    if super::instance::is_instance_busy(&instance_id) {
        return Err(format!("實例 '{}' 正在運行或安裝中，無法刪除存檔", instance_id));
    }
    let instance_dir = get_instances_dir().join(&instance_id);
    delete_world(&instance_dir, &folder_name).map_err(|e| format!("刪除存檔失敗：{}", e))
}

#[command]
pub fn backup_instance_world_cmd(
    instance_id: String,
    folder_name: String,
    target_zip_path: String,
) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    if super::instance::is_instance_busy(&instance_id) {
        return Err(format!("實例 '{}' 正在運行或安裝中，無法備份存檔", instance_id));
    }

    let trimmed_path = target_zip_path.trim();
    if trimmed_path.is_empty() {
        return Err("備份輸出路徑不得為空".into());
    }
    if !trimmed_path.to_lowercase().ends_with(".zip") {
        return Err("備份檔案必須使用 .zip 副檔名".into());
    }
    if trimmed_path.contains("..") {
        return Err("備份路徑包含非法穿越字元 '..'".into());
    }

    let output_zip = PathBuf::from(trimmed_path);
    if output_zip.exists() {
        return Err("備份檔案已存在，拒絕覆寫既有檔案".into());
    }
    if let Some(parent) = output_zip.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("備份目標所在目錄不存在".into());
        }
    }

    let instance_dir = get_instances_dir().join(&instance_id);
    backup_world(&instance_dir, &folder_name, &output_zip).map_err(|e| format!("備份存檔失敗：{}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_world_commands_safety_id_validation() {
        assert!(list_instance_worlds_cmd("../malicious".into()).is_err());
        assert!(rename_instance_world_cmd("../bad".into(), "world".into(), "new".into()).is_err());
        assert!(delete_instance_world_cmd("bad/id".into(), "world".into()).is_err());
    }

    #[test]
    fn test_backup_instance_world_path_validation() {
        assert!(backup_instance_world_cmd("inst1".into(), "w1".into(), "target.exe".into()).is_err());
        assert!(backup_instance_world_cmd("inst1".into(), "w1".into(), "../escape.zip".into()).is_err());

        // Existing file overwrite rejection
        let temp_existing = std::env::temp_dir().join(format!("existing_backup_{}.zip", uuid::Uuid::new_v4()));
        std::fs::write(&temp_existing, b"dummy").unwrap();
        assert!(backup_instance_world_cmd(
            "inst1".into(),
            "w1".into(),
            temp_existing.to_string_lossy().to_string()
        ).is_err());
        let _ = std::fs::remove_file(temp_existing);
    }
}
