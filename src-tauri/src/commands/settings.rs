//! Global launcher settings management and persistence.

use focusite_auth::keyring_store::CredentialStore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const CURSEFORGE_KEY_ACCOUNT: &str = "__curseforge_api_key__";

/// Values a newly created instance starts with; unset ones keep the built-in defaults.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_memory_mb: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_memory_mb: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub java_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_jvm_args: Option<Vec<String>>,
}

impl InstanceDefaults {
    /// Drops empty values so "cleared in the UI" and "never set" are the same.
    fn normalized(mut self) -> Self {
        self.min_memory_mb = self.min_memory_mb.filter(|m| *m > 0).map(|m| m.clamp(256, 1_048_576));
        self.max_memory_mb = self.max_memory_mb.filter(|m| *m > 0).map(|m| m.clamp(512, 1_048_576));
        self.java_path = self.java_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
        self.custom_jvm_args = self.custom_jvm_args.filter(|a| !a.is_empty());
        self
    }

    pub fn apply_to(&self, config: &mut super::instance::InstanceDiskConfig) {
        if let Some(max) = self.max_memory_mb {
            config.max_memory_mb = max;
        }
        if let Some(min) = self.min_memory_mb {
            config.min_memory_mb = min;
        }
        // Java refuses to start when the initial heap exceeds the maximum.
        config.min_memory_mb = config.min_memory_mb.min(config.max_memory_mb);
        if self.java_path.is_some() {
            config.java_path = self.java_path.clone();
        }
        if self.custom_jvm_args.is_some() {
            config.custom_jvm_args = self.custom_jvm_args.clone();
        }
    }
}

/// The saved global defaults; tests never read the developer's own settings.
pub fn instance_defaults() -> InstanceDefaults {
    if cfg!(test) {
        return InstanceDefaults::default();
    }
    std::fs::read_to_string(get_settings_path())
        .ok()
        .and_then(|c| serde_json::from_str::<DiskSettings>(&c).ok())
        .map(|d| d.instance_defaults)
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherSettings {
    #[serde(rename = "enableBmclapiMirror", default)]
    pub enable_bmclapi_mirror: bool,

    #[serde(rename = "curseforgeApiKey", default, skip_serializing_if = "Option::is_none")]
    pub curseforge_api_key: Option<String>,

    #[serde(rename = "soundEnabled", default = "default_true")]
    pub sound_enabled: bool,

    /// Custom instances folder; `None` means the default `<app data>\instances`.
    #[serde(rename = "instancesDir", default, skip_serializing_if = "Option::is_none")]
    pub instances_dir: Option<String>,

    /// Camp location for real sunrise/sunset and weather; `None` means the user was not asked yet.
    #[serde(rename = "locationEnabled", default, skip_serializing_if = "Option::is_none")]
    pub location_enabled: Option<bool>,

    #[serde(rename = "instanceDefaults", default)]
    pub instance_defaults: InstanceDefaults,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiskSettings {
    #[serde(rename = "enableBmclapiMirror", default)]
    pub enable_bmclapi_mirror: bool,

    #[serde(rename = "soundEnabled", default = "default_true")]
    pub sound_enabled: bool,

    #[serde(rename = "instancesDir", default, skip_serializing_if = "Option::is_none")]
    pub instances_dir: Option<String>,

    #[serde(rename = "locationEnabled", default, skip_serializing_if = "Option::is_none")]
    pub location_enabled: Option<bool>,

    #[serde(rename = "instanceDefaults", default)]
    pub instance_defaults: InstanceDefaults,
}

fn default_true() -> bool {
    true
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            enable_bmclapi_mirror: false,
            curseforge_api_key: None,
            sound_enabled: true,
            instances_dir: None,
            location_enabled: None,
            instance_defaults: InstanceDefaults::default(),
        }
    }
}

/// In-memory copy of the custom instances folder; `get_instances_dir` runs on hot paths.
static INSTANCES_DIR: std::sync::OnceLock<std::sync::RwLock<Option<PathBuf>>> = std::sync::OnceLock::new();

