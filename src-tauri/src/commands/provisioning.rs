//! Automated pre-launch provisioning engine: manifests, client jar, libraries, assets, and Mojang JRE.

use super::ui_language::tr;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use focusite_cas::CasManager;
use focusite_core::java::{
    fetch_mojang_runtime_download_list, get_mojang_component_name, get_recommended_java_version,
    resolve_or_locate_java,
};
use focusite_core::manifest::{
    get_current_arch, get_current_os, maven_to_path, AssetIndexFile, VersionManifest,
    VersionManifestV2,
};
use focusite_download::chunked::DownloadTask;
use focusite_download::mirror::{MirrorManager, MirrorProvider};
use focusite_download::Downloader;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncBufReadExt;
use tracing::info;

use super::instance::InstanceDiskConfig;

/// Set of instance IDs currently undergoing provisioning
static PROVISIONING_INSTANCES: LazyLock<Arc<Mutex<HashSet<String>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(HashSet::new())));

/// Checks if an instance is currently undergoing provisioning
pub fn is_instance_provisioning(instance_id: &str) -> bool {
    PROVISIONING_INSTANCES
        .lock()
        .map(|s| s.contains(instance_id))
        .unwrap_or(false)
}

/// Profile directory id of a loader instance: written by `install_meta_loader` (Fabric/Quilt) or by the
/// official installer (Forge/NeoForge; id format unverified against every release line).
pub fn loader_profile_id(cfg: &InstanceDiskConfig) -> Option<String> {
    let ver = cfg.loader_version.as_ref()?;
    match cfg.loader.to_lowercase().as_str() {
        l @ ("fabric" | "quilt" | "forge") => Some(format!("{}-{}-{}", cfg.version, l, ver)),
        // NeoForge for 1.20.1 is a Forge fork and installs a forge-style profile.
        "neoforge" if cfg.version == "1.20.1" => Some(format!("{}-forge-{}", cfg.version, ver)),
        "neoforge" => Some(format!("neoforge-{}", ver)),
        _ => None,
    }
}

fn is_forge_family(cfg: &InstanceDiskConfig) -> bool {
    cfg.loader_version.is_some() && matches!(cfg.loader.to_lowercase().as_str(), "forge" | "neoforge")
}

/// Runs the official Forge/NeoForge installer headlessly so it writes `versions/<id>/<id>.json` and its libraries.
async fn run_forge_installer(
    app: &AppHandle,
    instance_id: &str,
    cfg: &InstanceDiskConfig,
    app_data: &Path,
    java: &Path,
    downloader: &Downloader,
    profile_id: &str,
) -> Result<(), String> {
    let ldr_ver = cfg.loader_version.as_deref().unwrap_or_default();
    let url = focusite_core::installer::forge_installer_url(&cfg.loader, &cfg.version, ldr_ver)
        .map_err(|e| e.to_string())?;
    let installer = app_data.join("installers").join(format!("{}-installer.jar", profile_id));
    emit_progress(app, instance_id, "loader", &tr!("正在下載 {} 安裝程式...", "Downloading the {} installer...", cfg.loader), 0, 0, 0);
    downloader
        .download_file(&url, &installer, None, None, &format!("installer-{}", profile_id))
        .await
        .map_err(|e| format!("E_LOADER_DOWNLOAD_FAILED: {} {}", cfg.loader, e))?;

    // The installer refuses to run without a launcher profile file in the target directory.
    let profiles = app_data.join("launcher_profiles.json");
    if !profiles.is_file() {
        super::atomic_write(&profiles, br#"{"profiles":{},"version":3}"#)
            .map_err(super::ctx("E_LOADER_INSTALL_FAILED"))?;
    }

    // java.exe (not javaw.exe) so the installer's output is captured.
    let java = java.with_file_name(if cfg!(windows) { "java.exe" } else { "java" });
    let flag = if cfg.loader.eq_ignore_ascii_case("neoforge") { "--install-client" } else { "--installClient" };
    let args = vec![
        "-jar".to_string(),
        installer.to_string_lossy().to_string(),
        flag.to_string(),
        app_data.to_string_lossy().to_string(),
    ];
    emit_progress(app, instance_id, "loader", &tr!("正在執行 {} 安裝程式...", "Running the {} installer...", cfg.loader), 0, 0, 0);
    let mut child = focusite_core::process::ProcessLauncher::spawn_direct_with_env(&java, app_data, &args, None)
        .map_err(|e| format!("E_LOADER_INSTALL_FAILED: {} {}", cfg.loader, e))?;
    let pid = child.id();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    fn pipe<R: tokio::io::AsyncRead + Unpin + Send + 'static>(r: R, tx: tokio::sync::mpsc::UnboundedSender<String>) {
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(r).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        });
    }
    if let Some(o) = child.stdout.take() { pipe(o, tx.clone()); }
    if let Some(e) = child.stderr.take() { pipe(e, tx.clone()); }
    drop(tx);

    let mut tail: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    let run = async {
        while let Some(line) = rx.recv().await {
            emit_progress(app, instance_id, "loader", &line, 0, 0, 0);
            if tail.len() >= 20 {
                tail.pop_front();
            }
            tail.push_back(line);
        }
        child.wait().await
    };
    match tokio::time::timeout(Duration::from_secs(15 * 60), run).await {
        Ok(Ok(st)) if st.success() => Ok(()),
        Ok(Ok(st)) => Err(format!("E_LOADER_INSTALL_FAILED: {} {} {}", cfg.loader, st, tail.into_iter().collect::<Vec<_>>().join(" | "))),
        Ok(Err(e)) => Err(format!("E_LOADER_INSTALL_FAILED: {} {}", cfg.loader, e)),
        Err(_) => {
            if let Some(pid) = pid {
                let _ = focusite_core::process::terminate_process_tree(pid).await;
            }
            Err(format!("E_LOADER_INSTALL_TIMEOUT: {}", cfg.loader))
        }
    }
}

