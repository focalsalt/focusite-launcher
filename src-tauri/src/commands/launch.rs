//! Minecraft process launching, JRE resolution, and stdout/stderr event streaming.

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::PathBuf;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use focusite_core::args::{
    build_classpath, build_launch_arguments, build_legacy_pre16_forge_arguments, LaunchContext,
    QuickPlayTarget,
};
use focusite_core::instance::{ModsTabMode, VersionCapabilities};
use focusite_core::java::{scan_system_javas, JavaInstallation};
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

type RunningProcessMap = Arc<Mutex<HashMap<String, RunningProcessInfo>>>;
type InstanceLogBufferMap = Arc<Mutex<HashMap<String, VecDeque<InstanceLogPayload>>>>;

static RUNNING_PROCESSES: LazyLock<RunningProcessMap> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Instances between "Play was pressed" and "process registered", so a second press is refused.
static LAUNCHING: LazyLock<Mutex<std::collections::HashSet<String>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

struct LaunchGuard(String);

impl Drop for LaunchGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = LAUNCHING.lock() {
            s.remove(&self.0);
        }
    }
}

pub fn is_instance_launching(instance_id: &str) -> bool {
    LAUNCHING.lock().map(|s| s.contains(instance_id)).unwrap_or(false)
}

/// Ring buffer storing up to 10,000 log events per instance.
static LOG_BUFFERS: LazyLock<InstanceLogBufferMap> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

pub fn append_instance_log(payload: InstanceLogPayload) {
    if let Ok(mut buffers) = LOG_BUFFERS.lock() {
        let deque = buffers
            .entry(payload.instance_id.clone())
            .or_insert_with(VecDeque::new);
        if deque.len() >= 10000 {
            deque.pop_front();
        }
        deque.push_back(payload);
    }
}

/// Drops the buffered console output of an instance.
pub fn clear_instance_log(instance_id: &str) {
    if let Ok(mut buffers) = LOG_BUFFERS.lock() {
        buffers.remove(instance_id);
    }
}

/// Checks if a specific instance is currently running.
pub fn is_instance_running(instance_id: &str) -> bool {
    RUNNING_PROCESSES
        .lock()
        .map(|m| m.contains_key(instance_id))
        .unwrap_or(false)
}

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

pub fn get_instance_log_window_label(instance_id: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(instance_id.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    format!("log-window-{}", &hash[..12])
}

/// Dynamically creates or reveals the detached per-instance log window when needed (game launch, crash, or manual open).
pub fn ensure_or_create_log_window(
    app: &AppHandle,
    instance_id: &str,
    instance_name: &str,
) -> Result<tauri::WebviewWindow, String> {
    let win_label = get_instance_log_window_label(instance_id);
    if let Some(existing) = app.get_webview_window(&win_label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(existing);
    }

    let encoded_id =
        url::form_urlencoded::byte_serialize(instance_id.as_bytes()).collect::<String>();
    let url_str = format!("index.html#/log-window?instanceId={}", encoded_id);

    let builder = tauri::WebviewWindowBuilder::new(
        app,
        &win_label,
        tauri::WebviewUrl::App(url_str.into()),
    )
    .title(format!("Focusite 即時控制台 — {}", instance_name))
    .inner_size(860.0, 540.0)
    .min_inner_size(600.0, 380.0)
    .decorations(false)
    .resizable(true);

    // Must match the main window exactly, otherwise WebView2 fails with HRESULT 0x8007139F.
    #[cfg(windows)]
    let builder = builder.additional_browser_args(crate::get_webview2_browser_arguments());

    let win = builder
    .build()
    .map_err(super::ctx("無法開啟控制台視窗"))?;

    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    Ok(win)
}

/// Grants the asset protocol read access to one user-chosen image file.
#[tauri::command]
pub fn allow_asset_image(app_handle: AppHandle, path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp"))
        .unwrap_or(false);
    if !ext_ok || !p.is_file() {
        return Err("僅允許既有的圖片檔案 (png/jpg/webp)".into());
    }
    app_handle
        .asset_protocol_scope()
        .allow_file(p)
        .map_err(super::ctx("無法開啟控制台視窗"))
}

#[tauri::command]
pub fn get_instance_log_buffer(instance_id: String) -> Result<Vec<InstanceLogPayload>, String> {
    validate_safe_id(&instance_id)?;
    if let Ok(buffers) = LOG_BUFFERS.lock() {
        if let Some(deque) = buffers.get(&instance_id) {
            return Ok(deque.iter().cloned().collect());
        }
    }
    Ok(Vec::new())
}

#[tauri::command]
pub async fn open_instance_log_window(app_handle: AppHandle, instance_id: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let base_dir = get_instances_dir().join(&instance_id);
    let name = if let Ok(cfg) = super::instance::read_instance_config(&base_dir) {
        cfg.name
    } else {
        instance_id.clone()
    };
    ensure_or_create_log_window(&app_handle, &instance_id, &name)?;
    Ok(())
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
            .map_err(|e| format!("無法終止遊戲進程（PID {}）：{}", pid, e))?;
        let mut map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        map.remove(&instance_id);
        Ok(())
    } else {
        Err(format!("實例 '{}' 目前未在運行", instance_id))
    }
}

