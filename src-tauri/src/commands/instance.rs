//! Instance management commands operating directly on disk with strict path traversal validation.
//! Implements instance folder structure: <instance_name>/minecraft/ & instance.cfg

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use focusite_core::instance::{sanitize_folder_name, PackFolderKind, VersionCapabilities};

pub fn default_min_memory() -> u32 {
    1024
}

pub fn default_max_memory() -> u32 {
    4096
}

pub fn default_jvm_args() -> Vec<String> {
    vec![
        "-XX:+UseG1GC".into(),
        "-XX:+ParallelRefProcEnabled".into(),
        "-XX:MaxGCPauseMillis=200".into(),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceSummaryDto {
    pub id: String,
    pub name: String,
    pub version: String,
    pub loader: String,
    #[serde(rename = "loaderVersion", default, skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "hasIcon")]
    pub has_icon: bool,
    #[serde(rename = "iconPath", default, skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
    #[serde(rename = "modCount")]
    pub mod_count: usize,
    #[serde(rename = "lastPlayed")]
    pub last_played: String,
    #[serde(rename = "isFavorite")]
    pub is_favorite: bool,
    #[serde(rename = "showLogOnLaunch", default)]
    pub show_log_on_launch: bool,
    #[serde(rename = "minMemoryMb", default = "default_min_memory")]
    pub min_memory_mb: u32,
    #[serde(rename = "maxMemoryMb", default = "default_max_memory")]
    pub max_memory_mb: u32,
    #[serde(rename = "javaPath", default, skip_serializing_if = "Option::is_none")]
    pub java_path: Option<String>,
    #[serde(rename = "jvmArgs", default = "default_jvm_args")]
    pub jvm_args: Vec<String>,
    pub capabilities: VersionCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceDiskConfig {
    pub id: String,
    pub name: String,
    pub version: String,
    pub loader: String,
    #[serde(rename = "loaderVersion", default, skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub is_favorite: bool,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<i64>,
    #[serde(rename = "showLogOnLaunch", default)]
    pub show_log_on_launch: bool,
    #[serde(rename = "minMemoryMb", default = "default_min_memory")]
    pub min_memory_mb: u32,
    #[serde(rename = "maxMemoryMb", default = "default_max_memory")]
    pub max_memory_mb: u32,
    #[serde(rename = "javaPath", default, skip_serializing_if = "Option::is_none")]
    pub java_path: Option<String>,
    #[serde(rename = "jvmArgs", default = "default_jvm_args")]
    pub jvm_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFileDto {
    pub filename: String,
    pub size_bytes: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFileDto {
    pub filename: String,
    pub size_bytes: u64,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotFileDto {
    pub name: String,
    pub path: String,
    pub created_at: String,
}

/// Validates that a file name is safe and does not contain path traversal characters.
pub fn validate_safe_filename(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("檔案名稱不能為空".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("無效的檔案名稱：偵測到路徑穿越字元".into());
    }
    Ok(())
}

/// Validates that an instance ID/name is safe and does not contain path traversal characters.
pub fn validate_safe_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("Instance name cannot be empty".into());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid instance name: path traversal characters detected".into());
    }
    let forbidden = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if id.chars().any(|c| forbidden.contains(&c) || c.is_control()) {
        return Err("Invalid instance name: contains forbidden filesystem characters".into());
    }
    Ok(())
}

/// Resolves the base directory where Minecraft instances reside: %APPDATA%/focusite_launcher/instances/
pub fn get_instances_dir() -> PathBuf {
    super::get_app_data_dir().join("instances")
}

pub fn convert_disk_config_to_summary(folder: &Path, config: InstanceDiskConfig) -> InstanceSummaryDto {
    let mods_dir = folder.join("minecraft").join("mods");
    let mut mod_count = 0;
    if let Ok(mod_entries) = fs::read_dir(&mods_dir) {
        mod_count = mod_entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map(|ext| ext == "jar" || ext == "disabled")
                    .unwrap_or(false)
            })
            .count();
    }

    let last_played_str = config
        .last_played_at
        .map(|ts| {
            let dt = chrono::DateTime::from_timestamp_millis(ts);
            dt.map(|d| d.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| "尚未遊玩".into())
        })
        .unwrap_or_else(|| "尚未遊玩".into());

    let folder_name = folder
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| config.id.clone());

    let icon_file = folder.join("icon.png");
    let has_icon = icon_file.is_file();
    let icon_path = if has_icon {
        Some(icon_file.to_string_lossy().to_string())
    } else {
        None
    };

    let capabilities = VersionCapabilities::from_mc_version(&config.version);

    InstanceSummaryDto {
        id: folder_name,
        name: config.name,
        version: config.version,
        loader: config.loader,
        loader_version: config.loader_version,
        description: config.description,
        has_icon,
        icon_path,
        mod_count,
        last_played: last_played_str,
        is_favorite: config.is_favorite,
        show_log_on_launch: config.show_log_on_launch,
        min_memory_mb: config.min_memory_mb,
        max_memory_mb: config.max_memory_mb,
        java_path: config.java_path,
        jvm_args: config.jvm_args,
        capabilities,
    }
}

pub fn read_instance_config(instance_dir: &Path) -> Result<InstanceDiskConfig, String> {
    let cfg_path = instance_dir.join("instance.cfg");
    if cfg_path.is_file() {
        let content = fs::read_to_string(&cfg_path).map_err(|e| format!("無法讀取 instance.cfg: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("無效的 instance.cfg: {}", e))
    } else {
        let legacy_json = instance_dir.join("instance.json");
        if legacy_json.is_file() {
            let content = fs::read_to_string(&legacy_json).map_err(|e| format!("無法讀取 instance.json: {}", e))?;
            let config: InstanceDiskConfig = serde_json::from_str(&content).map_err(|e| format!("無效的 instance.json: {}", e))?;
            let _ = fs::write(&cfg_path, serde_json::to_string_pretty(&config).unwrap_or_default());
            let _ = fs::remove_file(&legacy_json);
            Ok(config)
        } else {
            Err("找不到實例設定檔 instance.cfg".into())
        }
    }
}

pub fn write_instance_config(instance_dir: &Path, config: &InstanceDiskConfig) -> Result<(), String> {
    let cfg_path = instance_dir.join("instance.cfg");
    let json = serde_json::to_string_pretty(config).map_err(|e| format!("序列化 instance.cfg 失敗: {}", e))?;
    fs::write(cfg_path, json).map_err(|e| format!("寫入 instance.cfg 失敗: {}", e))
}

#[tauri::command]
pub async fn list_instances() -> Result<Vec<InstanceSummaryDto>, String> {
    tokio::task::spawn_blocking(list_instances_blocking)
        .await
        .map_err(|e| format!("Task execution error: {}", e))?
}

pub fn list_instances_blocking() -> Result<Vec<InstanceSummaryDto>, String> {
    let base_dir = get_instances_dir();
    if !base_dir.exists() {
        fs::create_dir_all(&base_dir)
            .map_err(|e| format!("Failed to create instances directory: {}", e))?;
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&base_dir)
        .map_err(|e| format!("Failed to read instances directory: {}", e))?;

    let folders: Vec<PathBuf> = entries
        .filter_map(|res| res.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();

    let mut instances = Vec::new();
    for folder in folders {
        // Auto-detect or load instance.cfg
        let config_res: Result<InstanceDiskConfig, String> = read_instance_config(&folder).or_else(|_| {
            let folder_name = folder
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "New Instance".into());
            let default_cfg = InstanceDiskConfig {
                id: folder_name.clone(),
                name: folder_name,
                version: "1.21.4".into(),
                loader: "Vanilla".into(),
                loader_version: None,
                description: None,
                is_favorite: false,
                created_at: chrono::Utc::now().timestamp_millis(),
                last_played_at: None,
                show_log_on_launch: false,
                min_memory_mb: default_min_memory(),
                max_memory_mb: default_max_memory(),
                java_path: None,
                jvm_args: default_jvm_args(),
            };
            let _ = write_instance_config(&folder, &default_cfg);
            Ok(default_cfg)
        });

        // Ensure minecraft directory exists
        let mc = folder.join("minecraft");
        if !mc.exists() {
            let _ = fs::create_dir_all(mc.join("mods"));
            let _ = fs::create_dir_all(mc.join("saves"));
            let _ = fs::create_dir_all(mc.join("logs"));
            let _ = fs::create_dir_all(mc.join("resourcepacks"));
            let _ = fs::create_dir_all(mc.join("screenshots"));
        }

        if let Ok(config) = config_res {
            instances.push(convert_disk_config_to_summary(&folder, config));
        }
    }

    Ok(instances)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_instance(
    name: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
    description: Option<String>,
    icon_bytes: Option<Vec<u8>>,
    custom_jar_name: Option<String>,
    custom_jar_bytes: Option<Vec<u8>>,
) -> Result<InstanceSummaryDto, String> {
    let base_dir = get_instances_dir();

    let sanitized_base = sanitize_folder_name(&name);
    validate_safe_id(&sanitized_base)?;

    let mut folder_name = sanitized_base.clone();
    let mut counter = 2;
    while base_dir.join(&folder_name).exists() {
        folder_name = format!("{} ({})", sanitized_base, counter);
        counter += 1;
    }

    let inst_dir = base_dir.join(&folder_name);
    let game_dir = inst_dir.join("minecraft");

    fs::create_dir_all(game_dir.join("mods"))
        .map_err(|e| format!("Failed to create mods dir: {}", e))?;
    fs::create_dir_all(game_dir.join("coremods"))
        .map_err(|e| format!("Failed to create coremods dir: {}", e))?;
    fs::create_dir_all(game_dir.join("saves"))
        .map_err(|e| format!("Failed to create saves dir: {}", e))?;
    fs::create_dir_all(game_dir.join("logs"))
        .map_err(|e| format!("Failed to create logs dir: {}", e))?;
    fs::create_dir_all(game_dir.join("resourcepacks"))
        .map_err(|e| format!("Failed to create resourcepacks dir: {}", e))?;
    fs::create_dir_all(game_dir.join("texturepacks"))
        .map_err(|e| format!("Failed to create texturepacks dir: {}", e))?;
    fs::create_dir_all(game_dir.join("shaderpacks"))
        .map_err(|e| format!("Failed to create shaderpacks dir: {}", e))?;
    fs::create_dir_all(game_dir.join("screenshots"))
        .map_err(|e| format!("Failed to create screenshots dir: {}", e))?;

    if let Some(bytes) = icon_bytes {
        if !bytes.is_empty() {
            let icon_file = inst_dir.join("icon.png");
            let _ = fs::write(&icon_file, &bytes);
        }
    }

    if loader == "Custom" {
        if let (Some(jar_name), Some(bytes)) = (custom_jar_name, custom_jar_bytes) {
            if !bytes.is_empty() {
                let safe_jar_name = std::path::Path::new(&jar_name)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or("custom_loader.jar");
                let jar_target = inst_dir.join(safe_jar_name);
                let _ = fs::write(jar_target, &bytes);
            }
        }
    }

    let config = InstanceDiskConfig {
        id: folder_name.clone(),
        name: name.clone(),
        version: version.clone(),
        loader: loader.clone(),
        loader_version: loader_version.clone(),
        description: description.clone(),
        is_favorite: false,
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        show_log_on_launch: false,
        min_memory_mb: default_min_memory(),
        max_memory_mb: default_max_memory(),
        java_path: None,
        jvm_args: default_jvm_args(),
    };

    write_instance_config(&inst_dir, &config)?;
    Ok(convert_disk_config_to_summary(&inst_dir, config))
}

#[tauri::command]
pub fn rename_instance(
    current_id: String,
    new_name: String,
    rename_folder: bool,
) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&current_id)?;
    if new_name.trim().is_empty() {
        return Err("新實例名稱不能為空".into());
    }

    let base_dir = get_instances_dir();
    let current_dir = base_dir.join(&current_id);
    if !current_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", current_id));
    }

    let mut config = read_instance_config(&current_dir)?;

    let target_dir = if rename_folder {
        let sanitized = sanitize_folder_name(&new_name);
        validate_safe_id(&sanitized)?;

        if sanitized != current_id {
            let mut target_folder = sanitized.clone();
            let mut counter = 2;
            while base_dir.join(&target_folder).exists() && target_folder != current_id {
                target_folder = format!("{} ({})", sanitized, counter);
                counter += 1;
            }

            let new_dir = base_dir.join(&target_folder);
            fs::rename(&current_dir, &new_dir).map_err(|e| format!("重新命名實例資料夾失敗: {}", e))?;
            config.id = target_folder;
            config.name = new_name;
            write_instance_config(&new_dir, &config)?;
            new_dir
        } else {
            config.name = new_name;
            write_instance_config(&current_dir, &config)?;
            current_dir
        }
    } else {
        config.name = new_name;
        write_instance_config(&current_dir, &config)?;
        current_dir
    };

    Ok(convert_disk_config_to_summary(&target_dir, config))
}

#[tauri::command]
pub fn update_instance_settings(
    instance_id: String,
    min_memory_mb: Option<u32>,
    max_memory_mb: Option<u32>,
    java_path: Option<String>,
    jvm_args: Option<Vec<String>>,
    show_log_on_launch: Option<bool>,
) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&instance_id)?;
    let inst_dir = get_instances_dir().join(&instance_id);
    if !inst_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", instance_id));
    }

    let mut config = read_instance_config(&inst_dir)?;
    if let Some(min_mem) = min_memory_mb {
        config.min_memory_mb = min_mem;
    }
    if let Some(max_mem) = max_memory_mb {
        config.max_memory_mb = max_mem;
    }
    if let Some(java) = java_path {
        let trimmed = java.trim();
        config.java_path = if trimmed.is_empty() || trimmed == "default_mojang" {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    if let Some(args) = jvm_args {
        config.jvm_args = args;
    }
    if let Some(show_log) = show_log_on_launch {
        config.show_log_on_launch = show_log;
    }

    write_instance_config(&inst_dir, &config)?;
    Ok(convert_disk_config_to_summary(&inst_dir, config))
}

#[tauri::command]
pub fn duplicate_instance(
    source_id: String,
    new_name: Option<String>,
) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&source_id)?;
    let base_dir = get_instances_dir();
    let src_dir = base_dir.join(&source_id);
    if !src_dir.is_dir() {
        return Err(format!("找不到來源實例資料夾: {}", source_id));
    }

    let mut config = read_instance_config(&src_dir)?;
    let clone_name = new_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("{} (複製)", config.name));

    let sanitized_base = sanitize_folder_name(&clone_name);
    validate_safe_id(&sanitized_base)?;

    let mut target_folder = sanitized_base.clone();
    let mut counter = 2;
    while base_dir.join(&target_folder).exists() {
        target_folder = format!("{} ({})", sanitized_base, counter);
        counter += 1;
    }

    let dst_dir = base_dir.join(&target_folder);
    fs::create_dir_all(&dst_dir).map_err(|e| format!("建立新實例資料夾失敗: {}", e))?;

    // Copy directory tree recursively with hardlink optimization for .jar files
    copy_dir_recursive_with_hardlink(&src_dir, &dst_dir)?;

    config.id = target_folder.clone();
    config.name = clone_name;
    config.created_at = chrono::Utc::now().timestamp_millis();
    config.last_played_at = None;

    write_instance_config(&dst_dir, &config)?;
    Ok(convert_disk_config_to_summary(&dst_dir, config))
}

