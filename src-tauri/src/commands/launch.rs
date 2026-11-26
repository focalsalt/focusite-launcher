//! Minecraft process launching, JRE resolution, and stdout/stderr event streaming.

use super::ui_language::tr;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
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

/// The UUID offline-mode servers give a player name (Java's `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)`),
/// so an offline player keeps the same identity, inventory and progress across launches.
fn offline_uuid(name: &str) -> String {
    use md5::{Digest, Md5};
    let hash: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}")).into();
    uuid::Builder::from_md5_bytes(hash).into_uuid().to_string()
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
    .title(tr!("Focusite 即時控制台 — {}", "Focusite Live Console — {}", instance_name))
    .inner_size(1072.0, 603.0)
    .min_inner_size(1072.0, 603.0)
    .decorations(false)
    .resizable(true)
    // Created hidden: index.html ships the main window's boot screen, so LogWindow reveals the window
    // itself once its first frame has painted.
    .visible(false)
    // Dark backdrop so the window is not white before the page has painted.
    .background_color(tauri::window::Color(10, 15, 29, 255));

    // Must match the main window exactly, otherwise WebView2 fails with HRESULT 0x8007139F.
    #[cfg(windows)]
    let builder = builder.additional_browser_args(crate::get_webview2_browser_arguments());

    let win = builder
    .build()
    .map_err(super::ctx("E_CONSOLE_WINDOW_FAILED"))?;

    Ok(win)
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
            .map_err(|e| format!("E_KILL_FAILED: {}: {}", pid, e))?;
        let mut map = RUNNING_PROCESSES.lock().map_err(|e| e.to_string())?;
        map.remove(&instance_id);
        Ok(())
    } else {
        Err("E_NOT_RUNNING".into())
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
        if map.contains_key(&instance_id) {
            return Err("E_ALREADY_RUNNING".into());
        }
    }
    let _launch_guard = {
        let mut s = LAUNCHING.lock().map_err(|e| e.to_string())?;
        if !s.insert(instance_id.clone()) {
            return Err("E_ALREADY_LAUNCHING".into());
        }
        LaunchGuard(instance_id.clone())
    };

    // The refusals above leave the other launch untouched; every failure from here on ends this one.
    let result = start_instance(
        app_handle.clone(),
        instance_id.clone(),
        account_id,
        account_name,
        quick_play_type,
        quick_play_target,
    )
    .await;
    if result.is_err() {
        emit_status(&app_handle, &instance_id, "stopped", None, None);
    }
    result
}

fn emit_status(app_handle: &AppHandle, instance_id: &str, status: &str, exit_code: Option<i32>, pid: Option<u32>) {
    let _ = app_handle.emit(
        "instance-status",
        InstanceStatusPayload {
            instance_id: instance_id.to_string(),
            status: status.into(),
            exit_code,
            pid,
        },
    );
}

/// Copies one output pipe of the game into the console buffer and to the log windows, line by line.
fn forward_output(
    app_handle: AppHandle,
    instance_id: String,
    stream: &'static str,
    pipe: impl tokio::io::AsyncRead + Unpin + Send + 'static,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(pipe).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let payload = InstanceLogPayload {
                instance_id: instance_id.clone(),
                stream: stream.into(),
                line,
                timestamp: chrono::Utc::now().timestamp_millis(),
            };
            append_instance_log(payload.clone());
            let _ = app_handle.emit("instance-log", payload);
        }
    });
}

/// Jar files directly in `dir` whose lowercase name contains `needle`.
fn find_jars(dir: &Path, needle: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            path.is_file() && name.contains(needle) && name.ends_with(".jar")
        })
        .collect()
}

fn jvm_args(config: &InstanceDiskConfig) -> Vec<String> {
    if config.jvm_args.is_empty() {
        super::instance::default_jvm_args()
    } else {
        config.jvm_args.clone()
    }
}

/// Forge older than 1.6 starts through its own jar and the LWJGL jars in `bin`.
fn is_legacy_forge(config: &InstanceDiskConfig) -> bool {
    let caps = VersionCapabilities::from_mc_version(&config.version);
    config.loader.eq_ignore_ascii_case("forge") && caps.mods_tab_mode == ModsTabMode::LegacyDualNav
}

