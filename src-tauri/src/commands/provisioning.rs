//! Automated pre-launch provisioning engine: manifests, client jar, libraries, assets, and Mojang JRE.

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

/// Profile directory id written by `install_meta_loader` for Fabric/Quilt instances.
pub fn loader_profile_id(cfg: &InstanceDiskConfig) -> Option<String> {
    let ver = cfg.loader_version.as_ref()?;
    let l = cfg.loader.to_lowercase();
    if l == "fabric" || l == "quilt" {
        Some(format!("{}-{}-{}", cfg.version, l, ver))
    } else {
        None
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
            return Err(format!("實例 '{}' 正在執行安裝流程中，請勿重複啟動", instance_id));
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
    emit_progress(app, instance_id, "manifest", "正在解析遊戲版本設定資訊...", 0, 1, 0);

    let version_id = &instance_config.version;
    let version_folder = versions_dir.join(version_id);
    let version_json_path = version_folder.join(format!("{}.json", version_id));

    let manifest = if version_json_path.is_file() {
        let content = std::fs::read_to_string(&version_json_path)
            .map_err(|e| format!("無法讀取本地版本設定檔: {}", e))?;
        serde_json::from_str::<VersionManifest>(&content)
            .map_err(|e| format!("版本設定檔格式損毀: {}", e))?
    } else {
        // Fetch from Mojang Version Manifest V2
        std::fs::create_dir_all(&version_folder)
            .map_err(|e| format!("無法建立版本資料夾: {}", e))?;

        let manifest_root_url = MirrorManager::rewrite_url(
            "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
            provider,
        );

        let v2 = VersionManifestV2::fetch_remote(&manifest_root_url)
            .await
            .map_err(|e| format!("無法取得 Mojang 核心版本清單: {}", e))?;

        let entry = v2
            .versions
            .into_iter()
            .find(|v| &v.id == version_id)
            .ok_or_else(|| format!("在官方版本清單中未找到版本 '{}'", version_id))?;

        let detail_url = MirrorManager::rewrite_url(&entry.url, provider);
        let detail = VersionManifest::fetch_remote(&detail_url)
            .await
            .map_err(|e| format!("無法取得版本詳細設定檔: {}", e))?;

        let serialized = serde_json::to_string_pretty(&detail)
            .map_err(|e| format!("序列化版本設定檔失敗: {}", e))?;
        std::fs::write(&version_json_path, serialized)
            .map_err(|e| format!("無法寫入版本設定檔: {}", e))?;

        detail
    };

    // If instance specifies Fabric or Quilt loader, install loader profile & merge manifest
    let manifest = if !instance_config.loader.eq_ignore_ascii_case("vanilla") {
        if let Some(ref ldr_ver) = instance_config.loader_version {
            let loader_str = &instance_config.loader;
            if loader_str.eq_ignore_ascii_case("fabric") || loader_str.eq_ignore_ascii_case("quilt") {
                emit_progress(
                    app,
                    instance_id,
                    "manifest",
                    &format!("正在安裝 {} 模組載入器設定檔...", loader_str),
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
                    .map_err(|e| format!("安裝模組載入器失敗: {}", e))?,
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
                "正在下載 Minecraft 客戶端核心 (自動 HTTP Range 分塊)...",
                0,
                client_dl.size,
                0,
            );

            // Check CAS
            let in_cas = cas.exists(&client_dl.sha1);
            if in_cas {
                cas.link_to_instance(&client_dl.sha1, &client_jar_path)
                    .map_err(|e| format!("從 CAS 擷取核心失敗: {}", e))?;
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
                    .map_err(|e| format!("下載核心失敗: {}", e))?;

                cas.store_file(&temp_jar, Some(&client_dl.sha1))
                    .map_err(|e| format!("寫入本機快取失敗：{}", e))?;

                cas.link_to_instance(&client_dl.sha1, &client_jar_path)
                    .map_err(|e| format!("匯出核心檔案失敗: {}", e))?;

                let _ = tokio::fs::remove_file(&temp_jar).await;
            }
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
                let dest = libraries_dir.join(&rel_path);

                if !dest.is_file() {
                    let dl_url = MirrorManager::rewrite_url(&artifact.url, provider);
                    lib_tasks.push(DownloadTask {
                        url: dl_url,
                        destination: dest.to_string_lossy().to_string(),
                        expected_sha1: Some(artifact.sha1.clone()),
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
                    let dest = libraries_dir.join(&rel_path);

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
            &format!("正在下載核心依賴庫 (共 {} 個項目)...", total_libs),
            0,
            total_libs,
            0,
        );

        download_with_progress(&downloader, app, instance_id, "libraries", "正在下載核心依賴庫", lib_tasks)
            .await
            .map_err(|e| format!("下載依賴庫失敗: {}", e))?;
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
            .map_err(|e| format!("無法建立 assets/indexes 資料夾: {}", e))?;

        let index_file_path = index_dir.join(format!("{}.json", index_ref.id));
        if !index_file_path.is_file() {
            emit_progress(
                app,
                instance_id,
                "assets",
                "正在取得遊戲資源索引 (Asset Index)...",
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
                .map_err(|e| format!("下載資源索引失敗: {}", e))?;
        }

        // Parse index objects
        let index_content = std::fs::read_to_string(&index_file_path)
            .map_err(|e| format!("無法讀取資源索引檔: {}", e))?;
        let asset_index_obj = serde_json::from_str::<AssetIndexFile>(&index_content)
            .map_err(|e| {
                let _ = std::fs::remove_file(&index_file_path);
                format!("資源索引損毀 (已自動移除以便重試): {}", e)
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
                &format!("正在下載遊戲聲音與貼圖資源 (共 {} 個檔案)...", total_assets),
                0,
                total_assets,
                0,
            );

            download_with_progress(&downloader, app, instance_id, "assets", "正在下載遊戲資源檔案", asset_tasks)
                .await
                .map_err(|e| format!("下載遊戲資源檔案失敗: {}", e))?;
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
    let resolved_java = match resolve_or_locate_java(required_major, instance_config.java_path.as_deref()) {
        Ok(path) => path,
        Err(_) => {
            // Need to download official Mojang JRE
            let component = get_mojang_component_name(required_major);
            emit_progress(
                app,
                instance_id,
                "java",
                &format!("正在下載 Mojang 官方 Java {} 執行階段環境 ({component})...", required_major),
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
                _ => return Err(format!("不支援的系統平台組合以自動下載 Mojang JRE: ({}, {})", os_name, os_arch)),
            };

            let jre_items = fetch_mojang_runtime_download_list(component, runtime_os)
                .await
                .map_err(|e| format!("無法取得 Mojang JRE 下載清單: {}", e))?;

            let comp_dir = runtime_dir.join(component);
            let mut jre_tasks = Vec::new();

            for (rel_path, url, sha1, _) in jre_items {
                let dest = comp_dir.join(&rel_path);
                if !dest.is_file() {
                    let target_url = MirrorManager::rewrite_url(&url, provider);
                    jre_tasks.push(DownloadTask {
                        url: target_url,
                        destination: dest.to_string_lossy().to_string(),
                        expected_sha1: sha1,
                        expected_size: None,
                    });
                }
            }

            if !jre_tasks.is_empty() {
                download_with_progress(&downloader, app, instance_id, "java", "正在下載 Mojang JRE", jre_tasks)
                    .await
                    .map_err(|e| format!("下載 Mojang JRE 失敗: {}", e))?;
            }

            resolve_or_locate_java(required_major, None)
                .map_err(|e| format!("JRE 安裝完成但無法定位可執行檔: {}", e))?
        }
    };

    emit_progress(app, instance_id, "done", "所有依賴資源已全數就緒！", 100, 100, 0);
    info!("Instance {} provisioning succeeded. Java at {:?}", instance_id, resolved_java);

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
                .ok_or_else(|| "無效的原生函式庫檔名".to_string())?;
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
