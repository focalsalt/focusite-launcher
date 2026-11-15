//! Modpack import commands supporting .mrpack (Modrinth) and .zip (CurseForge) formats.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use focusite_cas::CasManager;
use focusite_modpacks::curseforge::{
    rescan_missing_mods as cf_rescan, unpack_curseforge_pack, MissingModItem,
};
use focusite_modpacks::mrpack::unpack_mrpack;
use super::instance::{
    default_jvm_args, default_max_memory, default_min_memory, get_instances_dir, unique_folder_name,
    validate_safe_filename, validate_safe_id, write_instance_config, InstanceDiskConfig,
};
use super::settings::load_settings_from_disk;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackImportResult {
    pub instance_id: String,
    pub instance_name: String,
    pub version: String,
    pub loader: String,
    pub missing_mods: Vec<MissingModItem>,
    pub is_completed: bool,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFileResponse {
    data: CurseForgeFileData,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFileData {
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "downloadUrl")]
    download_url: Option<String>,
}

#[tauri::command]
pub async fn import_modpack(
    pack_path: String,
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let path = PathBuf::from(&pack_path);
    // A folder is another launcher's instance (Prism / PCL): copy it instead of unpacking an archive.
    if path.is_dir() {
        return super::launcher_import::import_instance_dir(path, custom_name).await;
    }
    if !path.is_file() {
        return Err(format!("模組包檔案不存在: {}", pack_path));
    }

    // The whole archive is held in memory, so refuse absurdly large files up front.
    const MAX_PACK_BYTES: u64 = 1024 * 1024 * 1024;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size > MAX_PACK_BYTES {
        return Err("模組包檔案過大（上限 1 GiB）".into());
    }
    let archive_bytes = std::fs::read(&path)
        .map_err(|e| format!("無法讀取模組包檔案: {}", e))?;

    let is_mrpack = path
        .extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("mrpack"))
        .unwrap_or(false);

    if is_mrpack {
        import_mrpack_internal(&archive_bytes, custom_name).await
    } else {
        import_curseforge_internal(&archive_bytes, custom_name).await
    }
}