struct ProvisioningGuard(String);

impl Drop for ProvisioningGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = PROVISIONING_INSTANCES.lock() {
            s.remove(&self.0);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceProvisionProgressPayload {
    pub instance_id: String,
    pub step: String, // "manifest" | "client_jar" | "libraries" | "assets" | "java" | "done"
    pub message: String,
    pub current: u64,
    pub total: u64,
    pub percentage: f32,
    pub speed_bytes_per_sec: u64,
}

fn emit_progress(
    app: &AppHandle,
    instance_id: &str,
    step: &str,
    message: &str,
    current: u64,
    total: u64,
    speed: u64,
) {
    let percentage = if total > 0 {
        ((current as f64 / total as f64) * 100.0) as f32
    } else {
        0.0
    };
    let _ = app.emit(
        "instance-install-progress",
        InstanceProvisionProgressPayload {
            instance_id: instance_id.to_string(),
            step: step.to_string(),
            message: message.to_string(),
            current,
            total,
            percentage,
            speed_bytes_per_sec: speed,
        },
    );
}

/// Downloads tasks in chunks so the UI receives real progress between chunks.
async fn download_with_progress(
    downloader: &Downloader,
    app: &AppHandle,
    instance_id: &str,
    step: &str,
    label: &str,
    tasks: Vec<DownloadTask>,
) -> Result<(), focusite_download::DownloadError> {
    const CHUNK: usize = 64;
    let total = tasks.len() as u64;
    let started = std::time::Instant::now();
    let mut done: u64 = 0;
    let mut bytes: u64 = 0;
    emit_progress(app, instance_id, step, &format!("{} (0/{})", label, total), 0, total, 0);

    let mut iter = tasks.into_iter().peekable();
    while iter.peek().is_some() {
        let chunk: Vec<DownloadTask> = iter.by_ref().take(CHUNK).collect();
        let n = chunk.len() as u64;
        let chunk_bytes: u64 = chunk.iter().filter_map(|t| t.expected_size).sum();
        downloader.download_batch(chunk, None).await?;
        done += n;
        bytes += chunk_bytes;
        let secs = started.elapsed().as_secs_f64().max(0.001);
        emit_progress(
            app,
            instance_id,
            step,
            &format!("{} ({}/{})", label, done, total),
            done,
            total,
            (bytes as f64 / secs) as u64,
        );
    }
    Ok(())
}

/// Ensures all client requirements exist on disk prior to launch:
/// 1. Version JSON manifest
/// 2. Client .jar file (stored in CAS and linked/copied to versions/{version}/{version}.jar)
/// 3. Filtered OS libraries
/// 4. Natives extraction (excluding META-INF)
/// 5. Asset index and objects
/// 6. Mojang Java Runtime provisioning if not present
pub async fn ensure_instance_provisioned(
    app: &AppHandle,
    instance_id: &str,
    instance_config: &InstanceDiskConfig,
) -> Result<PathBuf, String> {
    {
        let mut s = PROVISIONING_INSTANCES.lock().map_err(|e| e.to_string())?;
        if s.contains(instance_id) {
            return Err("E_ALREADY_INSTALLING".into());
        }
        s.insert(instance_id.to_string());
    }
    let _guard = ProvisioningGuard(instance_id.to_string());
    let app_data = super::get_app_data_dir();
    let versions_dir = app_data.join("versions");
    let libraries_dir = app_data.join("libraries");
    let assets_dir = app_data.join("assets");
    let cas_dir = app_data.join("cas");
    let runtime_dir = app_data.join("runtime");

    let cas = CasManager::new(&cas_dir);

    let mirror_enabled = super::settings::is_bmclapi_mirror_enabled();
    let provider = if mirror_enabled {
        MirrorProvider::Bmclapi
    } else {
        MirrorProvider::Official
    };

    let downloader = Downloader::new_with_provider(
        provider,
        false,
        Duration::from_secs(10),
        Duration::from_secs(15),
        16,
    );

    // ==========================================
    // 1. Version JSON Manifest
    // ==========================================
    emit_progress(app, instance_id, "manifest", &tr!("正在解析遊戲版本設定資訊...", "Reading the game version settings..."), 0, 1, 0);

    let version_id = &instance_config.version;
    let version_folder = versions_dir.join(version_id);
    let version_json_path = version_folder.join(format!("{}.json", version_id));

    let manifest = if version_json_path.is_file() {
        let content = std::fs::read_to_string(&version_json_path)
            .map_err(super::ctx("E_VERSION_FILE_BROKEN"))?;
        serde_json::from_str::<VersionManifest>(&content)
            .map_err(super::ctx("E_VERSION_FILE_BROKEN"))?
    } else {
        // Fetch from Mojang Version Manifest V2
        std::fs::create_dir_all(&version_folder)
            .map_err(super::ctx("E_VERSION_FILE_WRITE_FAILED"))?;

        let manifest_root_url = MirrorManager::rewrite_url(
            "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
            provider,
        );

        let v2 = VersionManifestV2::fetch_remote(&manifest_root_url)
            .await
            .map_err(super::ctx("E_VERSION_LIST_FAILED"))?;

        let entry = v2
            .versions
            .into_iter()
            .find(|v| &v.id == version_id)
            .ok_or_else(|| format!("E_VERSION_NOT_FOUND: {}", version_id))?;

        let detail_url = MirrorManager::rewrite_url(&entry.url, provider);
        let detail = VersionManifest::fetch_remote(&detail_url)
            .await
            .map_err(super::ctx("E_VERSION_LIST_FAILED"))?;

        let serialized = serde_json::to_string_pretty(&detail)
            .map_err(super::ctx("E_VERSION_FILE_WRITE_FAILED"))?;
        // Atomic, so an interrupted write never leaves a half file that blocks every later launch.
        super::atomic_write(&version_json_path, serialized.as_bytes())
            .map_err(super::ctx("E_VERSION_FILE_WRITE_FAILED"))?;

        detail
    };

    // If instance specifies Fabric or Quilt loader, install loader profile & merge manifest
    let mut manifest = if !instance_config.loader.eq_ignore_ascii_case("vanilla") {
        if let Some(ref ldr_ver) = instance_config.loader_version {
            let loader_str = &instance_config.loader;
            if loader_str.eq_ignore_ascii_case("fabric") || loader_str.eq_ignore_ascii_case("quilt") {
                emit_progress(
                    app,
                    instance_id,
                    "manifest",
                    &tr!("正在安裝 {} 模組載入器設定檔...", "Installing the {} loader profile...", loader_str),
                    0,
                    1,
                    0,
                );
                // Reuse the cached merged profile so offline launches keep working.
                let cached = loader_profile_id(instance_config)
                    .map(|pid| versions_dir.join(&pid).join(format!("{}.json", pid)))
                    .filter(|p| p.is_file())
                    .and_then(|p| std::fs::read_to_string(p).ok())
                    .and_then(|s| serde_json::from_str::<VersionManifest>(&s).ok());
                match cached {
                    Some(m) => m,
                    None => focusite_core::installer::install_meta_loader(
                        loader_str,
                        version_id,
                        ldr_ver,
                        &manifest,
                        &versions_dir,
                    )
                    .await
                    .map_err(super::ctx("E_LOADER_INSTALL_FAILED"))?,
                }
            } else {
                manifest
            }
        } else {
            manifest
        }
    } else {
        manifest
    };

    // ==========================================
    // 2. Client .jar File
    // ==========================================
    let client_jar_path = version_folder.join(format!("{}.jar", version_id));
    if !client_jar_path.is_file() {
        if let Some(ref downloads) = manifest.downloads {
            let client_dl = &downloads.client;
            emit_progress(
                app,
                instance_id,
                "client_jar",
                &tr!("正在下載 Minecraft 客戶端核心 (自動 HTTP Range 分塊)...", "Downloading the Minecraft client..."),
                0,
                client_dl.size,
                0,
            );

            // Check CAS
            let in_cas = cas.exists(&client_dl.sha1);
            if in_cas {
                cas.link_to_instance(&client_dl.sha1, &client_jar_path)
                    .map_err(super::ctx("E_CACHE_FAILED"))?;
            } else {
                let temp_jar = std::env::temp_dir().join(format!("fc_client_{}_{}.jar", version_id, instance_id));
                let target_url = MirrorManager::rewrite_url(&client_dl.url, provider);

                downloader
                    .download_file(
                        &target_url,
                        &temp_jar,
                        Some(&client_dl.sha1),
                        None,
                        &format!("client-{}", version_id),
                    )
                    .await
                    .map_err(super::ctx("E_CLIENT_DOWNLOAD_FAILED"))?;

                cas.store_file(&temp_jar, Some(&client_dl.sha1))
                    .map_err(super::ctx("E_CACHE_FAILED"))?;

                cas.link_to_instance(&client_dl.sha1, &client_jar_path)
                    .map_err(super::ctx("E_CACHE_FAILED"))?;

                let _ = tokio::fs::remove_file(&temp_jar).await;
            }
        }
    }

    // Forge/NeoForge: the official installer needs the vanilla jar, so it runs after step 2.
    let mut early_java: Option<PathBuf> = None;
    if is_forge_family(instance_config) {
        if let Some(pid) = loader_profile_id(instance_config) {
            let profile_path = versions_dir.join(&pid).join(format!("{}.json", pid));
            if !profile_path.is_file() {
                let vanilla_major = manifest
                    .java_version
                    .as_ref()
                    .map(|j| j.major_version)
                    .unwrap_or_else(|| get_recommended_java_version(version_id));
                let java = ensure_java(app, instance_id, vanilla_major, instance_config.java_path.as_deref(), &downloader, provider, &runtime_dir).await?;
                run_forge_installer(app, instance_id, instance_config, &app_data, &java, &downloader, &pid).await?;
                early_java = Some(java);
            }
            let content = std::fs::read_to_string(&profile_path)
                .map_err(|e| format!("E_LOADER_NO_PROFILE: {} {}", profile_path.display(), e))?;
            let profile: VersionManifest = serde_json::from_str(&content)
                .map_err(super::ctx("E_VERSION_FILE_BROKEN"))?;
            manifest = if profile.inherits_from.is_some() { profile.merge_parent(&manifest) } else { profile };
        }
    }

    // ==========================================
    // 3. Libraries & Natives
    // ==========================================
    let os_name = get_current_os();
    let os_arch = get_current_arch();
    let allowed_libs = manifest.allowed_libraries(os_name, os_arch);

    let mut lib_tasks = Vec::new();
    let mut native_jars = Vec::new();

    for lib in &allowed_libs {
        // Fabric/Quilt libraries are plain Maven coordinates without a `downloads` block.
        if let Some(url) = lib.maven_download_url() {
            let dest = libraries_dir.join(lib.get_relative_path());
            if !dest.is_file() {
                lib_tasks.push(DownloadTask {
                    url,
                    destination: dest.to_string_lossy().to_string(),
                    expected_sha1: None,
                    expected_size: None,
                });
            }
        }
        if let Some(ref downloads) = lib.downloads {
            if let Some(ref artifact) = downloads.artifact {
                let rel_path = artifact
                    .path
                    .clone()
                    .or_else(|| maven_to_path(&lib.name))
                    .unwrap_or_else(|| format!("{}.jar", lib.name.replace(':', "/")));
                // The manifest may come from a mirror, so its paths are checked before they are joined.
                let dest = super::modpack::safe_rel_target(&libraries_dir, &rel_path)?;

                // An empty url marks a library the Forge/NeoForge installer generates itself.
                if !dest.is_file() && !artifact.url.is_empty() {
                    let dl_url = MirrorManager::rewrite_url(&artifact.url, provider);
                    lib_tasks.push(DownloadTask {
                        url: dl_url,
                        destination: dest.to_string_lossy().to_string(),
                        expected_sha1: Some(artifact.sha1.clone()).filter(|h| !h.is_empty()),
                        expected_size: Some(artifact.size),
                    });
                }
            }

            // Check classifier natives
            if let Some(ref classifiers) = downloads.classifiers {
                let native_key = if os_name == "windows" {
                    if os_arch == "x86" {
                        "natives-windows-32"
                    } else if os_arch == "arm64" {
                        "natives-windows-arm64"
                    } else {
                        "natives-windows"
                    }
                } else if os_name == "osx" {
                    if os_arch == "arm64" {
                        "natives-macos-arm64"
                    } else {
                        "natives-macos"
                    }
                } else {
                    "natives-linux"
                };

                if let Some(native_art) = classifiers.get(native_key) {
                    let rel_path = native_art
                        .path
                        .clone()
                        .unwrap_or_else(|| format!("natives/{}.jar", lib.name.replace(':', "/")));
                    let dest = super::modpack::safe_rel_target(&libraries_dir, &rel_path)?;

                    if !dest.is_file() {
                        let dl_url = MirrorManager::rewrite_url(&native_art.url, provider);
                        lib_tasks.push(DownloadTask {
                            url: dl_url,
                            destination: dest.to_string_lossy().to_string(),
                            expected_sha1: Some(native_art.sha1.clone()),
                            expected_size: Some(native_art.size),
                        });
                    }
                    native_jars.push(dest);
                }
            }
        }
    }

    if !lib_tasks.is_empty() {
        let total_libs = lib_tasks.len() as u64;
        emit_progress(
            app,
            instance_id,
            "libraries",
            &tr!("正在下載核心依賴庫 (共 {} 個項目)...", "Downloading libraries ({} items)...", total_libs),
            0,
            total_libs,
            0,
        );

        download_with_progress(&downloader, app, instance_id, "libraries", &tr!("正在下載核心依賴庫", "Downloading libraries"), lib_tasks)
            .await
            .map_err(super::ctx("E_LIBRARIES_DOWNLOAD_FAILED"))?;
    }

    // Extract natives to instance natives dir
    let inst_dir = super::instance::get_instances_dir().join(instance_id);
    let natives_dir = inst_dir.join("minecraft").join("bin").join("natives");
    if !natives_dir.exists() {
        let _ = std::fs::create_dir_all(&natives_dir);
    }

    for nat_jar in native_jars {
        if nat_jar.is_file() {
            extract_natives_excluding_meta_inf(&nat_jar, &natives_dir)?;
        }
    }

    // ==========================================
    // 4. Asset Index & Objects
    // ==========================================
    if let Some(ref index_ref) = manifest.asset_index {
        let index_dir = assets_dir.join("indexes");
        std::fs::create_dir_all(&index_dir)
            .map_err(super::ctx("E_ASSETS_DOWNLOAD_FAILED"))?;

        let index_file_path = index_dir.join(format!("{}.json", index_ref.id));
        if !index_file_path.is_file() {
            emit_progress(
                app,
                instance_id,
                "assets",
                &tr!("正在取得遊戲資源索引 (Asset Index)...", "Fetching the asset index..."),
                0,
                1,
                0,
            );
            let index_url = MirrorManager::rewrite_url(&index_ref.url, provider);
            downloader
                .download_file(
                    &index_url,
                    &index_file_path,
                    Some(&index_ref.sha1),
                    None,
                    &format!("asset-index-{}", index_ref.id),
                )
                .await
                .map_err(super::ctx("E_ASSETS_DOWNLOAD_FAILED"))?;
        }

        // Parse index objects
        let index_content = std::fs::read_to_string(&index_file_path)
            .map_err(super::ctx("E_ASSETS_DOWNLOAD_FAILED"))?;
        let asset_index_obj = serde_json::from_str::<AssetIndexFile>(&index_content)
            .map_err(|e| {
                let _ = std::fs::remove_file(&index_file_path);
                format!("E_ASSETS_DOWNLOAD_FAILED: {}", e)
            })?;

        let objects_dir = assets_dir.join("objects");
        let mut asset_tasks = Vec::new();

        for obj in asset_index_obj.objects.values() {
            let hash_prefix = if obj.hash.len() >= 2 {
                &obj.hash[0..2]
            } else {
                "00"
            };
            let obj_dest = objects_dir.join(hash_prefix).join(&obj.hash);
            if !obj_dest.is_file() {
                let mojang_res_url = format!(
                    "https://resources.download.minecraft.net/{}/{}",
                    hash_prefix, obj.hash
                );
                let final_url = MirrorManager::rewrite_url(&mojang_res_url, provider);
                asset_tasks.push(DownloadTask {
                    url: final_url,
                    destination: obj_dest.to_string_lossy().to_string(),
                    expected_sha1: Some(obj.hash.clone()),
                    expected_size: Some(obj.size),
                });
            }
        }

        if !asset_tasks.is_empty() {
            let total_assets = asset_tasks.len() as u64;
            emit_progress(
                app,
                instance_id,
                "assets",
                &tr!("正在下載遊戲聲音與貼圖資源 (共 {} 個檔案)...", "Downloading sounds and textures ({} files)...", total_assets),
                0,
                total_assets,
                0,
            );

            download_with_progress(&downloader, app, instance_id, "assets", &tr!("正在下載遊戲資源檔案", "Downloading game assets"), asset_tasks)
                .await
                .map_err(super::ctx("E_ASSETS_DOWNLOAD_FAILED"))?;
        }
    }

    // ==========================================
    // 5. Java Runtime Environment
    // ==========================================
    // The version manifest states the Java it needs; the version-string guess is only a fallback.
    let required_major = manifest
        .java_version
        .as_ref()
        .map(|j| j.major_version)
        .unwrap_or_else(|| get_recommended_java_version(version_id));
    let resolved_java = match early_java {
        Some(p) => p,
        None => {
            ensure_java(app, instance_id, required_major, instance_config.java_path.as_deref(), &downloader, provider, &runtime_dir)
                .await?
        }
    };

    emit_progress(app, instance_id, "done", &tr!("所有依賴資源已全數就緒！", "Everything is ready!"), 100, 100, 0);
    info!("Instance {} provisioning succeeded. Java at {:?}", instance_id, resolved_java);

    Ok(resolved_java)
}

/// Resolves a usable Java, downloading the official Mojang runtime when none is installed.
async fn ensure_java(
    app: &AppHandle,
    instance_id: &str,
    required_major: u32,
    custom: Option<&str>,
    downloader: &Downloader,
    provider: MirrorProvider,
    runtime_dir: &Path,
) -> Result<PathBuf, String> {
    let os_name = get_current_os();
    let os_arch = get_current_arch();
    let resolved_java = match resolve_or_locate_java(required_major, custom) {
        Ok(path) => path,
        Err(_) => {
            // Need to download official Mojang JRE
            let component = get_mojang_component_name(required_major);
            emit_progress(
                app,
                instance_id,
                "java",
                &tr!("正在下載 Mojang 官方 Java {} 執行階段環境 ({})...", "Downloading Mojang's Java {} runtime ({})...", required_major, component),
                0,
                100,
                0,
            );

            let runtime_os = match (os_name, os_arch) {
                ("windows", "x86") => "windows-x86",
                ("windows", "arm64") => "windows-arm64",
                ("windows", _) => "windows-x64",
                ("osx", "arm64") => "mac-os-arm64",
                ("osx", _) => "mac-os",
                ("linux", "x86") => "linux-i386",
                ("linux", _) => "linux",
                _ => return Err(format!("E_JAVA_UNSUPPORTED_PLATFORM: {} {}", os_name, os_arch)),
            };

            let jre_items = fetch_mojang_runtime_download_list(component, runtime_os)
                .await
                .map_err(super::ctx("E_JAVA_DOWNLOAD_FAILED"))?;

            let comp_dir = runtime_dir.join(component);
            let mut jre_tasks = Vec::new();

            for (rel_path, url, sha1, size) in jre_items {
                let dest = super::modpack::safe_rel_target(&comp_dir, &rel_path)?;
                if !dest.is_file() {
                    let target_url = MirrorManager::rewrite_url(&url, provider);
                    jre_tasks.push(DownloadTask {
                        url: target_url,
                        destination: dest.to_string_lossy().to_string(),
                        expected_sha1: sha1,
                        // A known size skips the HEAD probe for the hundreds of small runtime files.
                        expected_size: Some(size),
                    });
                }
            }

            if !jre_tasks.is_empty() {
                download_with_progress(downloader, app, instance_id, "java", &tr!("正在下載 Mojang JRE", "Downloading the Mojang JRE"), jre_tasks)
                    .await
                    .map_err(super::ctx("E_JAVA_DOWNLOAD_FAILED"))?;
            }

            resolve_or_locate_java(required_major, None)
                .map_err(super::ctx("E_JAVA_DOWNLOAD_FAILED"))?
        }
    };

    Ok(resolved_java)
}

/// Safely extracts dynamic link libraries from a native archive into the target folder,
/// strictly excluding META-INF and path traversal entries.
fn extract_natives_excluding_meta_inf(jar_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(jar_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();

        if name.starts_with("META-INF") || name.ends_with('/') || name.contains("..") {
            continue;
        }

        if name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib") {
            let file_name = Path::new(&name)
                .file_name()
                .ok_or_else(|| "E_NATIVES_INVALID".to_string())?;
            let dest_file = target_dir.join(file_name);
            let mut outfile = std::fs::File::create(&dest_file).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_profile_ids() {
        use super::super::instance::new_disk_config;
        let id = |mc: &str, l: &str, v: Option<&str>| {
            loader_profile_id(&new_disk_config("i", "n", mc, l, v.map(String::from)))
        };
        assert_eq!(id("1.20.1", "Forge", Some("47.4.0")).as_deref(), Some("1.20.1-forge-47.4.0"));
        assert_eq!(id("1.21.1", "NeoForge", Some("21.1.172")).as_deref(), Some("neoforge-21.1.172"));
        assert_eq!(id("1.20.1", "NeoForge", Some("47.1.106")).as_deref(), Some("1.20.1-forge-47.1.106"));
        assert_eq!(id("1.21.4", "Fabric", Some("0.16.9")).as_deref(), Some("1.21.4-fabric-0.16.9"));
        assert_eq!(id("1.21.4", "Vanilla", None), None);
        assert_eq!(id("1.21.4", "Forge", None), None);
    }

    #[test]
    fn test_provisioning_guard_lifecycle() {
        assert!(!is_instance_provisioning("test_inst"));
        {
            let mut s = PROVISIONING_INSTANCES.lock().unwrap();
            s.insert("test_inst".into());
        }
        assert!(is_instance_provisioning("test_inst"));
        {
            let _guard = ProvisioningGuard("test_inst".into());
        }
        assert!(!is_instance_provisioning("test_inst"));
    }
}