fn copy_dir_recursive_with_hardlink(src: &Path, dst: &Path) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| format!("無法建立目錄 {:?}: {}", dst, e))?;
    }

    let entries = fs::read_dir(src).map_err(|e| format!("無法讀取目錄 {:?}: {}", src, e))?;
    for entry in entries.filter_map(|e| e.ok()) {
        let src_path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);

        if src_path.is_dir() {
            copy_dir_recursive_with_hardlink(&src_path, &dst_path)?;
        } else if src_path.is_file() {
            let ext = src_path.extension().and_then(|x| x.to_str()).unwrap_or("");
            if ext == "jar" || ext == "disabled" {
                // Hardlink optimization for mods
                let _ = focusite_cas::hardlink::HardlinkManager::link_or_copy(&src_path, &dst_path);
            } else {
                let _ = fs::copy(&src_path, &dst_path);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_instance_show_log(instance_id: String, show_log: bool) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let base_dir = get_instances_dir().join(&instance_id);
    let mut config = read_instance_config(&base_dir)?;
    config.show_log_on_launch = show_log;
    write_instance_config(&base_dir, &config)
}

#[tauri::command]
pub fn delete_instance(id: String) -> Result<(), String> {
    validate_safe_id(&id)?;
    let base_dir = get_instances_dir();
    let inst_dir = base_dir.join(&id);
    if inst_dir.exists() {
        fs::remove_dir_all(inst_dir).map_err(|e| format!("Failed to remove instance: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_instance_directory(instance_id: String, target: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let base = get_instances_dir().join(&instance_id);
    let mc_dir = base.join("minecraft");

    let path = match target.as_str() {
        "mods" => mc_dir.join("mods"),
        "coremods" => mc_dir.join("coremods"),
        "saves" => mc_dir.join("saves"),
        "screenshots" => mc_dir.join("screenshots"),
        "texturepacks" => mc_dir.join("texturepacks"),
        "shaderpacks" => mc_dir.join("shaderpacks"),
        "resourcepacks" => {
            if let Ok(config) = read_instance_config(&base) {
                let caps = VersionCapabilities::from_mc_version(&config.version);
                match caps.pack_folder_kind {
                    PackFolderKind::TexturePacks => mc_dir.join("texturepacks"),
                    PackFolderKind::ResourcePacks => mc_dir.join("resourcepacks"),
                    PackFolderKind::Hidden => mc_dir,
                }
            } else {
                mc_dir.join("resourcepacks")
            }
        }
        "minecraft" => mc_dir,
        _ => base,
    };

    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(&path);
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
    }
    Ok(())
}

fn toggle_folder_mod_state(mods_dir: &Path, filename: &str, enabled: bool) -> Result<(), String> {
    validate_safe_filename(filename)?;
    let current_path = mods_dir.join(filename);
    if !current_path.is_file() {
        return Err(format!("Mod 檔案 {} 不存在", filename));
    }

    let target_name = if enabled {
        filename.strip_suffix(".disabled").unwrap_or(filename).to_string()
    } else if filename.ends_with(".disabled") {
        filename.to_string()
    } else {
        format!("{}.disabled", filename)
    };

    let target_path = mods_dir.join(&target_name);
    fs::rename(current_path, target_path).map_err(|e| format!("無法切換模組狀態: {}", e))?;
    Ok(())
}

fn scan_folder_mods(mods_dir: &Path) -> Result<Vec<ModFileDto>, String> {
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(mods_dir).map_err(|e| format!("讀取模組目錄失敗: {}", e))?;
    let mut mods = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            let filename = path
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            let is_jar = filename.ends_with(".jar") || filename.ends_with(".jar.disabled");
            let is_zip = filename.ends_with(".zip") || filename.ends_with(".zip.disabled");
            if is_jar || is_zip {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let enabled = !filename.ends_with(".disabled");
                mods.push(ModFileDto {
                    filename,
                    size_bytes: size,
                    enabled,
                });
            }
        }
    }
    mods.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(mods)
}

#[tauri::command]
pub fn toggle_mod_state(instance_id: String, filename: String, enabled: bool) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let mods_dir = get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("mods");
    toggle_folder_mod_state(&mods_dir, &filename, enabled)
}

