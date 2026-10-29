//! Minecraft process launching, JRE resolution, and stdout/stderr event streaming.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use focusite_core::args::{
    build_classpath, build_launch_arguments, build_legacy_pre16_forge_arguments, LaunchContext,
};
use focusite_core::instance::{ModsTabMode, VersionCapabilities};
use focusite_core::java::{
    get_recommended_java_version, resolve_or_locate_java, scan_system_javas, JavaInstallation,
};
use focusite_core::manifest::VersionManifest;
use focusite_core::process::{terminate_process_tree, ProcessLauncher};
use super::instance::{get_instances_dir, validate_safe_id, InstanceDiskConfig};

/// Active game processes mapped by instance ID -> RunningProcessInfo (PID, account ID, account name).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunningProcessInfo {
    pub pid: u32,
    pub instance_id: String,
    #[serde(rename = "accountId", default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    #[serde(rename = "accountName", default, skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
}

static RUNNING_PROCESSES: LazyLock<Arc<Mutex<HashMap<String, RunningProcessInfo>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Checks if any game instance is currently running in the background.
pub fn has_running_instances() -> bool {
    RUNNING_PROCESSES.lock().map(|m| !m.is_empty()).unwrap_or(false)
}

/// Returns the count of actively running instances.
pub fn running_instance_count() -> usize {
    RUNNING_PROCESSES.lock().map(|m| m.len()).unwrap_or(0)
}

