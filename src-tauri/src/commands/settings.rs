//! Global launcher settings management and persistence.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherSettings {
    #[serde(rename = "enableBmclapiMirror", default)]
    pub enable_bmclapi_mirror: bool,

    #[serde(rename = "curseforgeApiKey", default, skip_serializing_if = "Option::is_none")]
    pub curseforge_api_key: Option<String>,

    #[serde(rename = "soundEnabled", default = "default_true")]
    pub sound_enabled: bool,
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
        }
    }
}

pub fn get_settings_path() -> PathBuf {
    super::get_app_data_dir().join("settings.json")
}

pub fn load_settings_from_disk() -> LauncherSettings {
    let path = get_settings_path();
    if path.is_file() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<LauncherSettings>(&content) {
                return settings;
            }
        }
    }
    LauncherSettings::default()
}

pub fn save_settings_to_disk(settings: &LauncherSettings) -> Result<(), String> {
    let path = get_settings_path();
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, json.as_bytes())
        .map_err(|e| format!("Failed to write temp settings file: {}", e))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to replace settings file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_launcher_settings() -> Result<LauncherSettings, String> {
    Ok(load_settings_from_disk())
}

#[tauri::command]
pub fn update_launcher_settings(
    enable_bmclapi_mirror: Option<bool>,
    curseforge_api_key: Option<String>,
    sound_enabled: Option<bool>,
) -> Result<LauncherSettings, String> {
    let mut current = load_settings_from_disk();
    if let Some(enable_mirror) = enable_bmclapi_mirror {
        current.enable_bmclapi_mirror = enable_mirror;
    }
    if let Some(key) = curseforge_api_key {
        let trimmed = key.trim().to_string();
        current.curseforge_api_key = if trimmed.is_empty() { None } else { Some(trimmed) };
    }
    if let Some(sound) = sound_enabled {
        current.sound_enabled = sound;
    }
    save_settings_to_disk(&current)?;
    Ok(current)
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
    fn test_launcher_settings_serde_roundtrip() {
        let settings = LauncherSettings {
            enable_bmclapi_mirror: true,
            curseforge_api_key: Some("$2a$10$fakekey".into()),
            sound_enabled: false,
        };
        let serialized = serde_json::to_string(&settings).unwrap();
        assert!(serialized.contains("enableBmclapiMirror"));
        assert!(serialized.contains("curseforgeApiKey"));

        let deserialized: LauncherSettings = serde_json::from_str(&serialized).unwrap();
        assert!(deserialized.enable_bmclapi_mirror);
        assert_eq!(deserialized.curseforge_api_key.as_deref(), Some("$2a$10$fakekey"));
        assert!(!deserialized.sound_enabled);
    }
}