#[tauri::command]
pub fn toggle_coremod_state(instance_id: String, filename: String, enabled: bool) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let coremods_dir = get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("coremods");
    toggle_folder_mod_state(&coremods_dir, &filename, enabled)
}

#[tauri::command]
pub fn list_instance_mods(instance_id: String) -> Result<Vec<ModFileDto>, String> {
    validate_safe_id(&instance_id)?;
    let mods_dir = get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("mods");
    scan_folder_mods(&mods_dir)
}

#[tauri::command]
pub fn list_instance_coremods(instance_id: String) -> Result<Vec<ModFileDto>, String> {
    validate_safe_id(&instance_id)?;
    let coremods_dir = get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("coremods");
    scan_folder_mods(&coremods_dir)
}

fn scan_pack_folder(folder_path: &Path) -> Result<Vec<PackFileDto>, String> {
    if !folder_path.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(folder_path).map_err(|e| format!("無法讀取資源目錄: {}", e))?;
    let mut packs = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let filename = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        if path.is_file() {
            let is_zip = filename.ends_with(".zip");
            if is_zip {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                packs.push(PackFileDto {
                    filename,
                    size_bytes: size,
                    is_directory: false,
                });
            }
        } else if path.is_dir() {
            packs.push(PackFileDto {
                filename,
                size_bytes: 0,
                is_directory: true,
            });
        }
    }
    packs.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(packs)
}