fn legacy_forge_arguments(
    config: &InstanceDiskConfig,
    context: &LaunchContext,
    client_jar: &Path,
    game_dir: &Path,
    versions_dir: &Path,
) -> Vec<String> {
    let _ = std::fs::create_dir_all(game_dir.join("coremods"));
    let _ = std::fs::create_dir_all(game_dir.join("mods"));

    let forge_jar = find_jars(versions_dir, "forge")
        .into_iter()
        .next()
        .unwrap_or_else(|| client_jar.to_path_buf());
    let bin_dir = game_dir.join("bin");
    let lwjgl_jars = find_jars(&bin_dir, "lwjgl");

    let mut legacy_context = context.clone();
    if bin_dir.join("natives").is_dir() {
        legacy_context.natives_directory = bin_dir.join("natives").to_string_lossy().to_string();
    }

    build_legacy_pre16_forge_arguments(
        &forge_jar,
        client_jar,
        &lwjgl_jars,
        &legacy_context,
        config.min_memory_mb,
        config.max_memory_mb,
        &jvm_args(config),
        None,
    )
}

/// Used when no version file exists for the instance.
fn default_manifest(version: &str) -> VersionManifest {
    VersionManifest {
        id: version.to_string(),
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
    }
}

/// A version file that exists but cannot be read is an error: launching with an empty library list would
/// only end in a ClassNotFoundException the user cannot act on.
fn read_manifest(path: &Path) -> Result<VersionManifest, String> {
    let broken = |e: String| format!("E_VERSION_FILE_BROKEN: {}: {}", path.display(), e);
    let content = std::fs::read_to_string(path).map_err(|e| broken(e.to_string()))?;
    serde_json::from_str(&content).map_err(|e| broken(e.to_string()))
}

/// Arguments built from the version manifest of the instance (or of its loader profile).
fn manifest_arguments(
    config: &InstanceDiskConfig,
    context: &LaunchContext,
    client_jar: &Path,
    app_data: &Path,
    libraries_dir: &Path,
    versions_dir: &Path,
) -> Result<Vec<String>, String> {
    let version_file = |id: &str| app_data.join("versions").join(id).join(format!("{}.json", id));
    let manifest_path = super::provisioning::loader_profile_id(config)
        .map(|id| version_file(&id))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| versions_dir.join(format!("{}.json", config.version)));

    let mut manifest = if manifest_path.is_file() {
        read_manifest(&manifest_path)?
    } else {
        default_manifest(&config.version)
    };

    // Resolve inheritsFrom (e.g. Forge / Fabric inheriting from Vanilla Minecraft manifest)
    if let Some(parent_id) = manifest.inherits_from.clone() {
        let parent_path = version_file(&parent_id);
        if parent_path.is_file() {
            manifest = manifest.merge_parent(&read_manifest(&parent_path)?);
        }
    }

    let os_name = focusite_core::manifest::get_current_os();
    let os_arch = focusite_core::manifest::get_current_arch();
    let allowed_libs: Vec<PathBuf> = manifest
        .libraries
        .iter()
        .filter(|lib| lib.is_allowed(os_name, os_arch))
        .map(|lib| libraries_dir.join(lib.get_relative_path()))
        .filter(|path| path.is_file())
        .collect();

    let mut context = context.clone();
    if let Some(ref asset_index) = manifest.asset_index {
        context.assets_index_name = asset_index.id.clone();
    }
    if !allowed_libs.is_empty() {
        context.classpath = build_classpath(&allowed_libs, client_jar);
    }

    Ok(build_launch_arguments(
        &manifest,
        &context,
        config.min_memory_mb,
        config.max_memory_mb,
        &jvm_args(config),
        os_name,
        os_arch,
    ))
}

