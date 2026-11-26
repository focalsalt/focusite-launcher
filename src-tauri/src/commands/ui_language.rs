//! UI language for text the backend writes itself: progress, console lines, tray and window titles.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{menu::MenuItem, Manager};

// zh-TW until the frontend reports otherwise.
static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn is_zh() -> bool {
    !ENGLISH.load(Ordering::Relaxed)
}

/// Formats the zh-TW or the en-US template, matching the UI language.
macro_rules! tr {
    ($zh:literal, $en:literal $(, $arg:expr)*) => {
        focusite_diagnostic::localized!($crate::commands::ui_language::is_zh(), $zh, $en $(, $arg)*)
    };
}
pub(crate) use tr;

/// Tray menu items, kept so they can be renamed when the language changes.
pub struct TrayItems {
    pub show: MenuItem<tauri::Wry>,
    pub quit: MenuItem<tauri::Wry>,
}

pub fn tray_show_label() -> String {
    tr!("顯示主視窗", "Show main window")
}

pub fn tray_quit_label() -> String {
    tr!("結束 Focusite", "Quit Focusite")
}

#[tauri::command]
pub fn set_ui_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    ENGLISH.store(language != "zh-TW", Ordering::Relaxed);
    if let Some(tray) = app.try_state::<TrayItems>() {
        tray.show.set_text(tray_show_label()).map_err(|e| e.to_string())?;
        tray.quit.set_text(tray_quit_label()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