#[tauri::command]
pub fn list_instance_resourcepacks(instance_id: String) -> Result<Vec<PackFileDto>, String> {
    validate_safe_id(&instance_id)?;
    let base_dir = get_instances_dir().join(&instance_id);
    let config = read_instance_config(&base_dir)?;
    let caps = VersionCapabilities::from_mc_version(&config.version);

    let pack_dir = match caps.pack_folder_kind {
        PackFolderKind::TexturePacks => base_dir.join("minecraft").join("texturepacks"),
        PackFolderKind::ResourcePacks => base_dir.join("minecraft").join("resourcepacks"),
        PackFolderKind::Hidden => return Ok(Vec::new()),
    };

    scan_pack_folder(&pack_dir)
}

#[tauri::command]
pub fn list_instance_shaderpacks(instance_id: String) -> Result<Vec<PackFileDto>, String> {
    validate_safe_id(&instance_id)?;
    let base_dir = get_instances_dir().join(&instance_id);
    let config = read_instance_config(&base_dir)?;
    let caps = VersionCapabilities::from_mc_version(&config.version);

    if !caps.supports_shaderpacks {
        return Ok(Vec::new());
    }

    let shader_dir = base_dir.join("minecraft").join("shaderpacks");
    scan_pack_folder(&shader_dir)
}

