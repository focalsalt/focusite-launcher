//! Focusite Launcher Tauri entry point and application initialization.

pub mod commands;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// Monotonic atomic latch indicating whether the initial splash-to-main window handover has completed.
static STARTUP_HANDOVER_DONE: AtomicBool = AtomicBool::new(false);

/// Returns the WebView2 Chromium browser arguments required to keep the hidden main window responsive,
/// preventing timer throttling, renderer deprioritization, and occluded window freezing.
pub fn get_webview2_browser_arguments() -> &'static str {
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
}

/// Determines whether the startup splash window is allowed to become visible.
pub fn should_allow_splash_display(handover_flag: &AtomicBool, main_visible: bool) -> bool {
    !handover_flag.load(Ordering::Acquire) && !main_visible
}

/// Atomically claims the startup handover transition. Returns `true` on the first transition,
/// or `false` if the handover had already been completed earlier.
pub fn mark_startup_handover_done(handover_flag: &AtomicBool) -> bool {
    !handover_flag.swap(true, Ordering::AcqRel)
}

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

/// Gracefully closes all auxiliary windows (such as log-window) to prevent Win32 Error 1412
/// (ERROR_CLASS_HAS_WINDOWS) during Chromium class unregistration, then terminates the app.
pub fn clean_shutdown(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label != "main" {
            let _ = window.destroy();
        }
    }
    app.exit(0);
}

/// Shows the dedicated startup splash window once its DOM and first frame are painted.
/// If the main workspace is already visible or handover has completed, splash display is skipped.
#[tauri::command]
fn show_splash_window(app: tauri::AppHandle) -> Result<(), String> {
    let main_visible = app
        .get_webview_window("main")
        .and_then(|main| main.is_visible().ok())
        .unwrap_or(false);

    if !should_allow_splash_display(&STARTUP_HANDOVER_DONE, main_visible) {
        return Ok(());
    }

    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.show();
        let _ = splash.as_ref().show();
        let _ = splash.center();
    }
    Ok(())
}