fn instances_dir_cell() -> &'static std::sync::RwLock<Option<PathBuf>> {
    INSTANCES_DIR.get_or_init(|| {
        let custom = std::fs::read_to_string(get_settings_path())
            .ok()
            .and_then(|c| serde_json::from_str::<DiskSettings>(&c).ok())
            .and_then(|d| d.instances_dir)
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from);
        std::sync::RwLock::new(custom)
    })
}

/// The user-chosen instances folder, if any.
pub fn custom_instances_dir() -> Option<PathBuf> {
    instances_dir_cell().read().ok().and_then(|g| g.clone())
}

/// The folder is opened to the webview as a whole, so drive roots, the user profile itself and system
/// folders are not accepted.
fn reject_unsafe_instances_dir(path: &std::path::Path) -> Result<(), String> {
    // "C:\" has two components (prefix + root); a usable folder needs at least one more.
    if path.components().count() < 3 {
        return Err("E_FOLDER_DRIVE_ROOT".into());
    }
    let lower = |p: &std::path::Path| p.to_string_lossy().to_lowercase().replace('/', "\\");
    let candidate = lower(path);
    let candidate = candidate.trim_end_matches('\\');
    for var in ["USERPROFILE", "HOME"] {
        if let Ok(home) = std::env::var(var) {
            if candidate == lower(std::path::Path::new(&home)).trim_end_matches('\\') {
                return Err("E_FOLDER_USER_HOME".into());
            }
        }
    }
    for var in ["WINDIR", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Ok(sys) = std::env::var(var) {
            let sys = lower(std::path::Path::new(&sys));
            let sys = sys.trim_end_matches('\\');
            if !sys.is_empty() && (candidate == sys || candidate.starts_with(&format!("{sys}\\"))) {
                return Err("E_FOLDER_SYSTEM".into());
            }
        }
    }
    Ok(())
}

/// Accepts an absolute, creatable and writable folder.
fn validate_instances_dir(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if !path.is_absolute() {
        return Err("E_FOLDER_NOT_ABSOLUTE".into());
    }
    reject_unsafe_instances_dir(&path)?;
    std::fs::create_dir_all(&path).map_err(super::ctx("E_FOLDER_CREATE_FAILED"))?;
    let probe = path.join(".focusite_write_test");
    std::fs::write(&probe, b"").map_err(super::ctx("E_FOLDER_NOT_WRITABLE"))?;
    let _ = std::fs::remove_file(probe);
    Ok(path)
}

pub fn get_settings_path() -> PathBuf {
    super::get_app_data_dir().join("settings.json")
}

/// Reads only the mirror flag from settings.json (no keyring access), for hot download paths.
pub fn is_bmclapi_mirror_enabled() -> bool {
    std::fs::read_to_string(get_settings_path())
        .ok()
        .and_then(|c| serde_json::from_str::<DiskSettings>(&c).ok())
        .map(|d| d.enable_bmclapi_mirror)
        .unwrap_or(false)
}

pub fn load_settings_from_disk() -> LauncherSettings {
    let path = get_settings_path();
    let mut disk_settings = DiskSettings {
        enable_bmclapi_mirror: false,
        sound_enabled: true,
        instances_dir: None,
        location_enabled: None,
        instance_defaults: InstanceDefaults::default(),
    };

    if path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let mut need_strip_legacy = false;
            // Check for legacy curseforgeApiKey in plaintext settings.json and migrate to keyring
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(legacy_key) = val.get("curseforgeApiKey").and_then(|v| v.as_str()) {
                    let trimmed = legacy_key.trim();
                    if !trimmed.is_empty() {
                        if CredentialStore::save_token(CURSEFORGE_KEY_ACCOUNT, trimmed).is_ok() {
                            need_strip_legacy = true;
                        }
                    } else {
                        need_strip_legacy = true;
                    }
                }
            }
            if let Ok(parsed) = serde_json::from_str::<DiskSettings>(&content) {
                disk_settings = parsed;
                if need_strip_legacy {
                    let _ = save_disk_settings_internal(&path, &disk_settings);
                }
            }
        }
    }

    // Retrieve sensitive API key strictly from OS keyring
    let secure_key = CredentialStore::get_token(CURSEFORGE_KEY_ACCOUNT)
        .ok()
        .flatten()
        .filter(|k| !k.trim().is_empty());

    LauncherSettings {
        enable_bmclapi_mirror: disk_settings.enable_bmclapi_mirror,
        curseforge_api_key: secure_key,
        sound_enabled: disk_settings.sound_enabled,
        instances_dir: disk_settings.instances_dir,
        location_enabled: disk_settings.location_enabled,
        instance_defaults: disk_settings.instance_defaults,
    }
}