#[tauri::command]
pub async fn launch_instance(
    app_handle: AppHandle,
    instance_id: String,
    account_id: Option<String>,
    account_name: Option<String>,
    quick_play_type: Option<String>,
    quick_play_target: Option<String>,
) -> Result<u32, String> {
    validate_safe_id(&instance_id)?;

    // 1. Single instance mutex check:同一實例不可重複啟動
    {
        let map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = map.get(&instance_id) {
            let _ = existing;
            return Err(format!("實例 '{}' 已在運行中，無法重複啟動", instance_id));
        }
    }
    let _launch_guard = {
        let mut s = LAUNCHING.lock().map_err(|e| e.to_string())?;
        if !s.insert(instance_id.clone()) {
            return Err(format!("實例 '{}' 正在啟動中，請稍候", instance_id));
        }
        LaunchGuard(instance_id.clone())
    };

    // 2. Read instance configuration
    let base_dir = get_instances_dir().join(&instance_id);
    let mut instance_config: InstanceDiskConfig = super::instance::read_instance_config(&base_dir)?;

    // Update last_played_at timestamp
    let played_at = chrono::Utc::now().timestamp_millis();
    instance_config.last_played_at = Some(played_at);
    let _ = super::instance::update_instance_config(&base_dir, |c| c.last_played_at = Some(played_at));

    // A custom loader jar replaces the client jar. Everything else (libraries, assets, Java) comes from
    // the Minecraft version the jar declares, so launch as a vanilla instance of that version.
    // The change is made after the config was saved, so it never reaches disk.
    let mut custom_client_jar: Option<PathBuf> = None;
    if instance_config.loader.eq_ignore_ascii_case("custom") {
        let (jar, mc_version) = super::instance::resolve_custom_jar(&base_dir, &instance_config)?;
        custom_client_jar = Some(jar);
        instance_config.version = mc_version;
        instance_config.loader = "Vanilla".into();
        instance_config.loader_version = None;
    }

    let game_dir = base_dir.join("minecraft");
    if !game_dir.exists() {
        let legacy_dir = base_dir.join(".minecraft");
        if legacy_dir.is_dir() {
            let _ = std::fs::rename(&legacy_dir, &game_dir);
        } else {
            std::fs::create_dir_all(&game_dir)
                .map_err(|e| format!("無法建立 minecraft 資料夾：{}", e))?;
        }
    }

    // Start each launch with a fresh console buffer.
    clear_instance_log(&instance_id);

    // 3. Ensure all instance assets, libraries, client core, and Java runtime are provisioned
    let java_path = match super::provisioning::ensure_instance_provisioned(
        &app_handle,
        &instance_id,
        &instance_config,
    )
    .await
    {
        Ok(p) => p,
        Err(e) => {
            // Terminal event so the install modal can close.
            let _ = app_handle.emit(
                "instance-install-progress",
                super::provisioning::InstanceProvisionProgressPayload {
                    instance_id: instance_id.clone(),
                    step: "error".into(),
                    message: e.clone(),
                    current: 0,
                    total: 0,
                    percentage: 0.0,
                    speed_bytes_per_sec: 0,
                },
            );
            let _ = app_handle.emit(
                "instance-status",
                InstanceStatusPayload {
                    instance_id: instance_id.clone(),
                    status: "stopped".into(),
                    exit_code: None,
                    pid: None,
                },
            );
            return Err(format!("準備遊戲檔案失敗：{}", e));
        }
    };

    // 4. Show the detached log window ONLY if show_log_on_launch is true
    if instance_config.show_log_on_launch {
        let _ = ensure_or_create_log_window(&app_handle, &instance_id, &instance_config.name);
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
            line: format!("[Focusite] 使用 Java：{}", java_path.display()),
            timestamp: chrono::Utc::now().timestamp_millis(),
        },
    );

    // 5. Construct Launch Arguments
    // Shared global directories in %APPDATA%/focusite_launcher/
    let app_data = super::get_app_data_dir();
    let assets_dir = app_data.join("assets");
    let libraries_dir = app_data.join("libraries");
    // Must match the directory provisioning extracts natives into.
    let natives_dir = game_dir.join("bin").join("natives");
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

    let client_jar = if let Some(jar) = custom_client_jar {
        jar
    } else if versions_dir.join(format!("{}.jar", instance_config.version)).is_file() {
        versions_dir.join(format!("{}.jar", instance_config.version))
    } else {
        game_dir
            .join("bin")
            .join(format!("{}.jar", instance_config.version))
    };

    let (auth_player, auth_uuid_val, auth_token, auth_user_type) = if let Some(ref acc_id) = account_id {
        super::auth::ensure_valid_minecraft_token(Some(acc_id))
            .await
            .map_err(|e| format!("微軟正版帳號驗證失敗: {}", e))?
    } else {
        match super::auth::ensure_valid_minecraft_token(None).await {
            Ok(creds) => creds,
            Err(_) => {
                if let Some(ref name) = account_name {
                    (name.clone(), uuid::Uuid::new_v4().to_string(), "0".into(), "legacy".into())
                } else {
                    return Err("尚未登入微軟帳號，也未指定離線玩家名稱".to_string());
                }
            }
        }
    };

    let quick_play = match (quick_play_type.as_deref(), quick_play_target) {
        (Some("singleplayer"), Some(world)) => Some(QuickPlayTarget::Singleplayer(world)),
        (Some("multiplayer"), Some(server)) => Some(QuickPlayTarget::Multiplayer(server)),
        _ => None,
    };

    let context = LaunchContext {
        auth_player_name: auth_player,
        version_name: instance_config.version.clone(),
        game_directory: game_dir.to_string_lossy().to_string(),
        assets_root: assets_dir.to_string_lossy().to_string(),
        assets_index_name: instance_config.version.clone(),
        auth_uuid: auth_uuid_val,
        auth_access_token: auth_token,
        user_type: auth_user_type,
        version_type: "release".into(),
        classpath: client_jar.to_string_lossy().to_string(),
        natives_directory: natives_dir.to_string_lossy().to_string(),
        launcher_name: "Focusite".into(),
        launcher_version: env!("CARGO_PKG_VERSION").into(),
        tweak_class: None,
        quick_play,
        custom_jvm_args: instance_config.custom_jvm_args.clone().unwrap_or_default(),
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
        let manifest_path = super::provisioning::loader_profile_id(&instance_config)
            .map(|pid| {
                app_data
                    .join("versions")
                    .join(&pid)
                    .join(format!("{}.json", pid))
            })
            .filter(|p| p.is_file())
            .unwrap_or_else(|| versions_dir.join(format!("{}.json", instance_config.version)));
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
    if let Some(ref asset_idx) = manifest.asset_index {
        mod_context.assets_index_name = asset_idx.id.clone();
    }
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
    let mut child = ProcessLauncher::spawn_direct_with_env(
        &java_path,
        &game_dir,
        &args,
        instance_config.environment_vars.as_ref(),
    )
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

    let sys_log = InstanceLogPayload {
        instance_id: instance_id.clone(),
        stream: "system".into(),
        line: format!("[Focusite] 遊戲進程已成功啟動，PID: {}", pid),
        timestamp: chrono::Utc::now().timestamp_millis(),
    };
    append_instance_log(sys_log.clone());
    let _ = app_handle.emit("instance-log", sys_log);

    if instance_config.show_log_on_launch {
        let _ = ensure_or_create_log_window(&app_handle, &instance_id, &instance_config.name);
    }

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
                let payload = InstanceLogPayload {
                    instance_id: inst_id_out.clone(),
                    stream: "stdout".into(),
                    line,
                    timestamp: chrono::Utc::now().timestamp_millis(),
                };
                append_instance_log(payload.clone());
                let _ = app_handle_out.emit("instance-log", payload);
            }
        });
    }

    if let Some(err) = stderr {
        tokio::spawn(async move {
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let payload = InstanceLogPayload {
                    instance_id: inst_id_err.clone(),
                    stream: "stderr".into(),
                    line,
                    timestamp: chrono::Utc::now().timestamp_millis(),
                };
                append_instance_log(payload.clone());
                let _ = app_handle_err.emit("instance-log", payload);
            }
        });
    }

    let app_handle_wait = app_handle.clone();
    let inst_id_wait = instance_id.clone();
    let inst_name_wait = instance_config.name.clone();
    let inst_dir_wait = base_dir.clone();
    let started_at = std::time::Instant::now();

    tokio::spawn(async move {
        let status = child.wait().await;

        // Accumulate the session length into the instance's total play time.
        let session_ms = started_at.elapsed().as_millis() as u64;
        let _ = tokio::task::spawn_blocking(move || {
            let _ = super::instance::update_instance_config(&inst_dir_wait, |cfg| {
                cfg.total_play_time_ms = cfg.total_play_time_ms.saturating_add(session_ms);
            });
        })
        .await;
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
            let _ = ensure_or_create_log_window(&app_handle_wait, &inst_id_wait, &inst_name_wait);
        }

        let term_log = InstanceLogPayload {
            instance_id: inst_id_wait.clone(),
            stream: "system".into(),
            line: match exit_code {
                Some(code) => format!("[Focusite] 遊戲進程已終止，結束狀態碼：{}", code),
                None => "[Focusite] 遊戲進程已終止（無結束狀態碼）".to_string(),
            },
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        append_instance_log(term_log.clone());
        let _ = app_handle_wait.emit("instance-log", term_log);

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
            let mut map = RUNNING_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
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
            let mut map = RUNNING_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
            map.remove("test-instance");
            assert!(map.get("test-instance").is_none());
        }

        assert!(!has_running_instances());
        assert_eq!(running_instance_count(), 0);
    }
}