/// Forcefully terminates all running Minecraft instances and clears tracking.
pub async fn kill_all_running_instances() -> Result<(), String> {
    let pids: Vec<u32> = {
        let mut map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        let pids = map.values().map(|p| p.pid).collect();
        map.clear();
        pids
    };

    for pid in pids {
        let _ = terminate_process_tree(pid).await;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceLogPayload {
    pub instance_id: String,
    pub stream: String, // "stdout" | "stderr" | "system"
    pub line: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceStatusPayload {
    pub instance_id: String,
    pub status: String, // "launching" | "running" | "stopped" | "crashed"
    pub exit_code: Option<i32>,
    pub pid: Option<u32>,
}

#[tauri::command]
pub fn list_system_javas() -> Result<Vec<JavaInstallation>, String> {
    Ok(scan_system_javas())
}

#[tauri::command]
pub fn get_instance_running_status(instance_id: String) -> Result<Option<RunningProcessInfo>, String> {
    validate_safe_id(&instance_id)?;
    let map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
    Ok(map.get(&instance_id).cloned())
}

#[tauri::command]
pub fn get_running_instances() -> Result<Vec<RunningProcessInfo>, String> {
    let map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
    Ok(map.values().cloned().collect())
}

/// Dynamically creates or reveals the detached log window when needed (game launch or crash).
pub fn ensure_or_create_log_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window("log-window") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(existing);
    }

    let win = tauri::WebviewWindowBuilder::new(
        app,
        "log-window",
        tauri::WebviewUrl::App("index.html#/log-window".into()),
    )
    .title("Focusite 遊戲即時控制台")
    .inner_size(860.0, 540.0)
    .min_inner_size(600.0, 380.0)
    .decorations(true)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    Ok(win)
}

#[tauri::command]
pub async fn exit_app(app_handle: AppHandle) -> Result<(), String> {
    let _ = kill_all_running_instances().await;
    for (label, window) in app_handle.webview_windows() {
        if label != "main" {
            let _ = window.destroy();
        }
    }
    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn kill_instance(instance_id: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let pid_opt = {
        let map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        map.get(&instance_id).map(|p| p.pid)
    };

    if let Some(pid) = pid_opt {
        terminate_process_tree(pid)
            .await
            .map_err(|e| format!("Failed to terminate process {}: {}", pid, e))?;
        let mut map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        map.remove(&instance_id);
        Ok(())
    } else {
        Err(format!("Instance {} is not currently running", instance_id))
    }
}

#[tauri::command]
pub async fn launch_instance(
    app_handle: AppHandle,
    instance_id: String,
    account_id: Option<String>,
    account_name: Option<String>,
) -> Result<u32, String> {
    validate_safe_id(&instance_id)?;

    // 1. Single instance mutex check:同一實例不可重複啟動
    {
        let map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = map.get(&instance_id) {
            return Err(format!(
                "實例 '{}' 已在運行中 (PID: {})，無法重複啟動",
                instance_id, existing.pid
            ));
        }
    }

    // 2. Read instance configuration
    let base_dir = get_instances_dir().join(&instance_id);
    let mut config_path = base_dir.join("instance.cfg");
    if !config_path.is_file() {
        let legacy_json = base_dir.join("instance.json");
        if legacy_json.is_file() {
            config_path = legacy_json;
        } else {
            return Err(format!("Instance configuration not found at {:?}", config_path));
        }
    }

    let config_content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read instance config: {}", e))?;
    let instance_config: InstanceDiskConfig = serde_json::from_str(&config_content)
        .map_err(|e| format!("Invalid instance config JSON: {}", e))?;

    let game_dir = base_dir.join("minecraft");
    if !game_dir.exists() {
        let legacy_dir = base_dir.join(".minecraft");
        if legacy_dir.is_dir() {
            let _ = std::fs::rename(&legacy_dir, &game_dir);
        } else {
            std::fs::create_dir_all(&game_dir)
                .map_err(|e| format!("Failed to create minecraft directory: {}", e))?;
        }
    }

    // 3. Resolve Java
    let required_major = get_recommended_java_version(&instance_config.version);
    let java_path = if let Some(ref custom_java) = instance_config.java_path {
        if !custom_java.trim().is_empty() && std::path::Path::new(custom_java).exists() {
            std::path::PathBuf::from(custom_java)
        } else {
            resolve_or_locate_java(required_major, None)
                .map_err(|e| format!("無法解析相容的 Java 環境 (需要 Java {}): {}", required_major, e))?
        }
    } else {
        resolve_or_locate_java(required_major, None)
            .map_err(|e| format!("無法解析相容的 Java 環境 (需要 Java {}): {}", required_major, e))?
    };

    // 4. Show the detached log window ONLY if show_log_on_launch is true
    if instance_config.show_log_on_launch {
        let _ = ensure_or_create_log_window(&app_handle);
    }

    let _ = app_handle.emit(
        "instance-status",
        InstanceStatusPayload {
            instance_id: instance_id.clone(),
            status: "launching".into(),
            exit_code: None,
            pid: None,
        },
    );

    let _ = app_handle.emit(
        "instance-log",
        InstanceLogPayload {
            instance_id: instance_id.clone(),
            stream: "system".into(),
            line: format!(
                "[Focusite] 正在為實例 '{}' (Minecraft {}) 啟動 Java 進程...",
                instance_config.name, instance_config.version
            ),
            timestamp: chrono::Utc::now().timestamp_millis(),
        },
    );

    let _ = app_handle.emit(
        "instance-log",
        InstanceLogPayload {
            instance_id: instance_id.clone(),
            stream: "system".into(),
            line: format!("[Focusite] 使用 Java: {:?}", java_path),
            timestamp: chrono::Utc::now().timestamp_millis(),
        },
    );

    // 5. Construct Launch Arguments
    // Shared global directories in %APPDATA%/focusite_launcher/
    let app_data = super::get_app_data_dir();
    let assets_dir = app_data.join("assets");
    let libraries_dir = app_data.join("libraries");
    let natives_dir = app_data.join("natives").join(&instance_config.version);
    let versions_dir = app_data.join("versions").join(&instance_config.version);

    if !assets_dir.exists() {
        let _ = std::fs::create_dir_all(&assets_dir);
    }
    if !libraries_dir.exists() {
        let _ = std::fs::create_dir_all(&libraries_dir);
    }
    if !natives_dir.exists() {
        let _ = std::fs::create_dir_all(&natives_dir);
    }

    let client_jar = if versions_dir.join(format!("{}.jar", instance_config.version)).is_file() {
        versions_dir.join(format!("{}.jar", instance_config.version))
    } else {
        game_dir
            .join("bin")
            .join(format!("{}.jar", instance_config.version))
    };

    let player_name = account_name.clone().unwrap_or_else(|| "Player".into());
    let context = LaunchContext {
        auth_player_name: player_name,
        version_name: instance_config.version.clone(),
        game_directory: game_dir.to_string_lossy().to_string(),
        assets_root: assets_dir.to_string_lossy().to_string(),
        assets_index_name: instance_config.version.clone(),
        auth_uuid: uuid::Uuid::new_v4().to_string(),
        auth_access_token: "0".into(),
        user_type: "msa".into(),
        version_type: "release".into(),
        classpath: client_jar.to_string_lossy().to_string(),
        natives_directory: natives_dir.to_string_lossy().to_string(),
        launcher_name: "Focusite".into(),
        launcher_version: env!("CARGO_PKG_VERSION").into(),
        tweak_class: None,
    };

    let min_memory = instance_config.min_memory_mb;
    let max_memory = instance_config.max_memory_mb;
    let jvm_args_list: Vec<String> = if instance_config.jvm_args.is_empty() {
        vec![
            "-XX:+UseG1GC".into(),
            "-XX:+ParallelRefProcEnabled".into(),
            "-XX:MaxGCPauseMillis=200".into(),
        ]
    } else {
        instance_config.jvm_args.clone()
    };

    let caps = VersionCapabilities::from_mc_version(&instance_config.version);
    let is_legacy_forge = instance_config.loader.eq_ignore_ascii_case("forge")
        && caps.mods_tab_mode == ModsTabMode::LegacyDualNav;

    let os_name = focusite_core::manifest::get_current_os();
    let os_arch = focusite_core::manifest::get_current_arch();

    let args = if is_legacy_forge {
        let coremods_dir = game_dir.join("coremods");
        let mods_dir = game_dir.join("mods");
        let _ = std::fs::create_dir_all(&coremods_dir);
        let _ = std::fs::create_dir_all(&mods_dir);

        let mut forge_jar = client_jar.clone();
        if let Ok(entries) = std::fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let fname = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                    if fname.contains("forge") && fname.ends_with(".jar") {
                        forge_jar = path;
                        break;
                    }
                }
            }
        }

        let mut lwjgl_jars = Vec::new();
        let bin_dir = game_dir.join("bin");
        if let Ok(entries) = std::fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let fname = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                    if fname.contains("lwjgl") && fname.ends_with(".jar") {
                        lwjgl_jars.push(path);
                    }
                }
            }
        }

        let mut legacy_context = context.clone();
        if bin_dir.join("natives").is_dir() {
            legacy_context.natives_directory = bin_dir.join("natives").to_string_lossy().to_string();
        }

        build_legacy_pre16_forge_arguments(
            &forge_jar,
            &client_jar,
            &lwjgl_jars,
            &legacy_context,
            min_memory,
            max_memory,
            &jvm_args_list,
            None,
        )
    } else {
        let manifest_path = versions_dir.join(format!("{}.json", instance_config.version));
        let default_manifest = || VersionManifest {
            id: instance_config.version.clone(),
            version_type: "release".into(),
            main_class: "net.minecraft.client.main.Main".into(),
            java_version: None,
            arguments: None,
            legacy_arguments: Some(
                "--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --versionType ${version_type}".into(),
            ),
            libraries: Vec::new(),
            downloads: None,
            asset_index: None,
            assets: None,
            inherits_from: None,
        };

        let mut manifest = if manifest_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                serde_json::from_str::<VersionManifest>(&content).unwrap_or_else(|_| default_manifest())
            } else {
                default_manifest()
            }
        } else {
            default_manifest()
        };

        // Resolve inheritsFrom (e.g. Forge / Fabric inheriting from Vanilla Minecraft manifest)
        if let Some(ref parent_id) = manifest.inherits_from.clone() {
            let parent_path = app_data
                .join("versions")
                .join(parent_id)
                .join(format!("{}.json", parent_id));
            if parent_path.is_file() {
                if let Ok(parent_content) = std::fs::read_to_string(&parent_path) {
                    if let Ok(parent_manifest) = serde_json::from_str::<VersionManifest>(&parent_content) {
                        manifest = manifest.merge_parent(&parent_manifest);
                    }
                }
            }
        }

        let mut allowed_libs = Vec::new();
        for lib in &manifest.libraries {
            if lib.is_allowed(os_name, os_arch) {
                let rel = lib.get_relative_path();
                let full = libraries_dir.join(rel);
                if full.is_file() {
                    allowed_libs.push(full);
                }
            }
        }

        let mut mod_context = context.clone();
        if !allowed_libs.is_empty() {
            mod_context.classpath = build_classpath(&allowed_libs, &client_jar);
        }

        build_launch_arguments(
            &manifest,
            &mod_context,
            min_memory,
            max_memory,
            &jvm_args_list,
            os_name,
            os_arch,
        )
    };

    // 6. Spawn child process
    let mut child = ProcessLauncher::spawn_direct(&java_path, &game_dir, &args)
        .map_err(|e| format!("子進程生成失敗: {}", e))?;

    let pid = child.id().ok_or_else(|| "無法取得子進程 PID".to_string())?;

    // Record running process
    {
        let mut map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        map.insert(
            instance_id.clone(),
            RunningProcessInfo {
                pid,
                instance_id: instance_id.clone(),
                account_id: account_id.clone(),
                account_name: account_name.clone(),
            },
        );
    }

    let _ = app_handle.emit(
        "instance-status",
        InstanceStatusPayload {
            instance_id: instance_id.clone(),
            status: "running".into(),
            exit_code: None,
            pid: Some(pid),
        },
    );

    let _ = app_handle.emit(
        "instance-log",
        InstanceLogPayload {
            instance_id: instance_id.clone(),
            stream: "system".into(),
            line: format!("[Focusite] 遊戲進程已成功啟動，PID: {}", pid),
            timestamp: chrono::Utc::now().timestamp_millis(),
        },
    );

    // 7. Background log stream listener and process wait
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let inst_id_out = instance_id.clone();
    let inst_id_err = instance_id.clone();
    let app_handle_out = app_handle.clone();
    let app_handle_err = app_handle.clone();

    if let Some(out) = stdout {
        tokio::spawn(async move {
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_handle_out.emit(
                    "instance-log",
                    InstanceLogPayload {
                        instance_id: inst_id_out.clone(),
                        stream: "stdout".into(),
                        line,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    },
                );
            }
        });
    }

    if let Some(err) = stderr {
        tokio::spawn(async move {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_handle_err.emit(
                    "instance-log",
                    InstanceLogPayload {
                        instance_id: inst_id_err.clone(),
                        stream: "stderr".into(),
                        line,
                        timestamp: chrono::Utc::now().timestamp_millis(),
                    },
                );
            }
        });
    }

    let app_handle_wait = app_handle.clone();
    let inst_id_wait = instance_id.clone();

    tokio::spawn(async move {
        let status = child.wait().await;
        let exit_code = match status {
            Ok(s) => s.code(),
            Err(_) => Some(-1),
        };

        // Remove from running map
        if let Ok(mut map) = RUNNING_PROCESSES.lock() {
            map.remove(&inst_id_wait);
        }

        let is_crash = exit_code.map(|c| c != 0).unwrap_or(true);

        // When game crashes (exit_code != 0), automatically pop up and focus log window
        if is_crash {
            let _ = ensure_or_create_log_window(&app_handle_wait);
        }

        let _ = app_handle_wait.emit(
            "instance-log",
            InstanceLogPayload {
                instance_id: inst_id_wait.clone(),
                stream: "system".into(),
                line: format!(
                    "[Focusite] 遊戲進程已終止，結束狀態碼 (Exit Code): {:?}",
                    exit_code
                ),
                timestamp: chrono::Utc::now().timestamp_millis(),
            },
        );

        let _ = app_handle_wait.emit(
            "instance-status",
            InstanceStatusPayload {
                instance_id: inst_id_wait,
                status: if is_crash { "crashed".into() } else { "stopped".into() },
                exit_code,
                pid: None,
            },
        );
    });

    Ok(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_running_process_map_lifecycle() {
        {
            let mut map = RUNNING_PROCESSES.lock().unwrap();
            map.insert(
                "test-instance".into(),
                RunningProcessInfo {
                    pid: 12345,
                    instance_id: "test-instance".into(),
                    account_id: Some("acc-001".into()),
                    account_name: Some("TestUser".into()),
                },
            );
            assert_eq!(map.get("test-instance").map(|p| p.pid), Some(12345));
        }

        assert!(has_running_instances());
        assert_eq!(running_instance_count(), 1);

        {
            let mut map = RUNNING_PROCESSES.lock().unwrap();
            map.remove("test-instance");
            assert!(map.get("test-instance").is_none());
        }

        assert!(!has_running_instances());
        assert_eq!(running_instance_count(), 0);
    }
}
