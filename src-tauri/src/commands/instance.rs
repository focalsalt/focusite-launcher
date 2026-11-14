//! Instance management commands operating directly on disk with strict path traversal validation.
//! Implements instance folder structure: <instance_name>/minecraft/ & focusite-instance.json

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use focusite_core::instance::{sanitize_folder_name, PackFolderKind, VersionCapabilities};

pub fn is_instance_busy(instance_id: &str) -> bool {
    super::launch::is_instance_running(instance_id)
        || super::provisioning::is_instance_provisioning(instance_id)
}

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
    #[serde(rename = "iconSource", default, skip_serializing_if = "Option::is_none")]
    pub icon_source: Option<String>,
    #[serde(rename = "iconUpdatedAt", default, skip_serializing_if = "Option::is_none")]
    pub icon_updated_at: Option<i64>,
    #[serde(rename = "modCount")]
    pub mod_count: usize,
    #[serde(rename = "lastPlayed")]
    pub last_played: String,
    #[serde(rename = "isFavorite")]
    pub is_favorite: bool,
    /// The folder has no config of ours yet: the user must pick version and loader before using it.
    #[serde(rename = "needsSetup", default)]
    pub needs_setup: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(rename = "customJvmArgs", default, skip_serializing_if = "Option::is_none")]
    pub custom_jvm_args: Option<Vec<String>>,
    #[serde(rename = "environmentVars", default, skip_serializing_if = "Option::is_none")]
    pub environment_vars: Option<std::collections::HashMap<String, String>>,
    /// Unix epoch milliseconds of the last launch, if the instance was ever launched.
    #[serde(rename = "lastPlayedAt", default, skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<i64>,
    #[serde(rename = "totalPlayTimeMs", default)]
    pub total_play_time_ms: u64,
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
    #[serde(rename = "iconSource", default, skip_serializing_if = "Option::is_none")]
    pub icon_source: Option<String>,
    #[serde(rename = "iconUpdatedAt", default, skip_serializing_if = "Option::is_none")]
    pub icon_updated_at: Option<i64>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(rename = "customJvmArgs", default, skip_serializing_if = "Option::is_none")]
    pub custom_jvm_args: Option<Vec<String>>,
    #[serde(rename = "environmentVars", default, skip_serializing_if = "Option::is_none")]
    pub environment_vars: Option<std::collections::HashMap<String, String>>,
    /// Accumulated time the game process has run, in milliseconds.
    #[serde(rename = "totalPlayTimeMs", default)]
    pub total_play_time_ms: u64,
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
        return Err("實例名稱不能為空".into());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("實例名稱含有路徑穿越字元".into());
    }
    let forbidden = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    if id.chars().any(|c| forbidden.contains(&c) || c.is_control()) {
        return Err("實例名稱含有檔案系統不允許的字元".into());
    }
    // Windows silently strips trailing dots/spaces and reserves device names.
    if id.ends_with('.') || id.ends_with(' ') {
        return Err("實例名稱不可以句點或空白結尾".into());
    }
    let stem = id.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        return Err("實例名稱為 Windows 保留名稱，請更換".into());
    }
    Ok(())
}

/// Resolves the base directory where Minecraft instances reside: the user-chosen folder,
/// or %APPDATA%/focusite_launcher/instances/ by default.
pub fn get_instances_dir() -> PathBuf {
    super::settings::custom_instances_dir().unwrap_or_else(|| super::get_app_data_dir().join("instances"))
}

/// Serialises read-modify-write cycles on instance configs so two callers cannot overwrite each other.
static CONFIG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Holds the config lock until the guard is dropped. Code that reads and then writes a config by hand
/// takes it first; the lock is not re-entrant, so never call `update_instance_config` while holding it.
pub fn lock_configs() -> std::sync::MutexGuard<'static, ()> {
    CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Reads the config, applies `change`, writes it back, all under one lock.
pub fn update_instance_config<T>(
    instance_dir: &Path,
    change: impl FnOnce(&mut InstanceDiskConfig) -> T,
) -> Result<T, String> {
    let _guard = lock_configs();
    let mut config = read_instance_config(instance_dir)?;
    let out = change(&mut config);
    write_instance_config(instance_dir, &config)?;
    Ok(out)
}