/// Provisions, spawns and watches the game for an instance that holds the launch guard.
async fn start_instance(
    app_handle: AppHandle,
    instance_id: String,
    account_id: Option<String>,
    account_name: Option<String>,
    quick_play_type: Option<String>,
    quick_play_target: Option<String>,
) -> Result<u32, String> {
    // 2. Read instance configuration
    let base_dir = get_instances_dir().join(&instance_id);
    let mut instance_config: InstanceDiskConfig = super::instance::read_instance_config(&base_dir)?;

    // A custom loader jar replaces the client jar. Everything else (libraries, assets, Java) comes from
    // the Minecraft version the jar declares, so launch as a vanilla instance of that version.
    // The change stays in memory and never reaches disk.
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
                .map_err(|e| format!("E_FOLDER_CREATE_FAILED: {}", e))?;
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
            return Err(format!("E_PREPARE_FAILED: {}", e));
        }
    };

    // 4. Show the detached log window ONLY if show_log_on_launch is true
    if instance_config.show_log_on_launch {
        let _ = ensure_or_create_log_window(&app_handle, &instance_id, &instance_config.name);
    }

    emit_status(&app_handle, &instance_id, "launching", None, None);

    let _ = app_handle.emit(
        "instance-log",
        InstanceLogPayload {
            instance_id: instance_id.clone(),
            stream: "system".into(),
            line: tr!(
                "[Focusite] 正在為實例 '{}' (Minecraft {}) 啟動 Java 進程...",
                "[Focusite] Starting Java for instance '{}' (Minecraft {})...",
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
            line: tr!("[Focusite] 使用 Java：{}", "[Focusite] Using Java: {}", java_path.display()),
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
            .map_err(|e| format!("E_AUTH_FAILED: {}", e))?
    } else {
        match super::auth::ensure_valid_minecraft_token(None).await {
            Ok(creds) => creds,
            Err(_) => {
                if let Some(ref name) = account_name {
                    (name.clone(), offline_uuid(name), "0".into(), "legacy".into())
                } else {
                    return Err("E_NOT_SIGNED_IN".to_string());
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
        library_directory: libraries_dir.to_string_lossy().to_string(),
        window_size: match (instance_config.window_width, instance_config.window_height) {
            (Some(w), Some(h)) if w > 0 && h > 0 => Some((w, h)),
            _ => None,
        },
    };

    let args = if is_legacy_forge(&instance_config) {
        legacy_forge_arguments(&instance_config, &context, &client_jar, &game_dir, &versions_dir)
    } else {
        manifest_arguments(&instance_config, &context, &client_jar, &app_data, &libraries_dir, &versions_dir)?
    };

    // 6. Spawn child process
    let mut child = ProcessLauncher::spawn_direct_with_env(
        &java_path,
        &game_dir,
        &args,
        instance_config.environment_vars.as_ref(),
    )
    .map_err(|e| format!("E_SPAWN_FAILED: {}", e))?;

    let pid = child.id().ok_or_else(|| "E_SPAWN_NO_PID".to_string())?;

    // Only a game that actually started counts as played.
    let played_at = chrono::Utc::now().timestamp_millis();
    let _ = super::instance::update_instance_config(&base_dir, |c| c.last_played_at = Some(played_at));

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

    emit_status(&app_handle, &instance_id, "running", None, Some(pid));

    let sys_log = InstanceLogPayload {
        instance_id: instance_id.clone(),
        stream: "system".into(),
        line: tr!("[Focusite] 遊戲進程已成功啟動，PID: {}", "[Focusite] The game started, PID: {}", pid),
        timestamp: chrono::Utc::now().timestamp_millis(),
    };
    append_instance_log(sys_log.clone());
    let _ = app_handle.emit("instance-log", sys_log);

    if instance_config.show_log_on_launch {
        let _ = ensure_or_create_log_window(&app_handle, &instance_id, &instance_config.name);
    }

    // 7. Background log stream listener and process wait
    if let Some(out) = child.stdout.take() {
        forward_output(app_handle.clone(), instance_id.clone(), "stdout", out);
    }
    if let Some(err) = child.stderr.take() {
        forward_output(app_handle.clone(), instance_id.clone(), "stderr", err);
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
                Some(code) => tr!("[Focusite] 遊戲進程已終止，結束狀態碼：{}", "[Focusite] The game exited with code {}", code),
                None => tr!("[Focusite] 遊戲進程已終止（無結束狀態碼）", "[Focusite] The game exited without an exit code"),
            },
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        append_instance_log(term_log.clone());
        let _ = app_handle_wait.emit("instance-log", term_log);

        emit_status(&app_handle_wait, &inst_id_wait, if is_crash { "crashed" } else { "stopped" }, exit_code, None);
    });

    Ok(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_jars_matches_name_and_extension() {
        let dir = std::env::temp_dir().join(format!("focusite-find-jars-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("lwjgl-folder.jar")).unwrap();
        for name in ["LWJGL-util.jar", "lwjgl.txt", "other.jar"] {
            std::fs::write(dir.join(name), b"").unwrap();
        }
        assert_eq!(find_jars(&dir, "lwjgl"), vec![dir.join("LWJGL-util.jar")]);
        assert!(find_jars(&dir.join("missing"), "lwjgl").is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn offline_uuid_is_stable_name_based_v3() {
        let a = offline_uuid("Steve");
        assert_eq!(a, offline_uuid("Steve"));
        assert_ne!(a, offline_uuid("Alex"));
        assert_eq!(uuid::Uuid::parse_str(&a).unwrap().get_version_num(), 3);
    }

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
