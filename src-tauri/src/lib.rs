//! Focusite Launcher Tauri entry point and application initialization.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LauncherInfo {
    pub name: String,
    pub version: String,
    pub clean_room: bool,
}

#[tauri::command]
fn get_launcher_info() -> LauncherInfo {
    LauncherInfo {
        name: "Focusite Launcher".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        clean_room: true,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_launcher_info])
        .run(tauri::generate_context!())
        .expect("error while running Focusite launcher");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_launcher_info() {
        let info = get_launcher_info();
        assert_eq!(info.name, "Focusite Launcher");
        assert_eq!(info.version, "26.1.0");
        assert!(info.clean_room);
    }
}