/// A folder name derived from `name` that does not exist yet in `base` ("Name", "Name (2)", ...).
pub fn unique_folder_name(base: &Path, name: &str) -> Result<String, String> {
    let sanitized = sanitize_folder_name(name);
    validate_safe_id(&sanitized)?;
    let mut folder = sanitized.clone();
    let mut n = 2;
    while base.join(&folder).exists() {
        folder = format!("{sanitized} ({n})");
        n += 1;
    }
    Ok(folder)
}

/// Mod counts keyed by mods folder; a folder's modified time changes whenever a file is added, removed
/// or renamed (including enabling/disabling), so an unchanged time means an unchanged count.
static MOD_COUNTS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<PathBuf, (std::time::SystemTime, usize)>>> =
    std::sync::LazyLock::new(Default::default);

fn count_mods(mods_dir: &Path) -> usize {
    let modified = fs::metadata(mods_dir).and_then(|m| m.modified()).ok();
    if let Some(time) = modified {
        if let Some((cached_time, count)) = MOD_COUNTS.lock().ok().and_then(|m| m.get(mods_dir).copied()) {
            if cached_time == time {
                return count;
            }
        }
    }
    let count = fs::read_dir(mods_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .extension()
                        .map(|ext| ext == "jar" || ext == "disabled")
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0);
    if let (Some(time), Ok(mut cache)) = (modified, MOD_COUNTS.lock()) {
        cache.insert(mods_dir.to_path_buf(), (time, count));
    }
    count
}

/// A fresh config with the default memory/JVM settings.
pub fn new_disk_config(id: &str, name: &str, version: &str, loader: &str, loader_version: Option<String>) -> InstanceDiskConfig {
    InstanceDiskConfig {
        id: id.into(),
        name: name.into(),
        version: version.into(),
        loader: loader.into(),
        loader_version,
        description: None,
        is_favorite: false,
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        show_log_on_launch: false,
        min_memory_mb: default_min_memory(),
        max_memory_mb: default_max_memory(),
        java_path: None,
        jvm_args: default_jvm_args(),
        icon_source: None,
        icon_updated_at: None,
        group: None,
        custom_jvm_args: None,
        environment_vars: None,
        total_play_time_ms: 0,
    }
}

pub fn convert_disk_config_to_summary(folder: &Path, config: InstanceDiskConfig) -> InstanceSummaryDto {
    let mod_count = count_mods(&folder.join("minecraft").join("mods"));

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
        icon_source: config.icon_source.clone(),
        icon_updated_at: config.icon_updated_at,
        mod_count,
        needs_setup: false,
        last_played: last_played_str,
        is_favorite: config.is_favorite,
        show_log_on_launch: config.show_log_on_launch,
        min_memory_mb: config.min_memory_mb,
        max_memory_mb: config.max_memory_mb,
        java_path: config.java_path,
        jvm_args: config.jvm_args,
        group: config.group,
        custom_jvm_args: config.custom_jvm_args,
        environment_vars: config.environment_vars,
        last_played_at: config.last_played_at,
        total_play_time_ms: config.total_play_time_ms,
        capabilities,
    }
}

/// Config file owned by this launcher. Other launchers (Prism, MultiMC) use `instance.cfg` for their own
/// INI files, so ours must not share that name.
pub const INSTANCE_CONFIG_FILE: &str = "focusite-instance.json";

pub fn read_instance_config(instance_dir: &Path) -> Result<InstanceDiskConfig, String> {
    let cfg_path = instance_dir.join(INSTANCE_CONFIG_FILE);
    if !cfg_path.is_file() {
        return Err("此實例尚未完成初步設定".into());
    }
    let content = fs::read_to_string(&cfg_path).map_err(|e| format!("無法讀取實例設定檔：{}", e))?;
    serde_json::from_str(&content).map_err(|_| format!("實例設定檔格式損毀，請檢查 {}", INSTANCE_CONFIG_FILE))
}

pub fn write_instance_config(instance_dir: &Path, config: &InstanceDiskConfig) -> Result<(), String> {
    let cfg_path = instance_dir.join(INSTANCE_CONFIG_FILE);
    let json = serde_json::to_string_pretty(config).map_err(|e| format!("序列化 {} 失敗: {}", INSTANCE_CONFIG_FILE, e))?;
    super::atomic_write(&cfg_path, json.as_bytes())
        .map_err(|e| format!("寫入 {} 失敗: {}", INSTANCE_CONFIG_FILE, e))
}