#[tauri::command]
pub fn list_instance_saves(instance_id: String) -> Result<Vec<String>, String> {
    validate_safe_id(&instance_id)?;
    let saves_dir = get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("saves");

    if !saves_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&saves_dir)
        .map_err(|e| format!("Failed to read saves directory: {}", e))?;

    let mut saves = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|f| f.to_str()) {
                saves.push(name.to_string());
            }
        }
    }

    Ok(saves)
}

#[tauri::command]
pub fn list_instance_screenshots(instance_id: String) -> Result<Vec<ScreenshotFileDto>, String> {
    validate_safe_id(&instance_id)?;
    let screenshots_dir = get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("screenshots");

    if !screenshots_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&screenshots_dir)
        .map_err(|e| format!("Failed to read screenshots directory: {}", e))?;

    let mut screenshots = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                if ext_lower == "png" || ext_lower == "jpg" || ext_lower == "jpeg" || ext_lower == "webp" {
                    let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                    let created_at = entry.metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| {
                            let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                            Some(duration.as_secs().to_string())
                        })
                        .unwrap_or_default();
                    screenshots.push(ScreenshotFileDto {
                        name,
                        path: path.to_string_lossy().to_string(),
                        created_at,
                    });
                }
            }
        }
    }
    screenshots.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(screenshots)
}