fn save_disk_settings_internal(path: &std::path::Path, disk_settings: &DiskSettings) -> Result<(), String> {
    // Never overwrite settings a newer launcher wrote: the fields unknown here would be lost.
    if let Ok(existing) = std::fs::read_to_string(path) {
        super::check_schema(&existing, "settings.json")?;
    }
    let json = super::to_versioned_json(disk_settings)
        .map_err(super::ctx("E_SETTINGS_SAVE_FAILED"))?;

    super::atomic_write(path, json.as_bytes())
        .map_err(super::ctx("E_SETTINGS_SAVE_FAILED"))
}

pub fn save_settings_to_disk(settings: &LauncherSettings) -> Result<(), String> {
    let path = get_settings_path();
    let disk_settings = DiskSettings {
        enable_bmclapi_mirror: settings.enable_bmclapi_mirror,
        sound_enabled: settings.sound_enabled,
        instances_dir: settings.instances_dir.clone(),
        location_enabled: settings.location_enabled,
        instance_defaults: settings.instance_defaults.clone(),
    };
    save_disk_settings_internal(&path, &disk_settings)
}

#[tauri::command]
pub fn get_launcher_settings() -> Result<LauncherSettings, String> {
    Ok(load_settings_from_disk())
}

/// Runs off the UI thread: changing the instances folder may move gigabytes of data.
#[tauri::command]
pub async fn update_launcher_settings(
    app: tauri::AppHandle,
    enable_bmclapi_mirror: Option<bool>,
    curseforge_api_key: Option<String>,
    sound_enabled: Option<bool>,
    instances_dir: Option<String>,
    location_enabled: Option<bool>,
    instance_defaults: Option<InstanceDefaults>,
) -> Result<LauncherSettings, String> {
    let changes_dir = instances_dir.is_some();
    let result = tauri::async_runtime::spawn_blocking(move || {
        update_settings_blocking(enable_bmclapi_mirror, curseforge_api_key, sound_enabled, instances_dir, location_enabled, instance_defaults)
    })
    .await
    .map_err(super::ctx("E_SETTINGS_UPDATE_FAILED"))?;
    if changes_dir {
        allow_asset_dirs(&app);
    }
    result
}

/// Lets the webview load images (icons, screenshots) from the app data folder and from a custom
/// instances folder, which the static scope in tauri.conf.json cannot know about.
pub fn allow_asset_dirs(app: &tauri::AppHandle) {
    use tauri::Manager;
    let scope = app.asset_protocol_scope();
    for dir in [super::get_app_data_dir(), super::instance::get_instances_dir()] {
        if let Err(e) = scope.allow_directory(&dir, true) {
            tracing::warn!("Couldn't allow asset directory {}: {}", dir.display(), e);
        }
    }
}