#[tauri::command]
pub async fn list_instances() -> Result<Vec<InstanceSummaryDto>, String> {
    tokio::task::spawn_blocking(list_instances_blocking)
        .await
        .map_err(|e| format!("背景工作執行失敗：{}", e))?
}

/// Dot-folders and folders carrying the Windows "hidden" attribute are not instances.
fn is_hidden_dir(path: &Path) -> bool {
    if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Ok(meta) = fs::metadata(path) {
            return meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0;
        }
    }
    false
}

pub fn list_instances_blocking() -> Result<Vec<InstanceSummaryDto>, String> {
    let base_dir = get_instances_dir();
    if !base_dir.exists() {
        fs::create_dir_all(&base_dir)
            .map_err(|e| format!("無法建立實例資料夾：{}", e))?;
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&base_dir)
        .map_err(|e| format!("無法讀取實例資料夾：{}", e))?;

    let folders: Vec<PathBuf> = entries
        .filter_map(|res| res.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir() && !is_hidden_dir(p))
        .collect();

    let mut instances = Vec::new();
    for folder in folders {
        // A folder without our config (another launcher's instance, a damaged config) is listed as
        // "needs setup" and left untouched until the user picks its version and loader.
        let Ok(config) = read_instance_config(&folder) else {
            // Not an instance: it must hold a `minecraft` game folder.
            if !folder.join("minecraft").is_dir() {
                continue;
            }
            let name = folder
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            let mut summary = convert_disk_config_to_summary(&folder, new_disk_config(&name, &name, "", "Vanilla", None));
            summary.needs_setup = true;
            instances.push(summary);
            continue;
        };

        // Ensure minecraft directory exists
        let mc = folder.join("minecraft");
        if !mc.exists() {
            let _ = fs::create_dir_all(mc.join("mods"));
            let _ = fs::create_dir_all(mc.join("saves"));
            let _ = fs::create_dir_all(mc.join("logs"));
            let _ = fs::create_dir_all(mc.join("resourcepacks"));
            let _ = fs::create_dir_all(mc.join("screenshots"));
        }

        instances.push(convert_disk_config_to_summary(&folder, config));
    }

    Ok(instances)
}

/// Folder inside an instance that keeps the custom loader jars the user has added.
pub const CUSTOM_JAR_DIR: &str = "custom_jar";

/// Accepts a bare `.jar` file name (no path parts); returns it unchanged.
pub fn validate_custom_jar_name(name: &str) -> Result<String, String> {
    let bare = std::path::Path::new(name)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("");
    if bare.is_empty()
        || bare != name
        || bare.starts_with('.')
        || bare.contains(':')
        || !bare.to_ascii_lowercase().ends_with(".jar")
    {
        return Err("自訂 Jar 檔名無效（需為不含路徑的 .jar）".into());
    }
    Ok(bare.to_string())
}

