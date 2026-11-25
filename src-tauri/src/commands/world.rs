//! Tauri commands for Minecraft world saves management (NBT reading, rename, backup, delete).

use std::path::PathBuf;
use tauri::command;
use focusite_core::world::{
    backup_world, delete_world, delete_world_datapack, list_instance_worlds, list_world_datapacks,
    rename_world, world_datapacks_dir, DatapackEntry, WorldSummary,
};
use super::instance::{get_instances_dir, validate_safe_id};

// Listing parses every level.dat, deleting and zipping can touch gigabytes: all run off the main thread.
#[command]
pub async fn list_instance_worlds_cmd(instance_id: String) -> Result<Vec<WorldSummary>, String> {
    super::blocking(move || list_worlds(instance_id)).await
}

fn list_worlds(instance_id: String) -> Result<Vec<WorldSummary>, String> {
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
pub async fn delete_instance_world_cmd(instance_id: String, folder_name: String) -> Result<(), String> {
    super::blocking(move || delete_world_blocking(instance_id, folder_name)).await
}

fn delete_world_blocking(instance_id: String, folder_name: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    if super::instance::is_instance_busy(&instance_id) {
        return Err(format!("實例 '{}' 正在運行或安裝中，無法刪除存檔", instance_id));
    }
    let instance_dir = get_instances_dir().join(&instance_id);
    delete_world(&instance_dir, &folder_name).map_err(|e| format!("刪除存檔失敗：{}", e))
}

#[command]
pub async fn backup_instance_world_cmd(
    instance_id: String,
    folder_name: String,
    target_zip_path: String,
) -> Result<(), String> {
    super::blocking(move || backup_world_blocking(instance_id, folder_name, target_zip_path)).await
}

fn backup_world_blocking(instance_id: String, folder_name: String, target_zip_path: String) -> Result<(), String> {
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

#[command]
pub async fn list_world_datapacks_cmd(instance_id: String, folder_name: String) -> Result<Vec<DatapackEntry>, String> {
    super::blocking(move || {
        // Read-only listing is safe while the game is running.
        validate_safe_id(&instance_id)?;
        let instance_dir = get_instances_dir().join(&instance_id);
        list_world_datapacks(&instance_dir, &folder_name).map_err(|e| format!("讀取資料包清單失敗：{}", e))
    })
    .await
}

#[command]
pub async fn delete_world_datapack_cmd(
    instance_id: String,
    folder_name: String,
    pack_name: String,
) -> Result<(), String> {
    super::blocking(move || {
        validate_safe_id(&instance_id)?;
        if super::instance::is_instance_busy(&instance_id) {
            return Err(format!("實例 '{}' 正在運行或安裝中，無法刪除資料包", instance_id));
        }
        let instance_dir = get_instances_dir().join(&instance_id);
        delete_world_datapack(&instance_dir, &folder_name, &pack_name).map_err(|e| format!("刪除資料包失敗：{}", e))
    })
    .await
}

#[command]
pub fn open_world_datapacks_dir_cmd(instance_id: String, folder_name: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let instance_dir = get_instances_dir().join(&instance_id);
    let dir = world_datapacks_dir(&instance_dir, &folder_name).map_err(|e| format!("找不到資料包資料夾：{}", e))?;
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(&dir);
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_world_commands_safety_id_validation() {
        assert!(list_worlds("../malicious".into()).is_err());
        assert!(rename_instance_world_cmd("../bad".into(), "world".into(), "new".into()).is_err());
        assert!(delete_world_blocking("bad/id".into(), "world".into()).is_err());
    }

    #[test]
    fn test_backup_instance_world_path_validation() {
        assert!(backup_world_blocking("inst1".into(), "w1".into(), "target.exe".into()).is_err());
        assert!(backup_world_blocking("inst1".into(), "w1".into(), "../escape.zip".into()).is_err());

        // Existing file overwrite rejection
        let temp_existing = std::env::temp_dir().join(format!("existing_backup_{}.zip", uuid::Uuid::new_v4()));
        std::fs::write(&temp_existing, b"dummy").unwrap();
        assert!(backup_world_blocking(
            "inst1".into(),
            "w1".into(),
            temp_existing.to_string_lossy().to_string()
        ).is_err());
        let _ = std::fs::remove_file(temp_existing);
    }
}