/// Smoothly presents the 1280x720 main workspace window once all initial data and React
/// first frame are completely rendered, and gracefully destroys the splash window.
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    mark_startup_handover_done(&STARTUP_HANDOVER_DONE);

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.as_ref().show();
        let _ = main.unminimize();
        let _ = main.set_focus();
        let _ = main.as_ref().set_focus();

        // Nudge size by 1 physical pixel and restore to force Tao and Wry to dispatch
        // WM_SIZE, triggering controller.SetBounds and immediately presenting DirectComposition surface.
        if let Ok(size) = main.inner_size() {
            let _ = main.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: size.width,
                height: size.height.saturating_add(1),
            }));
            let _ = main.set_size(tauri::Size::Physical(size));
        }
    }
    if let Some(splash) = app.get_webview_window("splash") {
        // Destroy the splash window after a brief asynchronous delay (120ms) to ensure
        // WebView2 DirectComposition compositor in the main window has rendered and presented
        // its first frame, preventing any momentary visual gap or desktop flicker.
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            let _ = splash.destroy();
        });
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    // Prevent Chromium / WebView2 from throttling background tasks, timers, renderer priority,
    // and occluded window composition when the main window is created hidden (`visible: false`).
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        get_webview2_browser_arguments(),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            commands::settings::allow_asset_dirs(app.handle());
            let show_item = MenuItemBuilder::with_id("show", "顯示主視窗").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "結束 Focusite").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("Focusite Launcher")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.as_ref().show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.as_ref().set_focus();
                            }
                        }
                        "quit" => {
                            if commands::launch::has_running_instances() {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.as_ref().show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                    let _ = window.as_ref().set_focus();
                                    let _ = window.emit("request-exit-confirmation", ());
                                }
                            } else {
                                clean_shutdown(app);
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.as_ref().show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.as_ref().set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _ = tray_builder.build(app)?;

            // Watchdog fallback: ensure main window is revealed and splash destroyed
            // ONLY if frontend fails to complete initialization within 8 seconds.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(8));
                if !STARTUP_HANDOVER_DONE.load(Ordering::Acquire) {
                    let _ = show_main_window(app_handle);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "splash" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    clean_shutdown(window.app_handle());
                }
            } else if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if commands::launch::has_running_instances() {
                        // Prevent closing, hide window to tray instead
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        // No instances running, exit completely to avoid background zombie
                        clean_shutdown(window.app_handle());
                    }
                }
            } else if window.label().starts_with("log-window-") || window.label().starts_with("workshop-") {
                // Subwindows can close and destroy cleanly
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_launcher_info,
            show_splash_window,
            show_main_window,
            commands::manifest::get_version_manifest,
            commands::manifest::get_version_detail,
            commands::manifest::get_loader_versions,
            commands::instance::list_instances,
            commands::instance::create_instance,
            commands::instance::setup_instance,
            commands::instance::list_custom_jars,
            commands::instance::save_custom_jar,
            commands::instance::rename_instance,
            commands::instance::delete_instance,
            commands::instance::update_instance_settings,
            commands::instance::duplicate_instance,
            commands::instance::open_instance_directory,
            commands::instance::toggle_mod_state,
            commands::instance::list_instance_mods,
            commands::instance::list_instance_coremods,
            commands::instance::toggle_coremod_state,
            commands::instance::list_instance_resourcepacks,
            commands::instance::list_instance_shaderpacks,
            commands::instance::list_instance_screenshots,
            commands::instance::set_instance_icon_from_file,
            commands::instance::set_instance_preset_icon,
            commands::instance::reset_instance_icon,
            commands::auth::auth_check_client_id,
            commands::auth::auth_start_device_code,
            commands::auth::auth_poll_device_code,
            commands::auth::auth_list_accounts,
            commands::auth::auth_remove_account,
            commands::auth::auth_set_active_account,
            commands::auth::auth_update_account_skin,
            commands::auth::auth_refresh_profile,
            commands::auth::auth_verify_offline_launch,
            commands::friends::friends_list_xuids,
            commands::skin::skin_list_local,
            commands::skin::skin_save_local,
            commands::skin::skin_delete_local,
            commands::skin::skin_upload_to_mojang,
            commands::skin::skin_set_active_cape,
            commands::skin::skin_hide_active_cape,
            commands::settings::get_launcher_settings,
            commands::settings::update_launcher_settings,
            commands::settings::get_instances_dir_path,
            commands::diagnostic::diagnose_log_content,
            commands::diagnostic::diagnose_instance_log,
            commands::p2p::start_p2p_host,
            commands::p2p::stop_p2p_session,
            commands::p2p::list_p2p_sessions,
            commands::p2p::p2p_verify_handshake,
            commands::p2p::p2p_create_offer,
            commands::p2p::p2p_apply_answer,
            commands::p2p::p2p_join_with_offer,
            commands::p2p::p2p_firewall_status,
            commands::p2p::p2p_firewall_setup,
            commands::modpack::import_modpack,
            commands::modpack::import_modrinth_modpack,
            commands::modpack::rescan_instance_missing_mods,
            commands::modpack::open_external_urls,
            commands::workshop::open_instance_workshop_window,
            commands::workshop::workshop_search_projects,
            commands::workshop::workshop_list_categories,
            commands::workshop::workshop_get_project,
            commands::workshop::workshop_list_versions,
            commands::workshop::workshop_resolve_install_plan,
            commands::workshop::workshop_execute_install_plan,
            commands::workshop::instance_plan_stack_migration,
            commands::workshop::instance_execute_stack_migration,
            commands::world::list_instance_worlds_cmd,
            commands::world::rename_instance_world_cmd,
            commands::world::delete_instance_world_cmd,
            commands::world::backup_instance_world_cmd,
            commands::server::read_instance_servers_cmd,
            commands::server::save_instance_servers_cmd,
            commands::server::ping_server_cmd,
            commands::launch::list_system_javas,
            commands::launch::launch_instance,
            commands::launch::kill_instance,
            commands::launch::get_instance_running_status,
            commands::launch::get_running_instances,
            commands::launch::get_instance_log_buffer,
            commands::launch::allow_asset_image,
            commands::launch::exit_app,
            commands::news::news_fetch_archive_page,
            commands::theme::list_themes,
            commands::theme::import_theme_pack,
            commands::theme::open_themes_dir,
        ])
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

    #[test]
    fn test_startup_handover_state_machine() {
        let handover_flag = AtomicBool::new(false);

        // 1. Before handover: splash is allowed only when main window is hidden
        assert!(should_allow_splash_display(&handover_flag, false));
        assert!(!should_allow_splash_display(&handover_flag, true));

        // 2. First handover transitions flag and returns true
        assert!(mark_startup_handover_done(&handover_flag));
        assert!(handover_flag.load(Ordering::Acquire));

        // 3. After handover: splash is strictly forbidden even if main window is hidden to tray
        assert!(!should_allow_splash_display(&handover_flag, false));
        assert!(!should_allow_splash_display(&handover_flag, true));

        // 4. Subsequent handover attempts (e.g. Watchdog) detect completion and return false
        assert!(!mark_startup_handover_done(&handover_flag));
    }

    #[test]
    fn test_webview2_browser_arguments() {
        let args = get_webview2_browser_arguments();
        assert!(args.contains("--disable-background-timer-throttling"));
        assert!(args.contains("--disable-backgrounding-occluded-windows"));
        assert!(args.contains("--disable-renderer-backgrounding"));
        assert!(args.contains("CalculateNativeWinOcclusion"));
        assert!(args.contains("msWebOOUI"));
        assert!(args.contains("msPdfOOUI"));
        assert!(args.contains("msSmartScreenProtection"));
    }

    #[test]
    fn test_tauri_config_windows_browser_arguments_alignment() {
        let config_str = include_str!("../tauri.conf.json");
        let v: serde_json::Value =
            serde_json::from_str(config_str).expect("tauri.conf.json must be valid JSON");
        let windows = v["app"]["windows"]
            .as_array()
            .expect("app.windows must be an array");

        let expected_args = get_webview2_browser_arguments();

        for win in windows {
            let label = win["label"].as_str().unwrap_or_default();
            if label == "splash" || label == "main" {
                let actual_args = win["additionalBrowserArgs"]
                    .as_str()
                    .unwrap_or_else(|| panic!("window '{}' must specify additionalBrowserArgs", label));
                assert_eq!(
                    actual_args, expected_args,
                    "window '{}' additionalBrowserArgs mismatch",
                    label
                );
            }
        }
    }

    #[test]
    fn test_quad_version_alignment() {
        // 1. Cargo.toml workspace version
        let cargo_toml = include_str!("../../Cargo.toml");
        let cargo_version = cargo_toml
            .lines()
            .find(|line| line.starts_with("version = "))
            .and_then(|line| line.split('"').nth(1))
            .expect("workspace Cargo.toml must have version");

        // 2. tauri.conf.json
        let tauri_conf = include_str!("../tauri.conf.json");
        let tauri_val: serde_json::Value =
            serde_json::from_str(tauri_conf).expect("tauri.conf.json must be valid JSON");
        let tauri_version = tauri_val["version"]
            .as_str()
            .expect("tauri.conf.json must contain version");

        // 3. package.json
        let package_json = include_str!("../../package.json");
        let package_val: serde_json::Value =
            serde_json::from_str(package_json).expect("package.json must be valid JSON");
        let package_version = package_val["version"]
            .as_str()
            .expect("package.json must contain version");

        // 4. Launcher runtime info (WindowBar & System)
        let runtime_info = get_launcher_info();

        assert_eq!(cargo_version, "26.1.0", "Cargo.toml version must be 26.1.0");
        assert_eq!(tauri_version, "26.1.0", "tauri.conf.json version must be 26.1.0");
        assert_eq!(package_version, "26.1.0", "package.json version must be 26.1.0");
        assert_eq!(runtime_info.version, "26.1.0", "Runtime version must be 26.1.0");
    }
}