/// Reads the Minecraft version a client jar was built for from its embedded `version.json`
/// (present in client jars since 1.14).
pub fn read_jar_mc_version(jar: &Path) -> Result<String, String> {
    let file = fs::File::open(jar).map_err(|e| format!("無法開啟自訂 Jar：{}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("自訂 Jar 不是有效的壓縮檔：{}", e))?;
    let mut entry = archive
        .by_name("version.json")
        .map_err(|_| "自訂 Jar 內沒有 version.json，無法判斷它對應的 Minecraft 版本".to_string())?;
    let mut text = String::new();
    std::io::Read::read_to_string(&mut entry, &mut text).map_err(|e| format!("無法讀取 version.json：{}", e))?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("version.json 格式錯誤：{}", e))?;
    let id = json
        .get("id")
        .or_else(|| json.get("name"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "version.json 缺少 id 欄位".to_string())?;
    super::download::validate_version_id(id)?;
    Ok(id.to_string())
}

/// Resolves the instance's custom jar and the Minecraft version it targets.
pub fn resolve_custom_jar(inst_dir: &Path, cfg: &InstanceDiskConfig) -> Result<(PathBuf, String), String> {
    let name = validate_custom_jar_name(cfg.loader_version.as_deref().unwrap_or(""))?;
    let jar = inst_dir.join(CUSTOM_JAR_DIR).join(&name);
    if !jar.is_file() {
        return Err(format!("找不到自訂 Jar：{}\\{}", CUSTOM_JAR_DIR, name));
    }
    let version = read_jar_mc_version(&jar)?;
    Ok((jar, version))
}

/// Lists the jars stored in an instance's `custom_jar` folder (sorted by name).
#[tauri::command]
pub fn list_custom_jars(instance_id: String) -> Result<Vec<String>, String> {
    validate_safe_id(&instance_id)?;
    let dir = get_instances_dir().join(&instance_id).join(CUSTOM_JAR_DIR);
    let mut names: Vec<String> = match fs::read_dir(&dir) {
        Ok(rd) => rd
            .flatten()
            .filter(|e| e.path().is_file())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| validate_custom_jar_name(n).is_ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

/// Stores a jar in the instance's `custom_jar` folder and returns the saved file name.
#[tauri::command]
pub fn save_custom_jar(instance_id: String, name: String, bytes: Vec<u8>) -> Result<String, String> {
    validate_safe_id(&instance_id)?;
    let name = validate_custom_jar_name(&name)?;
    if bytes.is_empty() {
        return Err("Jar 檔案是空的".into());
    }
    let inst_dir = get_instances_dir().join(&instance_id);
    if !inst_dir.is_dir() {
        return Err("找不到實例資料夾".into());
    }
    let dir = inst_dir.join(CUSTOM_JAR_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("無法建立 {} 資料夾：{}", CUSTOM_JAR_DIR, e))?;
    fs::write(dir.join(&name), &bytes).map_err(|e| format!("無法儲存自訂 Jar：{}", e))?;
    Ok(name)
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

    let folder_name = unique_folder_name(&base_dir, &name)?;

    let inst_dir = base_dir.join(&folder_name);
    let game_dir = inst_dir.join("minecraft");

    fs::create_dir_all(game_dir.join("mods"))
        .map_err(|e| format!("無法建立 mods 資料夾：{}", e))?;
    fs::create_dir_all(game_dir.join("coremods"))
        .map_err(|e| format!("無法建立 coremods 資料夾：{}", e))?;
    fs::create_dir_all(game_dir.join("saves"))
        .map_err(|e| format!("無法建立 saves 資料夾：{}", e))?;
    fs::create_dir_all(game_dir.join("logs"))
        .map_err(|e| format!("無法建立 logs 資料夾：{}", e))?;
    fs::create_dir_all(game_dir.join("resourcepacks"))
        .map_err(|e| format!("無法建立 resourcepacks 資料夾：{}", e))?;
    fs::create_dir_all(game_dir.join("texturepacks"))
        .map_err(|e| format!("無法建立 texturepacks 資料夾：{}", e))?;
    fs::create_dir_all(game_dir.join("shaderpacks"))
        .map_err(|e| format!("無法建立 shaderpacks 資料夾：{}", e))?;
    fs::create_dir_all(game_dir.join("screenshots"))
        .map_err(|e| format!("無法建立 screenshots 資料夾：{}", e))?;

    let mut icon_source = None;
    let mut icon_updated_at = None;

    if let Some(bytes) = icon_bytes {
        if !bytes.is_empty() {
            let icon_file = inst_dir.join("icon.png");
            if let Ok(img) = image::load_from_memory(&bytes) {
                let resized = img.resize_exact(256, 256, image::imageops::FilterType::Lanczos3);
                let _ = resized.save(&icon_file);
            } else {
                let _ = fs::write(&icon_file, &bytes);
            }
            icon_source = Some("custom".into());
            icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
        }
    }

    // A custom loader jar lives in `custom_jar/`; its name is remembered as the "loader version".
    let mut loader_version = loader_version;
    if loader == "Custom" {
        let (jar_name, bytes) = match (custom_jar_name, custom_jar_bytes) {
            (Some(n), Some(b)) if !b.is_empty() => (n, b),
            _ => return Err("自訂載入器需要提供 .jar 檔案".into()),
        };
        let safe_jar_name = validate_custom_jar_name(
            std::path::Path::new(&jar_name)
                .file_name()
                .and_then(|f| f.to_str())
                .unwrap_or(""),
        )?;
        let jar_dir = inst_dir.join(CUSTOM_JAR_DIR);
        fs::create_dir_all(&jar_dir).map_err(|e| format!("無法建立 {} 資料夾：{}", CUSTOM_JAR_DIR, e))?;
        fs::write(jar_dir.join(&safe_jar_name), &bytes).map_err(|e| format!("無法儲存自訂 Jar：{}", e))?;
        loader_version = Some(safe_jar_name);
    }

    let mut config = new_disk_config(&folder_name, &name, &version, &loader, loader_version);
    config.description = description.clone();
    config.icon_source = icon_source;
    config.icon_updated_at = icon_updated_at;

    write_instance_config(&inst_dir, &config)?;
    Ok(convert_disk_config_to_summary(&inst_dir, config))
}

/// First-time setup of a folder that has no config of ours: writes the config, nothing else is touched.
#[tauri::command]
pub fn setup_instance(
    instance_id: String,
    name: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&instance_id)?;
    let inst_dir = get_instances_dir().join(&instance_id);
    if !inst_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", instance_id));
    }
    let _cfg_lock = lock_configs();
    // A config that cannot be read counts as missing, so a damaged one can be replaced here.
    if read_instance_config(&inst_dir).is_ok() {
        return Err("此實例已完成設定".into());
    }
    if version.trim().is_empty() {
        return Err("請選擇 Minecraft 版本".into());
    }
    let name = if name.trim().is_empty() { instance_id.clone() } else { name.trim().to_string() };

    let game_dir = inst_dir.join("minecraft");
    for sub in ["mods", "saves", "logs", "resourcepacks", "shaderpacks", "screenshots"] {
        fs::create_dir_all(game_dir.join(sub)).map_err(|e| format!("無法建立 {} 資料夾：{}", sub, e))?;
    }
    let config = new_disk_config(&instance_id, &name, version.trim(), &loader, loader_version);
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
    if is_instance_busy(&current_id) {
        return Err(format!("實例 '{}' 正在運行或安裝中，無法重新命名", current_id));
    }
    if new_name.trim().is_empty() {
        return Err("新實例名稱不能為空".into());
    }

    let base_dir = get_instances_dir();
    let current_dir = base_dir.join(&current_id);
    if !current_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", current_id));
    }

    let _cfg_lock = lock_configs();
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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_instance_settings(
    instance_id: String,
    min_memory_mb: Option<u32>,
    max_memory_mb: Option<u32>,
    java_path: Option<String>,
    jvm_args: Option<Vec<String>>,
    show_log_on_launch: Option<bool>,
    group: Option<String>,
    custom_jvm_args: Option<Vec<String>>,
    environment_vars: Option<std::collections::HashMap<String, String>>,
) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&instance_id)?;
    if is_instance_busy(&instance_id) {
        return Err(format!("實例 '{}' 正在運行或安裝中，無法修改設定", instance_id));
    }
    let inst_dir = get_instances_dir().join(&instance_id);
    if !inst_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", instance_id));
    }

    let _cfg_lock = lock_configs();
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
    if let Some(grp) = group {
        let trimmed = grp.trim();
        config.group = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    if let Some(custom_args) = custom_jvm_args {
        config.custom_jvm_args = Some(custom_args);
    }
    if let Some(envs) = environment_vars {
        config.environment_vars = Some(envs);
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

    let _cfg_lock = lock_configs();
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
        fs::create_dir_all(dst).map_err(|e| format!("無法建立目錄 {}：{}", dst.display(), e))?;
    }

    let entries = fs::read_dir(src).map_err(|e| format!("無法讀取目錄 {}：{}", src.display(), e))?;
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
    update_instance_config(&base_dir, |c| c.show_log_on_launch = show_log)
}