#[derive(Deserialize)]
struct ModrinthFile {
    url: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    hashes: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
struct ModrinthPackVersion {
    #[serde(default)]
    id: String,
    #[serde(default)]
    version_type: String,
    #[serde(default)]
    files: Vec<ModrinthFile>,
}

/// Downloads the newest `.mrpack` of a Modrinth modpack project and imports it as an instance.
#[tauri::command]
pub async fn import_modrinth_modpack(
    project_id: String,
    custom_name: Option<String>,
    version_id: Option<String>,
) -> Result<ModpackImportResult, String> {
    if project_id.is_empty() || !project_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("無效的模組包專案 ID".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Focusite-Launcher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(super::ctx("無法建立網路連線"))?;

    let url = format!(
        "{}/project/{}/version",
        focusite_modpacks::workshop::MODRINTH_API_BASE,
        project_id
    );
    let versions: Vec<ModrinthPackVersion> = client
        .get(&url)
        .send()
        .await
        .map_err(super::ctx("無法連線至 Modrinth"))?
        .error_for_status()
        .map_err(super::ctx("Modrinth 回應錯誤"))?
        .json()
        .await
        .map_err(super::ctx("Modrinth 資料格式錯誤"))?;

    // The API lists newest first: prefer the newest release, otherwise the newest of any type.
    let has_pack = |v: &&ModrinthPackVersion| v.files.iter().any(|f| f.filename.ends_with(".mrpack"));
    let chosen = match version_id.as_deref().filter(|v| !v.is_empty()) {
        // The id is matched against this project's own version list, so it cannot point elsewhere.
        Some(vid) => versions.iter().filter(has_pack).find(|v| v.id == vid),
        None => versions
            .iter()
            .filter(has_pack)
            .find(|v| v.version_type == "release")
            .or_else(|| versions.iter().find(has_pack)),
    }
    .ok_or_else(|| "此模組包沒有可下載的 .mrpack 版本".to_string())?;
    let file = chosen
        .files
        .iter()
        .find(|f| f.primary && f.filename.ends_with(".mrpack"))
        .or_else(|| chosen.files.iter().find(|f| f.filename.ends_with(".mrpack")))
        .ok_or_else(|| "此模組包沒有可下載的 .mrpack 檔案".to_string())?;

    super::workshop::validate_download_url(&file.url)?;

    let temp = std::env::temp_dir().join(format!("fc_modpack_{}.mrpack", uuid::Uuid::new_v4()));
    let downloader = focusite_download::Downloader::default();
    downloader
        .download_file(
            &file.url,
            &temp,
            file.hashes.get("sha1").map(String::as_str),
            None,
            "modrinth-modpack",
        )
        .await
        .map_err(super::ctx("下載模組包失敗"))?;

    let bytes = tokio::fs::read(&temp).await;
    let _ = tokio::fs::remove_file(&temp).await;
    let bytes = bytes.map_err(super::ctx("無法讀取已下載的模組包"))?;

    import_mrpack_internal(&bytes, custom_name).await
}

async fn import_mrpack_internal(
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let temp_dir = std::env::temp_dir().join(format!("focusite_mrpack_unpack_{}", uuid::Uuid::new_v4()));
    let temp_mc = temp_dir.join("minecraft");
    std::fs::create_dir_all(&temp_mc).map_err(super::ctx("無法建立暫存資料夾"))?;

    let (index, _) = unpack_mrpack(archive_bytes, &temp_mc)
        .map_err(|e| format!("解壓 .mrpack 失敗: {}", e))?;

    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_else(|| "1.21.4".into());

    let (loader, loader_version) = if let Some(ver) = index.dependencies.get("fabric-loader") {
        ("Fabric".to_string(), Some(ver.clone()))
    } else if let Some(ver) = index.dependencies.get("neoforge") {
        ("NeoForge".to_string(), Some(ver.clone()))
    } else if let Some(ver) = index.dependencies.get("forge") {
        ("Forge".to_string(), Some(ver.clone()))
    } else if let Some(ver) = index.dependencies.get("quilt-loader") {
        ("Quilt".to_string(), Some(ver.clone()))
    } else {
        ("Vanilla".to_string(), None)
    };

    let name = custom_name.unwrap_or_else(|| index.name.clone());
    // A pack never lands in an existing instance: the folder name is made unique.
    let instance_id = unique_folder_name(&get_instances_dir(), &name)?;

    let inst_dir = get_instances_dir().join(&instance_id);
    let mc_dir = inst_dir.join("minecraft");
    std::fs::create_dir_all(&mc_dir)
        .map_err(|e| format!("無法建立實例目錄: {}", e))?;

    let outcome: Result<ModpackImportResult, String> = async {
    let _ = std::fs::remove_dir_all(&temp_dir);
    unpack_mrpack(archive_bytes, &mc_dir).map_err(|e| format!("解壓 .mrpack 失敗: {}", e))?;

    // Extract modpack or Prism icon if present
    let mut icon_source = None;
    let mut icon_updated_at = None;
    if let Ok(mut zip) = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)) {
        for icon_name in &["icon.png", "logo.png", "modpack.png", "cover.png"] {
            if let Ok(mut file) = zip.by_name(icon_name) {
                let icon_target = inst_dir.join("icon.png");
                if let Ok(mut out) = std::fs::File::create(&icon_target) {
                    if std::io::copy(&mut file, &mut out).is_ok() {
                        icon_source = Some("modpack".into());
                        icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
                        break;
                    }
                }
            }
        }
    }

    if icon_source.is_none() {
        if let Ok((_, Some(prism_icon))) = focusite_modpacks::prism::extract_prism_metadata(archive_bytes) {
            let icon_target = inst_dir.join("icon.png");
            if std::fs::write(&icon_target, prism_icon).is_ok() {
                icon_source = Some("prism".into());
                icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
            }
        }
    }

    // Write the instance config
    let disk_cfg = InstanceDiskConfig {
        id: instance_id.clone(),
        name: name.clone(),
        version: mc_version.clone(),
        loader: loader.clone(),
        loader_version,
        description: index.summary,
        is_favorite: false,
        icon_source,
        icon_updated_at,
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        show_log_on_launch: false,
        min_memory_mb: default_min_memory(),
        max_memory_mb: default_max_memory(),
        java_path: None,
        jvm_args: default_jvm_args(),
        group: None,
        custom_jvm_args: None,
        environment_vars: None,
        total_play_time_ms: 0,
    };
    write_instance_config(&inst_dir, &disk_cfg)?;

    // Download mrpack files with CAS deduplication and path traversal validation
    let cas_dir = super::get_app_data_dir().join("cas");
    let cas = CasManager::new(&cas_dir);

    // No total time limit: big files on slow links must finish. A stalled connection still fails.
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let mut missing_mods: Vec<MissingModItem> = Vec::new();
    let mut jobs = Vec::new();
    for file in index.files {
        if let Some(ref env) = file.env {
            if env.client.as_deref() == Some("unsupported") {
                continue;
            }
        }
        if file.downloads.is_empty() {
            continue;
        }

        let rel_path_str = file.path.replace('\\', "/");
        if rel_path_str.starts_with('/') || rel_path_str.contains("..") || rel_path_str.contains(':') {
            return Err(format!("偵測到非法 mrpack 檔案路徑: {}", file.path));
        }

        let target_path = mc_dir.join(&rel_path_str);
        if !target_path.starts_with(&mc_dir) {
            return Err(format!("檔案路徑逃逸出實例目錄: {}", file.path));
        }

        if let Some(parent) = target_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if target_path.exists() {
            continue;
        }
        jobs.push((
            file.path,
            rel_path_str,
            file.downloads[0].clone(),
            file.hashes.get("sha1").cloned(),
            file.file_size,
            target_path,
        ));
    }

    // Four downloads at a time; results are collected in the order they finish.
    let limit = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
    let mut set = tokio::task::JoinSet::new();
    for (path, rel, url, sha1, size, target) in jobs {
        let (http, cas, limit) = (http.clone(), cas.clone(), limit.clone());
        set.spawn(async move {
            let _permit = limit.acquire_owned().await;
            let res = fetch_pack_file(&http, &cas, &url, sha1.as_deref(), size, &target).await;
            (path, rel, url, res)
        });
    }
    while let Some(done) = set.join_next().await {
        let (path, rel_path_str, url, res) = done.map_err(|e| e.to_string())?;
        if let Err(reason) = res {
            // The import goes on; the file is listed so the user can fetch it by hand.
            tracing::warn!("模組包檔案 {} 下載失敗：{}", path, reason);
            let file_name = rel_path_str.rsplit('/').next().unwrap_or(&rel_path_str).to_string();
            missing_mods.push(MissingModItem {
                project_id: 0,
                file_id: 0,
                name: file_name.clone(),
                file_name,
                // Only links the allowlist accepts are offered for opening in the browser.
                web_url: if super::workshop::validate_download_url(&url).is_ok() { url } else { String::new() },
                rel_path: rel_path_str,
            });
        }
    }

    let is_completed = missing_mods.is_empty();
    Ok(ModpackImportResult {
        instance_id: instance_id.clone(),
        instance_name: name,
        version: mc_version,
        loader,
        missing_mods,
        is_completed,
    })
    }
    .await;