fn update_settings_blocking(
    enable_bmclapi_mirror: Option<bool>,
    curseforge_api_key: Option<String>,
    sound_enabled: Option<bool>,
    instances_dir: Option<String>,
    location_enabled: Option<bool>,
    instance_defaults: Option<InstanceDefaults>,
) -> Result<LauncherSettings, String> {
    let mut current = load_settings_from_disk();
    if let Some(defaults) = instance_defaults {
        current.instance_defaults = defaults.normalized();
    }
    if location_enabled.is_some() {
        current.location_enabled = location_enabled;
    }
    if let Some(enable_mirror) = enable_bmclapi_mirror {
        current.enable_bmclapi_mirror = enable_mirror;
    }
    if let Some(key) = curseforge_api_key {
        let trimmed = key.trim().to_string();
        if trimmed.is_empty() {
            let _ = CredentialStore::delete_token(CURSEFORGE_KEY_ACCOUNT);
            current.curseforge_api_key = None;
        } else {
            CredentialStore::save_token(CURSEFORGE_KEY_ACCOUNT, &trimmed)
                .map_err(super::ctx("E_API_KEY_SAVE_FAILED"))?;
            current.curseforge_api_key = Some(trimmed);
        }
    }
    if let Some(sound) = sound_enabled {
        current.sound_enabled = sound;
    }
    // Empty string resets to the default folder. Existing instances move along with it.
    if let Some(raw) = instances_dir {
        let new_dir = if raw.trim().is_empty() {
            None
        } else {
            Some(validate_instances_dir(&raw)?)
        };
        let old_path = super::instance::get_instances_dir();
        let new_path = new_dir
            .clone()
            .unwrap_or_else(|| super::get_app_data_dir().join("instances"));
        move_instances(&old_path, &new_path)?;
        current.instances_dir = new_dir.as_ref().map(|p| p.to_string_lossy().to_string());
        if let Err(e) = save_settings_to_disk(&current) {
            // The setting still points at the old folder, so put the instances back with it.
            let _ = move_instances(&new_path, &old_path);
            return Err(e);
        }
        if let Ok(mut guard) = instances_dir_cell().write() {
            *guard = new_dir;
        }
        return Ok(current);
    }
    save_settings_to_disk(&current)?;
    Ok(current)
}

/// Renames when possible (same volume); otherwise copies, then removes the source.
fn move_entry(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    let result = if src.is_dir() {
        super::copy_dir_all(src, dst, false)
    } else {
        std::fs::copy(src, dst).map(|_| ())
    };
    if let Err(e) = result {
        let _ = if dst.is_dir() { std::fs::remove_dir_all(dst) } else { std::fs::remove_file(dst) };
        return Err(e);
    }
    if src.is_dir() {
        std::fs::remove_dir_all(src)
    } else {
        std::fs::remove_file(src)
    }
}

/// Moves everything in `old` into `new`. Refuses (before touching anything) when an instance is busy,
/// the folders are nested, or a name already exists in `new`; rolls back if a move fails midway.
fn move_instances(old: &std::path::Path, new: &std::path::Path) -> Result<(), String> {
    if !old.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(new).map_err(super::ctx("E_FOLDER_CREATE_FAILED"))?;
    let (old_c, new_c) = (
        std::fs::canonicalize(old).map_err(|e| e.to_string())?,
        std::fs::canonicalize(new).map_err(|e| e.to_string())?,
    );
    if old_c == new_c {
        return Ok(());
    }
    if new_c.starts_with(&old_c) || old_c.starts_with(&new_c) {
        return Err("E_FOLDERS_NESTED".into());
    }

    let entries: Vec<_> = std::fs::read_dir(old)
        .map_err(super::ctx("E_INSTANCE_FOLDER_UNREADABLE"))?
        .flatten()
        .collect();
    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if super::instance::is_instance_busy(&name) {
            return Err(format!("E_MOVE_INSTANCE_BUSY: {name}"));
        }
        if new.join(&name).exists() {
            return Err(format!("E_MOVE_NAME_TAKEN: {name}"));
        }
    }

    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for entry in &entries {
        let (src, dst) = (entry.path(), new.join(entry.file_name()));
        if let Err(e) = move_entry(&src, &dst) {
            for (from, to) in moved.into_iter().rev() {
                let _ = move_entry(&to, &from);
            }
            return Err(format!("E_MOVE_FAILED: {e}"));
        }
        moved.push((src, dst));
    }
    Ok(())
}