#[tauri::command]
pub fn delete_instance(app_handle: AppHandle, id: String) -> Result<(), String> {
    validate_safe_id(&id)?;
    if is_instance_busy(&id) {
        return Err(format!("實例 '{}' 正在運行或安裝中，無法刪除", id));
    }

    super::launch::clear_instance_log(&id);

    // Destroy associated log window and any workshop subwindows
    let log_label = super::launch::get_instance_log_window_label(&id);
    if let Some(win) = app_handle.get_webview_window(&log_label) {
        let _ = win.destroy();
    }
    if log_label.len() >= 11 {
        let ws_prefix = format!("workshop-{}", &log_label[11..]);
        for (label, win) in app_handle.webview_windows() {
            if label.starts_with(&ws_prefix) {
                let _ = win.destroy();
            }
        }
    }

    let base_dir = get_instances_dir();
    let inst_dir = base_dir.join(&id);
    if inst_dir.exists() {
        fs::remove_dir_all(inst_dir).map_err(|e| format!("刪除實例失敗：{}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_instance_icon_from_file(
    instance_id: String,
    source_image_path: String,
) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&instance_id)?;
    let inst_dir = get_instances_dir().join(&instance_id);
    if !inst_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", instance_id));
    }

    let src = Path::new(&source_image_path);
    if !src.is_file() {
        return Err("選取的圖片檔案不存在".into());
    }

    let img = image::ImageReader::open(src)
        .map_err(|e| format!("無法開啟圖片檔案: {}", e))?
        .decode()
        .map_err(|e| format!("無法解碼圖片: {}", e))?;

    let resized = img.resize_exact(256, 256, image::imageops::FilterType::Lanczos3);
    let target_icon = inst_dir.join("icon.png");
    resized
        .save(&target_icon)
        .map_err(|e| format!("無法儲存實例圖示: {}", e))?;

    let config = update_instance_config(&inst_dir, |c| {
        c.icon_source = Some("custom".into());
        c.icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
        c.clone()
    })?;

    Ok(convert_disk_config_to_summary(&inst_dir, config))
}

