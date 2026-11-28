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
        return Err(format!("E_INSTANCE_NOT_FOUND: {}", instance_id));
    }

    list_instance_worlds(&instance_dir).map_err(super::ctx("E_WORLDS_READ_FAILED"))
}

#[command]
pub fn rename_instance_world_cmd(
    instance_id: String,
    folder_name: String,
    new_name: String,
) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    if super::instance::is_instance_busy(&instance_id) {
        return Err("E_INSTANCE_BUSY".into());
    }
    let instance_dir = get_instances_dir().join(&instance_id);
    rename_world(&instance_dir, &folder_name, &new_name).map_err(super::ctx("E_WORLD_RENAME_FAILED"))
}

#[command]
pub async fn delete_instance_world_cmd(instance_id: String, folder_name: String) -> Result<(), String> {
    super::blocking(move || delete_world_blocking(instance_id, folder_name)).await
}

fn delete_world_blocking(instance_id: String, folder_name: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    if super::instance::is_instance_busy(&instance_id) {
        return Err("E_INSTANCE_BUSY".into());
    }
    let instance_dir = get_instances_dir().join(&instance_id);
    delete_world(&instance_dir, &folder_name).map_err(super::ctx("E_WORLD_DELETE_FAILED"))
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
        return Err("E_INSTANCE_BUSY".into());
    }

    let trimmed_path = target_zip_path.trim();
    if trimmed_path.is_empty() {
        return Err("E_BACKUP_PATH_EMPTY".into());
    }
    if !trimmed_path.to_lowercase().ends_with(".zip") {
        return Err("E_BACKUP_NOT_ZIP".into());
    }
    if trimmed_path.contains("..") {
        return Err("E_BACKUP_PATH_TRAVERSAL".into());
    }

    let output_zip = PathBuf::from(trimmed_path);
    if output_zip.exists() {
        return Err("E_BACKUP_EXISTS".into());
    }
    if let Some(parent) = output_zip.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("E_BACKUP_NO_FOLDER".into());
        }
    }

    let instance_dir = get_instances_dir().join(&instance_id);
    backup_world(&instance_dir, &folder_name, &output_zip).map_err(super::ctx("E_BACKUP_FAILED"))
}

#[command]
pub async fn list_world_datapacks_cmd(instance_id: String, folder_name: String) -> Result<Vec<DatapackEntry>, String> {
    super::blocking(move || {
        // Read-only listing is safe while the game is running.
        validate_safe_id(&instance_id)?;
        let instance_dir = get_instances_dir().join(&instance_id);
        list_world_datapacks(&instance_dir, &folder_name).map_err(super::ctx("E_DATAPACKS_READ_FAILED"))
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
            return Err("E_INSTANCE_BUSY".into());
        }
        let instance_dir = get_instances_dir().join(&instance_id);
        delete_world_datapack(&instance_dir, &folder_name, &pack_name).map_err(super::ctx("E_DATAPACK_DELETE_FAILED"))
    })
    .await
}

#[command]
pub fn open_world_datapacks_dir_cmd(instance_id: String, folder_name: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let instance_dir = get_instances_dir().join(&instance_id);
    let dir = world_datapacks_dir(&instance_dir, &folder_name).map_err(super::ctx("E_DATAPACKS_FOLDER_MISSING"))?;
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
