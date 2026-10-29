//! Tauri command implementations for Focusite Launcher.

use std::path::PathBuf;

pub mod auth;
pub mod diagnostic;
pub mod download;
pub mod instance;
pub mod launch;
pub mod manifest;
pub mod modpack;
pub mod p2p;
pub mod settings;
pub mod skin;

/// Resolves the canonical Focusite Launcher storage directory: %APPDATA%/focusite_launcher/
pub fn get_app_data_dir() -> PathBuf {
    let dir = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("focusite_launcher")
    } else if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        PathBuf::from(home).join(".focusite_launcher")
    } else {
        PathBuf::from(".").join(".focusite_launcher")
    };

    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    dir
}