#[tauri::command]
pub fn set_instance_preset_icon(
    instance_id: String,
    preset_key: String,
) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&instance_id)?;
    let inst_dir = get_instances_dir().join(&instance_id);
    if !inst_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", instance_id));
    }

    let target_icon = inst_dir.join("icon.png");
    let (r, g, b): (u8, u8, u8) = match preset_key.as_str() {
        "grass" => (60, 133, 39),
        "diamond" => (44, 186, 219),
        "redstone" => (220, 38, 38),
        "gold" => (245, 158, 11),
        "obsidian" => (30, 27, 75),
        "crafting_table" => (180, 83, 9),
        "fabric" => (217, 119, 6),
        "forge" => (194, 65, 12),
        "neoforge" => (249, 115, 22),
        "quilt" => (147, 51, 234),
        "furnace" => (113, 113, 122),
        "creeper" => (34, 197, 94),
        "tnt" => (185, 28, 28),
        "bookshelf" => (146, 64, 14),
        "ender_chest" => (17, 94, 89),
        "sword" => (56, 189, 248),
        _ => (60, 133, 39),
    };

    let mut imgbuf = image::ImageBuffer::new(256, 256);
    for (x, y, pixel) in imgbuf.enumerate_pixels_mut() {
        let is_border = !(8..248).contains(&x) || !(8..248).contains(&y);
        let is_inner_border = (x < 16 && y < 16) || (x >= 240 && y >= 240);
        if is_border {
            *pixel = image::Rgba([r / 2, g / 2, b / 2, 255]);
        } else if is_inner_border {
            *pixel = image::Rgba([
                r.saturating_add(30),
                g.saturating_add(30),
                b.saturating_add(30),
                255,
            ]);
        } else {
            *pixel = image::Rgba([r, g, b, 255]);
        }
    }
    imgbuf
        .save(&target_icon)
        .map_err(|e| format!("無法寫入預設圖示: {}", e))?;

    let config = update_instance_config(&inst_dir, |c| {
        c.icon_source = Some(format!("preset:{}", preset_key));
        c.icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
        c.clone()
    })?;

    Ok(convert_disk_config_to_summary(&inst_dir, config))
}