#[tauri::command]
pub fn get_instance_log(instance_id: String) -> Result<String, String> {
    validate_safe_id(&instance_id)?;
    let log_file = get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("logs")
        .join("latest.log");

    if !log_file.is_file() {
        return Ok(String::new());
    }

    fs::read_to_string(log_file).map_err(|e| format!("Failed to read log file: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_safe_id() {
        assert!(validate_safe_id("vanilla-1-21-4").is_ok());
        assert!(validate_safe_id("Fabric Survival 1.20").is_ok());
        assert!(validate_safe_id("冒險生存 (2)").is_ok());

        // Attacks
        assert!(validate_safe_id("../attack").is_err());
        assert!(validate_safe_id("..\\attack").is_err());
        assert!(validate_safe_id("/root").is_err());
        assert!(validate_safe_id("").is_err());
        assert!(validate_safe_id("World:Test").is_err());
    }

    #[test]
    fn test_validate_safe_filename() {
        assert!(validate_safe_filename("jei-1.20.1.jar").is_ok());
        assert!(validate_safe_filename("OptiFine.jar.disabled").is_ok());
        assert!(validate_safe_filename("../escape.jar").is_err());
        assert!(validate_safe_filename("..\\escape.jar").is_err());
        assert!(validate_safe_filename("/root/a.jar").is_err());
        assert!(validate_safe_filename("").is_err());
    }

    #[test]
    fn test_instance_folder_structure_contract() {
        let temp_dir = std::env::temp_dir().join(format!("focusite_test_inst_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        let inst_name = "Epic World 1.21";
        let sanitized = sanitize_folder_name(inst_name);
        assert_eq!(sanitized, "Epic World 1.21");

        let inst_dir = temp_dir.join(&sanitized);
        let game_dir = inst_dir.join("minecraft");
        fs::create_dir_all(game_dir.join("mods")).unwrap();
        fs::create_dir_all(game_dir.join("saves")).unwrap();

        // Write instance.cfg
        let cfg = InstanceDiskConfig {
            id: sanitized.clone(),
            name: inst_name.into(),
            version: "1.21.4".into(),
            loader: "Vanilla".into(),
            loader_version: None,
            description: Some("測試冒險世界".into()),
            is_favorite: false,
            created_at: 1000,
            last_played_at: None,
            show_log_on_launch: false,
            min_memory_mb: 1024,
            max_memory_mb: 4096,
            java_path: None,
            jvm_args: default_jvm_args(),
        };
        fs::write(inst_dir.join("instance.cfg"), serde_json::to_string(&cfg).unwrap()).unwrap();

        // Verify structure: <instance_name>/minecraft/ & instance.cfg
        assert!(inst_dir.join("minecraft").is_dir());
        assert!(inst_dir.join("instance.cfg").is_file());
        assert!(!inst_dir.join(".minecraft").exists());

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_update_settings_and_duplicate() {
        let temp_dir = std::env::temp_dir().join(format!("focusite_test_dupl_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        let inst_dir = temp_dir.join("Original");
        let mc_dir = inst_dir.join("minecraft");
        fs::create_dir_all(mc_dir.join("mods")).unwrap();
        fs::create_dir_all(mc_dir.join("coremods")).unwrap();
        fs::write(mc_dir.join("mods").join("sample.jar"), b"jar content").unwrap();

        let cfg = InstanceDiskConfig {
            id: "Original".into(),
            name: "Original World".into(),
            version: "1.5.2".into(),
            loader: "Forge".into(),
            loader_version: Some("7.8.1".into()),
            description: None,
            is_favorite: false,
            created_at: 1000,
            last_played_at: None,
            show_log_on_launch: true,
            min_memory_mb: 512,
            max_memory_mb: 2048,
            java_path: Some("C:/java8/bin/java.exe".into()),
            jvm_args: vec!["-XX:+UseG1GC".into()],
        };
        write_instance_config(&inst_dir, &cfg).unwrap();

        // Verify conversion to summary with VersionCapabilities
        let summary = convert_disk_config_to_summary(&inst_dir, cfg);
        assert_eq!(summary.max_memory_mb, 2048);
        assert_eq!(summary.capabilities.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(summary.capabilities.mods_tab_mode, focusite_core::instance::ModsTabMode::LegacyDualNav);
        assert!(summary.capabilities.supports_shaderpacks);

        // Test duplicate directory copying
        let copy_dir = temp_dir.join("Original (複製)");
        copy_dir_recursive_with_hardlink(&inst_dir, &copy_dir).unwrap();
        assert!(copy_dir.join("minecraft").join("mods").join("sample.jar").is_file());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