    if outcome.is_err() {
        let _ = std::fs::remove_dir_all(&inst_dir);
    }
    outcome
}

/// Size limit for a pack file whose index entry does not state one.
const MAX_PACK_FILE_BYTES: u64 = 512 * 1024 * 1024;

/// Downloads one modpack file: allowlisted host, successful HTTP status and a SHA-1 that must match.
async fn fetch_pack_file(
    http: &reqwest::Client,
    cas: &CasManager,
    url: &str,
    sha1: Option<&str>,
    expected_size: u64,
    target: &Path,
) -> Result<(), String> {
    super::workshop::validate_download_url(url)?;
    let sha1 = sha1.ok_or("缺少 SHA-1 雜湊，無法驗證檔案")?;
    // The pack index states each file's size; a larger body is refused (0 = not stated).
    let max = if expected_size > 0 { expected_size } else { MAX_PACK_FILE_BYTES };
    let mut resp = http
        .get(url)
        .send()
        .await
        .map_err(super::ctx("連線失敗"))?
        .error_for_status()
        .map_err(super::ctx("伺服器回應錯誤"))?;
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(super::ctx("下載中斷"))? {
        if (bytes.len() + chunk.len()) as u64 > max {
            return Err("檔案大小超出模組包宣告的大小".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let hash = cas.store_bytes(&bytes, Some(sha1)).map_err(super::ctx("雜湊驗證或快取寫入失敗"))?;
    cas.link_to_instance(&hash, target).map_err(super::ctx("無法放入實例"))?;
    Ok(())
}

async fn import_curseforge_internal(
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let temp_dir = std::env::temp_dir().join(format!("focusite_cf_unpack_{}", uuid::Uuid::new_v4()));
    let temp_mc = temp_dir.join("minecraft");
    std::fs::create_dir_all(&temp_mc).map_err(super::ctx("無法建立暫存資料夾"))?;

    let (manifest, modlist_map, _) = unpack_curseforge_pack(archive_bytes, &temp_mc)
        .map_err(|e| format!("解壓 CurseForge 模組包失敗: {}", e))?;
    let _ = std::fs::remove_dir_all(&temp_dir);

    let mc_version = manifest.minecraft.version.clone();
    let (loader, loader_version) = if let Some(primary) = manifest
        .minecraft
        .mod_loaders
        .iter()
        .find(|l| l.primary)
        .or_else(|| manifest.minecraft.mod_loaders.first())
    {
        let id_lower = primary.id.to_lowercase();
        if id_lower.starts_with("forge-") {
            ("Forge".to_string(), Some(primary.id.replace("forge-", "")))
        } else if id_lower.starts_with("neoforge-") {
            ("NeoForge".to_string(), Some(primary.id.replace("neoforge-", "")))
        } else if id_lower.starts_with("fabric-") {
            ("Fabric".to_string(), Some(primary.id.replace("fabric-", "")))
        } else if id_lower.starts_with("quilt-") {
            ("Quilt".to_string(), Some(primary.id.replace("quilt-", "")))
        } else {
            ("Vanilla".to_string(), None)
        }
    } else {
        ("Vanilla".to_string(), None)
    };

    let name = custom_name.unwrap_or_else(|| manifest.name.clone());
    let instance_id = unique_folder_name(&get_instances_dir(), &name)?;

    let inst_dir = get_instances_dir().join(&instance_id);
    let mc_dir = inst_dir.join("minecraft");
    let mods_dir = mc_dir.join("mods");
    std::fs::create_dir_all(&mods_dir)
        .map_err(|e| format!("無法建立實例 mods 目錄: {}", e))?;
    let outcome: Result<ModpackImportResult, String> = async {

    // Unpack overrides into instance
    unpack_curseforge_pack(archive_bytes, &mc_dir).map_err(|e| format!("解壓 CurseForge 模組包失敗: {}", e))?;

    // Extract modpack or Prism icon if present
    let mut icon_source = None;
    let mut icon_updated_at = None;
    if let Ok(mut zip) = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)) {
        for icon_name in &["icon.png", "logo.png", "modpack.png", "cover.png"] {
            if let Ok(mut file) = zip.by_name(icon_name) {
                let icon_target = inst_dir.join("icon.png");
                if let Ok(mut out) = std::fs::File::create(&icon_target) {
                    if std::io::copy(&mut file, &mut out).is_ok() {
                        icon_source = Some("modpack".into());
                        icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
                        break;
                    }
                }
            }
        }
    }

    if icon_source.is_none() {
        if let Ok((_, Some(prism_icon))) = focusite_modpacks::prism::extract_prism_metadata(archive_bytes) {
            let icon_target = inst_dir.join("icon.png");
            if std::fs::write(&icon_target, prism_icon).is_ok() {
                icon_source = Some("prism".into());
                icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
            }
        }
    }

    // Write the instance config
    let disk_cfg = InstanceDiskConfig {
        id: instance_id.clone(),
        name: name.clone(),
        version: mc_version.clone(),
        loader: loader.clone(),
        loader_version,
        description: Some(format!("由 CurseForge 模組包「{}」導入", manifest.name)),
        is_favorite: false,
        icon_source,
        icon_updated_at,
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        show_log_on_launch: false,
        min_memory_mb: default_min_memory(),
        max_memory_mb: default_max_memory(),
        java_path: None,
        jvm_args: default_jvm_args(),
        group: None,
        custom_jvm_args: None,
        environment_vars: None,
        total_play_time_ms: 0,
    };
    write_instance_config(&inst_dir, &disk_cfg)?;

    let cas_dir = super::get_app_data_dir().join("cas");
    let cas = CasManager::new(&cas_dir);

    // Resolve mods with CurseForge API or build MissingModItem list
    let settings = load_settings_from_disk();
    let api_key = settings.curseforge_api_key.as_deref();

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut missing_mods: Vec<MissingModItem> = Vec::new();

    for file_ref in manifest.files {
        let mut downloaded = false;

        if let Some(key) = api_key {
            let api_url = format!(
                "https://api.curseforge.com/v1/mods/{}/files/{}",
                file_ref.project_id, file_ref.file_id
            );
            if let Ok(resp) = http.get(&api_url).header("x-api-key", key).send().await {
                if let Ok(file_info) = resp.json::<CurseForgeFileResponse>().await {
                    let raw_fname = Path::new(&file_info.data.file_name)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("mod.jar");

                    if validate_safe_filename(raw_fname).is_ok() {
                        if let Some(dl_url) = file_info.data.download_url {
                            let target_file = mods_dir.join(raw_fname);
                            if let Ok(dl_resp) = http.get(&dl_url).send().await {
                                if let Ok(bytes) = dl_resp.bytes().await {
                                    if let Ok(cas_hash) = cas.store_bytes(&bytes, None) {
                                        if cas.link_to_instance(&cas_hash, &target_file).is_ok() {
                                            downloaded = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if !downloaded {
            let (matched_name, web_url) = if let Some((url, name)) = modlist_map
                .iter()
                .find(|(url, _)| {
                    url.contains(&format!("/{}", file_ref.project_id))
                        || url.contains(&format!("projects/{}", file_ref.project_id))
                }) {
                    (name.clone(), url.clone())
                } else {
                    (
                        format!("Mod #{}", file_ref.project_id),
                        format!("https://www.curseforge.com/projects/{}", file_ref.project_id),
                    )
                };

            let safe_mod_name = matched_name.replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_");
            missing_mods.push(MissingModItem {
                project_id: file_ref.project_id,
                file_id: file_ref.file_id,
                name: matched_name,
                file_name: format!("{}-{}.jar", safe_mod_name.replace(' ', "-"), file_ref.file_id),
                web_url,
                rel_path: String::new(),
            });
        }
    }

    let is_completed = missing_mods.is_empty();

    Ok(ModpackImportResult {
        instance_id: instance_id.clone(),
        instance_name: name,
        version: mc_version,
        loader,
        missing_mods,
        is_completed,
    })
    }
    .await;

    // A failed import must not leave a half-made instance behind.
    if outcome.is_err() {
        let _ = std::fs::remove_dir_all(&inst_dir);
    }
    outcome
}

#[tauri::command]
pub fn rescan_instance_missing_mods(
    instance_id: String,
    missing_mods: Vec<MissingModItem>,
) -> Result<Vec<MissingModItem>, String> {
    validate_safe_id(&instance_id)?;
    let mc_dir = get_instances_dir().join(&instance_id).join("minecraft");
    let remaining = cf_rescan(&mc_dir, &missing_mods);

    // Ingest all present mods into CAS for global deduplication
    let mods_dir = mc_dir.join("mods");
    if mods_dir.is_dir() {
        let cas_dir = super::get_app_data_dir().join("cas");
        let cas = CasManager::new(&cas_dir);
        if let Ok(entries) = std::fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = cas.store_file(&path, None);
                }
            }
        }
    }

    Ok(remaining)
}

#[tauri::command]
pub fn open_external_urls(urls: Vec<String>) -> Result<(), String> {
    for url in urls {
        let trimmed = url.trim();
        if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
            return Err(format!("只能開啟 HTTP 或 HTTPS 連結：{}", trimmed));
        }

        #[cfg(windows)]
        let spawned = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .spawn();
        #[cfg(not(windows))]
        let spawned = std::process::Command::new("xdg-open").arg(trimmed).spawn();
        spawned.map_err(|e| format!("無法開啟連結 {}：{}", trimmed, e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn pack_file_from_untrusted_host_or_without_hash_is_not_fetched() {
        let dir = std::env::temp_dir().join(format!("fc_fetch_{}", uuid::Uuid::new_v4()));
        let cas = CasManager::new(dir.join("cas"));
        let http = reqwest::Client::new();
        let target = dir.join("mods").join("a.jar");

        // Neither case reaches the network: the host check and the hash check come first.
        let evil = run(fetch_pack_file(&http, &cas, "http://127.0.0.1/a.jar", Some("0".repeat(40).as_str()), 0, &target));
        assert!(evil.is_err());
        let no_hash = run(fetch_pack_file(&http, &cas, "https://cdn.modrinth.com/a.jar", None, 0, &target));
        assert!(no_hash.unwrap_err().contains("SHA-1"));
        assert!(!target.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