#[tauri::command]
pub fn reset_instance_icon(instance_id: String) -> Result<InstanceSummaryDto, String> {
    validate_safe_id(&instance_id)?;
    let inst_dir = get_instances_dir().join(&instance_id);
    if !inst_dir.is_dir() {
        return Err(format!("找不到實例資料夾: {}", instance_id));
    }

    let target_icon = inst_dir.join("icon.png");
    if target_icon.is_file() {
        let _ = fs::remove_file(target_icon);
    }

    let config = update_instance_config(&inst_dir, |c| {
        c.icon_source = None;
        c.icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
        c.clone()
    })?;

    Ok(convert_disk_config_to_summary(&inst_dir, config))
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
        return Err(format!("模組檔案 {} 不存在", filename));
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
        .map_err(|e| format!("讀取存檔資料夾失敗：{}", e))?;

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
        .map_err(|e| format!("讀取截圖資料夾失敗：{}", e))?;

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

    fs::read_to_string(log_file).map_err(|e| format!("讀取日誌檔失敗：{}", e))
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
        assert!(validate_custom_jar_name("my-loader.JAR").is_ok());
        let dir = std::env::temp_dir().join(format!("fc_jar_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let jar = dir.join("client.jar");
        {
            use std::io::Write;
            let mut zw = zip::ZipWriter::new(fs::File::create(&jar).unwrap());
            zw.start_file("version.json", zip::write::SimpleFileOptions::default()).unwrap();
            zw.write_all(br#"{"id":"1.20.1","name":"1.20.1"}"#).unwrap();
            zw.finish().unwrap();
        }
        assert_eq!(read_jar_mc_version(&jar).unwrap(), "1.20.1");
        let empty = dir.join("empty.jar");
        zip::ZipWriter::new(fs::File::create(&empty).unwrap()).finish().unwrap();
        assert!(read_jar_mc_version(&empty).is_err());
        let _ = fs::remove_dir_all(&dir);
        assert!(validate_custom_jar_name("../evil.jar").is_err());
        assert!(validate_custom_jar_name("a\\b.jar").is_err());
        assert!(validate_custom_jar_name("notajar.txt").is_err());
        assert!(validate_custom_jar_name(".hidden.jar").is_err());
        assert!(validate_safe_filename("jei-1.20.1.jar").is_ok());
        assert!(validate_safe_filename("OptiFine.jar.disabled").is_ok());
        assert!(validate_safe_filename("../escape.jar").is_err());
        assert!(validate_safe_filename("..\\escape.jar").is_err());
        assert!(validate_safe_filename("/root/a.jar").is_err());
        assert!(validate_safe_filename("").is_err());
    }

    #[test]
    fn test_unique_folder_name_never_reuses_a_folder() {
        let base = std::env::temp_dir().join(format!("fc_uniq_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(base.join("Pack")).unwrap();
        assert_eq!(unique_folder_name(&base, "Pack").unwrap(), "Pack (2)");
        fs::create_dir_all(base.join("Pack (2)")).unwrap();
        assert_eq!(unique_folder_name(&base, "Pack").unwrap(), "Pack (3)");
        assert_eq!(unique_folder_name(&base, "Other").unwrap(), "Other");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_update_instance_config_and_mod_count_cache() {
        let dir = std::env::temp_dir().join(format!("fc_upd_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("mods")).unwrap();
        write_instance_config(&dir, &new_disk_config("x", "X", "1.20.1", "Vanilla", None)).unwrap();
        update_instance_config(&dir, |c| c.max_memory_mb = 8192).unwrap();
        assert_eq!(read_instance_config(&dir).unwrap().max_memory_mb, 8192);

        assert_eq!(count_mods(&dir.join("mods")), 0);
        fs::write(dir.join("mods").join("a.jar"), "x").unwrap();
        assert_eq!(count_mods(&dir.join("mods")), 1, "a new file invalidates the cached count");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_damaged_config_is_not_a_valid_config() {
        let dir = std::env::temp_dir().join(format!("fc_bad_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(INSTANCE_CONFIG_FILE), "{ not json").unwrap();
        assert!(read_instance_config(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_other_launcher_files_are_never_read() {
        let dir = std::env::temp_dir().join(format!("fc_cfg_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let cfg = new_disk_config("x", "X", "1.20.1", "Fabric", Some("0.15".into()));
        let json = serde_json::to_string(&cfg).unwrap();

        // Neither a Prism INI nor older JSON file names count as our config.
        fs::write(dir.join("instance.cfg"), "[General]\nname=Prism pack\n").unwrap();
        fs::write(dir.join("instance.json"), &json).unwrap();
        assert!(read_instance_config(&dir).is_err());
        assert!(!dir.join(INSTANCE_CONFIG_FILE).exists());

        write_instance_config(&dir, &cfg).unwrap();
        assert_eq!(read_instance_config(&dir).unwrap().version, "1.20.1");
        let _ = fs::remove_dir_all(&dir);
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

        // Write the instance config
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
            icon_source: None,
            icon_updated_at: None,
            group: None,
            custom_jvm_args: None,
            environment_vars: None,
            total_play_time_ms: 0,
        };
        fs::write(inst_dir.join(INSTANCE_CONFIG_FILE), serde_json::to_string(&cfg).unwrap()).unwrap();

        // Verify structure: <instance_name>/minecraft/ & focusite-instance.json
        assert!(inst_dir.join("minecraft").is_dir());
        assert!(inst_dir.join(INSTANCE_CONFIG_FILE).is_file());
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
            icon_source: None,
            icon_updated_at: None,
            group: None,
            custom_jvm_args: None,
            environment_vars: None,
            total_play_time_ms: 0,
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
