//! Modpack import commands supporting .mrpack (Modrinth) and .zip (CurseForge) formats.

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::io::Read;
use std::path::{Path, PathBuf};
use focusite_cas::CasManager;
use focusite_modpacks::curseforge::{
    read_curseforge_manifest, rescan_missing_mods as cf_rescan, unpack_curseforge_overrides, MissingModItem,
};
use focusite_modpacks::mrpack::{read_mrpack_index, unpack_mrpack};
use super::instance::{
    get_instances_dir, new_disk_config, unique_folder_name, validate_safe_filename, validate_safe_id,
    write_instance_config, InstanceDiskConfig,
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
#[serde(rename_all = "camelCase")]
struct CurseForgeFileData {
    file_name: String,
    download_url: Option<String>,
    #[serde(default)]
    file_length: u64,
    #[serde(default)]
    hashes: Vec<CurseForgeFileHash>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFileHash {
    value: String,
    /// 1 = SHA-1, 2 = MD5.
    algo: u32,
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
    let archive_bytes = tokio::fs::read(&path)
        .await
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

    let url = format!(
        "{}/project/{}/version",
        focusite_modpacks::workshop::MODRINTH_API_BASE,
        project_id
    );
    let versions: Vec<ModrinthPackVersion> = super::http()
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

/// Claims a new, uniquely named instance folder (with `minecraft/mods`) for an imported pack.
fn create_pack_instance_dir(name: &str) -> Result<(String, PathBuf), String> {
    let base = get_instances_dir();
    let instance_id = unique_folder_name(&base, name)?;
    let inst_dir = base.join(&instance_id);
    // `create_dir` (not `_all`) fails if another import claimed the same name a moment ago.
    std::fs::create_dir(&inst_dir).map_err(super::ctx("無法建立實例目錄"))?;
    std::fs::create_dir_all(inst_dir.join("minecraft").join("mods")).map_err(super::ctx("無法建立實例目錄"))?;
    Ok((instance_id, inst_dir))
}

/// Copies the pack's own icon (or a Prism icon) to `icon.png` and records its source in `cfg`.
fn set_pack_icon(archive_bytes: &[u8], inst_dir: &Path, cfg: &mut InstanceDiskConfig) {
    const MAX_ICON_BYTES: u64 = 8 * 1024 * 1024;
    let mut found: Option<(Vec<u8>, &str)> = None;
    if let Ok(mut zip) = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)) {
        for icon_name in ["icon.png", "logo.png", "modpack.png", "cover.png"] {
            let Ok(file) = zip.by_name(icon_name) else { continue };
            let mut buf = Vec::new();
            if file.take(MAX_ICON_BYTES).read_to_end(&mut buf).is_ok() {
                found = Some((buf, "modpack"));
                break;
            }
        }
    }
    if found.is_none() {
        if let Ok((_, Some(icon))) = focusite_modpacks::prism::extract_prism_metadata(archive_bytes) {
            found = Some((icon, "prism"));
        }
    }
    if let Some((bytes, source)) = found {
        if std::fs::write(inst_dir.join("icon.png"), bytes).is_ok() {
            cfg.icon_source = Some(source.into());
            cfg.icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
        }
    }
}

/// Runs the download jobs four at a time. Returns the missing-mod entry of every job that failed, so the
/// import can finish and the user can fetch those files by hand.
async fn run_pack_jobs<F>(jobs: Vec<(MissingModItem, F)>) -> Result<Vec<MissingModItem>, String>
where
    F: Future<Output = Result<(), String>> + Send + 'static,
{
    let limit = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
    let mut set = tokio::task::JoinSet::new();
    for (missing, job) in jobs {
        let limit = limit.clone();
        set.spawn(async move {
            let _permit = limit.acquire_owned().await;
            (missing, job.await)
        });
    }
    let mut missing_mods = Vec::new();
    while let Some(done) = set.join_next().await {
        let (missing, res) = done.map_err(|e| e.to_string())?;
        if let Err(reason) = res {
            tracing::warn!("模組包檔案 {} 下載失敗：{}", missing.name, reason);
            missing_mods.push(missing);
        }
    }
    Ok(missing_mods)
}

/// Runs `fill` for a freshly created pack instance and deletes the folder when it fails,
/// so a failed import never leaves a half-made instance behind.
async fn finish_pack_import(
    inst_dir: &Path,
    fill: impl Future<Output = Result<ModpackImportResult, String>>,
) -> Result<ModpackImportResult, String> {
    let outcome = fill.await;
    if outcome.is_err() {
        let _ = std::fs::remove_dir_all(inst_dir);
    }
    outcome
}

fn cas() -> CasManager {
    CasManager::new(super::get_app_data_dir().join("cas"))
}

async fn import_mrpack_internal(
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let index = read_mrpack_index(archive_bytes).map_err(|e| format!("解析 .mrpack 失敗: {}", e))?;

    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_else(|| "1.21.4".into());

    let (loader, loader_version) = [
        ("fabric-loader", "Fabric"),
        ("neoforge", "NeoForge"),
        ("forge", "Forge"),
        ("quilt-loader", "Quilt"),
    ]
    .iter()
    .find_map(|(key, name)| index.dependencies.get(*key).map(|v| (name.to_string(), Some(v.clone()))))
    .unwrap_or_else(|| ("Vanilla".to_string(), None));

    let name = custom_name.unwrap_or_else(|| index.name.clone());
    // A pack never lands in an existing instance: the folder name is made unique.
    let (instance_id, inst_dir) = create_pack_instance_dir(&name)?;
    let mc_dir = inst_dir.join("minecraft");

    finish_pack_import(&inst_dir, async {
        unpack_mrpack(archive_bytes, &mc_dir).map_err(|e| format!("解壓 .mrpack 失敗: {}", e))?;

        let mut cfg = new_disk_config(&instance_id, &name, &mc_version, &loader, loader_version);
        cfg.description = index.summary.clone();
        set_pack_icon(archive_bytes, &inst_dir, &mut cfg);
        write_instance_config(&inst_dir, &cfg)?;

        // Files are checked (allowlisted host, size, SHA-1) and deduplicated through the CAS.
        let cas = cas();
        let http = super::http().clone();
        let mut jobs = Vec::new();
        for file in index.files {
            if file.env.as_ref().and_then(|e| e.client.as_deref()) == Some("unsupported") || file.downloads.is_empty() {
                continue;
            }

            let rel_path = file.path.replace('\\', "/");
            if rel_path.starts_with('/') || rel_path.contains("..") || rel_path.contains(':') {
                return Err(format!("偵測到非法 mrpack 檔案路徑: {}", file.path));
            }
            let target = mc_dir.join(&rel_path);
            if !target.starts_with(&mc_dir) {
                return Err(format!("檔案路徑逃逸出實例目錄: {}", file.path));
            }
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if target.exists() {
                continue;
            }

            let url = file.downloads[0].clone();
            let file_name = rel_path.rsplit('/').next().unwrap_or(&rel_path).to_string();
            let missing = MissingModItem {
                project_id: 0,
                file_id: 0,
                name: file_name.clone(),
                file_name,
                // Only links the allowlist accepts are offered for opening in the browser.
                web_url: if super::workshop::validate_download_url(&url).is_ok() { url.clone() } else { String::new() },
                rel_path,
            };
            let (http, cas, sha1, size) = (http.clone(), cas.clone(), file.hashes.get("sha1").cloned(), file.file_size);
            jobs.push((missing, async move { fetch_pack_file(&http, &cas, &url, sha1.as_deref(), size, &target).await }));
        }

        let missing_mods = run_pack_jobs(jobs).await?;
        Ok(ModpackImportResult {
            instance_id: instance_id.clone(),
            instance_name: name.clone(),
            version: mc_version.clone(),
            loader: loader.clone(),
            is_completed: missing_mods.is_empty(),
            missing_mods,
        })
    })
    .await
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

/// Resolves one CurseForge file through the API, then downloads it with the same checks as .mrpack files.
async fn fetch_curseforge_file(
    http: &reqwest::Client,
    cas: &CasManager,
    api_key: &str,
    project_id: u32,
    file_id: u32,
    mods_dir: &Path,
) -> Result<(), String> {
    let api_url = format!("https://api.curseforge.com/v1/mods/{}/files/{}", project_id, file_id);
    let info: CurseForgeFileResponse = http
        .get(&api_url)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(super::ctx("無法連線至 CurseForge"))?
        .error_for_status()
        .map_err(super::ctx("CurseForge 回應錯誤"))?
        .json()
        .await
        .map_err(super::ctx("CurseForge 資料格式錯誤"))?;
    let file_name = Path::new(&info.data.file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    validate_safe_filename(file_name)?;
    let url = info.data.download_url.as_deref().ok_or("作者未開放第三方下載")?;
    let sha1 = info.data.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.as_str());
    fetch_pack_file(http, cas, url, sha1, info.data.file_length, &mods_dir.join(file_name)).await
}

/// Maps a CurseForge loader id such as `forge-47.2.0` to our loader name and version.
fn curseforge_loader(id: &str) -> (String, Option<String>) {
    let lower = id.to_lowercase();
    for (prefix, name) in [("neoforge-", "NeoForge"), ("forge-", "Forge"), ("fabric-", "Fabric"), ("quilt-", "Quilt")] {
        if lower.starts_with(prefix) {
            return (name.to_string(), Some(id[prefix.len()..].to_string()));
        }
    }
    ("Vanilla".to_string(), None)
}

async fn import_curseforge_internal(
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let (manifest, modlist_map) =
        read_curseforge_manifest(archive_bytes).map_err(|e| format!("解析 CurseForge 模組包失敗: {}", e))?;

    let mc_version = manifest.minecraft.version.clone();
    let (loader, loader_version) = manifest
        .minecraft
        .mod_loaders
        .iter()
        .find(|l| l.primary)
        .or_else(|| manifest.minecraft.mod_loaders.first())
        .map(|l| curseforge_loader(&l.id))
        .unwrap_or_else(|| ("Vanilla".to_string(), None));

    let name = custom_name.unwrap_or_else(|| manifest.name.clone());
    let (instance_id, inst_dir) = create_pack_instance_dir(&name)?;
    let mc_dir = inst_dir.join("minecraft");
    let mods_dir = mc_dir.join("mods");

    finish_pack_import(&inst_dir, async {
        unpack_curseforge_overrides(archive_bytes, &manifest, &mc_dir)
            .map_err(|e| format!("解壓 CurseForge 模組包失敗: {}", e))?;

        let mut cfg = new_disk_config(&instance_id, &name, &mc_version, &loader, loader_version);
        cfg.description = Some(format!("由 CurseForge 模組包「{}」導入", manifest.name));
        set_pack_icon(archive_bytes, &inst_dir, &mut cfg);
        write_instance_config(&inst_dir, &cfg)?;

        let api_key = load_settings_from_disk().curseforge_api_key;
        let (cas, http) = (cas(), super::http().clone());
        let mut missing_mods = Vec::new();
        let mut jobs = Vec::new();
        for file_ref in &manifest.files {
            let (matched_name, web_url) = modlist_map
                .iter()
                .find(|(url, _)| {
                    url.contains(&format!("/{}", file_ref.project_id))
                        || url.contains(&format!("projects/{}", file_ref.project_id))
                })
                .map(|(url, name)| (name.clone(), url.clone()))
                .unwrap_or_else(|| {
                    (
                        format!("Mod #{}", file_ref.project_id),
                        format!("https://www.curseforge.com/projects/{}", file_ref.project_id),
                    )
                });
            let safe_mod_name = matched_name.replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_");
            let missing = MissingModItem {
                project_id: file_ref.project_id,
                file_id: file_ref.file_id,
                name: matched_name,
                file_name: format!("{}-{}.jar", safe_mod_name.replace(' ', "-"), file_ref.file_id),
                web_url,
                rel_path: String::new(),
            };
            // Without an API key nothing can be resolved: every mod is listed for manual download.
            let Some(key) = api_key.clone() else {
                missing_mods.push(missing);
                continue;
            };
            let (http, cas, mods_dir) = (http.clone(), cas.clone(), mods_dir.clone());
            let (project_id, file_id) = (file_ref.project_id, file_ref.file_id);
            jobs.push((missing, async move {
                fetch_curseforge_file(&http, &cas, &key, project_id, file_id, &mods_dir).await
            }));
        }
        missing_mods.extend(run_pack_jobs(jobs).await?);

        Ok(ModpackImportResult {
            instance_id: instance_id.clone(),
            instance_name: name.clone(),
            version: mc_version.clone(),
            loader: loader.clone(),
            is_completed: missing_mods.is_empty(),
            missing_mods,
        })
    })
    .await
}

#[tauri::command]
pub async fn rescan_instance_missing_mods(
    instance_id: String,
    missing_mods: Vec<MissingModItem>,
) -> Result<Vec<MissingModItem>, String> {
    validate_safe_id(&instance_id)?;
    tokio::task::spawn_blocking(move || {
        let mc_dir = get_instances_dir().join(&instance_id).join("minecraft");
        let remaining = cf_rescan(&mc_dir, &missing_mods);

        // Ingest all present mods into CAS for global deduplication
        let cas = cas();
        if let Ok(entries) = std::fs::read_dir(mc_dir.join("mods")) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = cas.store_file(&path, None);
                }
            }
        }
        remaining
    })
    .await
    .map_err(|e| format!("背景工作執行失敗：{}", e))
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

    #[test]
    fn curseforge_loader_ids_map_to_loader_and_version() {
        assert_eq!(curseforge_loader("forge-47.2.0"), ("Forge".into(), Some("47.2.0".into())));
        assert_eq!(curseforge_loader("neoforge-21.1.5"), ("NeoForge".into(), Some("21.1.5".into())));
        assert_eq!(curseforge_loader("fabric-0.15.7"), ("Fabric".into(), Some("0.15.7".into())));
        assert_eq!(curseforge_loader("unknown"), ("Vanilla".into(), None));
    }
}