/// The folder instances are currently read from and created in.
#[tauri::command]
pub fn get_instances_dir_path() -> String {
    super::instance::get_instances_dir().to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_launcher_settings_default_privacy_first() {
        let def = LauncherSettings::default();
        assert!(!def.enable_bmclapi_mirror);
        assert!(def.curseforge_api_key.is_none());
        assert!(def.sound_enabled);
    }

    #[test]
    fn test_unsafe_instances_dirs_are_rejected() {
        assert!(validate_instances_dir("C:\\").is_err());
        assert!(validate_instances_dir("D:\\").is_err());
        if let Ok(win) = std::env::var("WINDIR") {
            assert!(validate_instances_dir(&win).is_err());
            assert!(validate_instances_dir(&format!("{win}\\Temp\\x")).is_err());
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            assert!(validate_instances_dir(&home).is_err());
        }
    }

    #[test]
    fn test_validate_instances_dir() {
        assert!(validate_instances_dir("relative/dir").is_err());
        let dir = std::env::temp_dir().join(format!("fc_inst_{}", uuid::Uuid::new_v4()));
        assert_eq!(validate_instances_dir(dir.to_str().unwrap()).unwrap(), dir);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_move_instances() {
        let base = std::env::temp_dir().join(format!("fc_move_{}", uuid::Uuid::new_v4()));
        let (old, new) = (base.join("old"), base.join("new"));
        std::fs::create_dir_all(old.join("a").join("minecraft")).unwrap();
        std::fs::write(old.join("a").join("minecraft").join("f.txt"), "x").unwrap();

        move_instances(&old, &new).unwrap();
        assert!(new.join("a").join("minecraft").join("f.txt").is_file());
        assert!(!old.join("a").exists());

        // Name clash and nesting are refused without touching anything.
        std::fs::create_dir_all(old.join("a")).unwrap();
        assert!(move_instances(&old, &new).is_err());
        assert!(move_instances(&new, &new.join("sub")).is_err());
        assert!(old.join("a").exists());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn test_launcher_settings_serde_roundtrip() {
        let settings = LauncherSettings {
            enable_bmclapi_mirror: true,
            curseforge_api_key: Some("$2a$10$fakekey".into()),
            sound_enabled: false,
            instances_dir: None,
            location_enabled: Some(true),
            instance_defaults: InstanceDefaults::default(),
        };
        let serialized = serde_json::to_string(&settings).unwrap();
        assert!(serialized.contains("enableBmclapiMirror"));
        assert!(serialized.contains("curseforgeApiKey"));
        assert!(serialized.contains("locationEnabled"));

        let deserialized: LauncherSettings = serde_json::from_str(&serialized).unwrap();
        assert!(deserialized.enable_bmclapi_mirror);
        assert_eq!(deserialized.curseforge_api_key.as_deref(), Some("$2a$10$fakekey"));
        assert!(!deserialized.sound_enabled);
        assert_eq!(deserialized.location_enabled, Some(true));
    }

    #[test]
    fn test_location_enabled_defaults_to_not_asked() {
        // Old settings.json files have no locationEnabled: the user has not been asked yet.
        let disk: DiskSettings = serde_json::from_str(r#"{"enableBmclapiMirror":false}"#).unwrap();
        assert_eq!(disk.location_enabled, None);
    }

    #[test]
    fn test_disk_settings_never_persists_api_key() {
        let disk = DiskSettings {
            enable_bmclapi_mirror: true,
            sound_enabled: false,
            instances_dir: None,
            location_enabled: None,
            instance_defaults: InstanceDefaults::default(),
        };
        let serialized = serde_json::to_string(&disk).unwrap();
        assert!(!serialized.contains("curseforgeApiKey"));
        assert!(!serialized.contains("curseforge_api_key"));
    }
}

#[cfg(test)]
mod defaults_tests {
    use super::*;

    #[test]
    fn instance_defaults_apply_only_what_is_set() {
        let mut config = super::super::instance::new_disk_config("i", "n", "1.21", "Vanilla", None);
        InstanceDefaults::default().apply_to(&mut config);
        assert_eq!((config.min_memory_mb, config.max_memory_mb, &config.java_path), (1024, 4096, &None));

        let defaults = InstanceDefaults {
            min_memory_mb: Some(8192),
            max_memory_mb: Some(2048),
            java_path: Some("  ".into()),
            custom_jvm_args: Some(Vec::new()),
        }
        .normalized();
        assert_eq!((&defaults.java_path, &defaults.custom_jvm_args), (&None, &None));
        defaults.apply_to(&mut config);
        assert_eq!((config.min_memory_mb, config.max_memory_mb), (2048, 2048));
    }
}
