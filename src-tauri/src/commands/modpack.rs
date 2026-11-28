//! Modpack import commands supporting .mrpack (Modrinth), .zip (CurseForge), Focusite export archives and
//! other launchers' instance folders.

use super::ui_language::tr;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use focusite_cas::CasManager;
use focusite_modpacks::curseforge::{
    read_curseforge_manifest, rescan_missing_mods as cf_rescan, unpack_curseforge_overrides_with, MissingModItem,
};
use focusite_modpacks::mrpack::{archive_unpacked_size, read_mrpack_index, unpack_mrpack_with};
use focusite_modpacks::ModpackError;
use tauri::AppHandle;
use super::import_support::{
    ensure_free_space, is_retryable, retry_delay, JobSession, CANCELLED_MESSAGE, IMPORT_PROGRESS_EVENT, MAX_RETRIES,
};
use super::instance::{
    get_instances_dir, new_instance_config, unique_folder_name, validate_safe_filename, validate_safe_id,
    write_instance_config, InstanceDiskConfig,
};
use super::settings::load_settings_from_disk;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackImportResult {
    pub instance_id: String,
    pub instance_name: String,
    pub version: String,
    pub loader: String,
    pub missing_mods: Vec<MissingModItem>,
    pub is_completed: bool,
    /// What was carried over besides the files (e.g. `jvm`, `memory`, `icon`, `background`).
    #[serde(default)]
    pub imported: Vec<String>,
}

/// What a pack or instance folder contains, shown before the import starts.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackInspection {
    /// `mrpack`, `curseforge`, `focusite`, `folder` or `unknown`.
    pub format: String,
    pub name: String,
    pub version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub file_count: usize,
    /// Estimated disk space the import needs, in bytes.
    pub size_bytes: u64,
    /// The pack needs the CurseForge API key to download its mods, and none is set.
    pub missing_curseforge_key: bool,
    /// Folder the instance would be created in (its name can differ from `name`).
    pub folder_name: String,
    pub imported: Vec<String>,
    /// The file is above `MAX_PACK_BYTES`: it was not opened, and importing it needs the user's confirmation.
    pub large: bool,
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

/// The whole archive is held in memory, so a bigger file is only imported after the user confirmed it.
const MAX_PACK_BYTES: u64 = 1024 * 1024 * 1024;
/// Nothing above this is imported, confirmed or not.
const HARD_MAX_PACK_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub(super) const PENDING_FILE: &str = "focusite-pending-downloads.json";

fn trimmed_name(custom_name: Option<String>) -> Option<String> {
    custom_name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty())
}

fn is_mrpack_path(path: &Path) -> bool {
    path.extension().map(|e| e.to_string_lossy().eq_ignore_ascii_case("mrpack")).unwrap_or(false)
}

fn archive_has(bytes: &[u8], name: &str) -> bool {
    zip::ZipArchive::new(std::io::Cursor::new(bytes)).map(|mut z| z.by_name(name).is_ok()).unwrap_or(false)
}

/// Reads a local pack file, refusing missing and oversized ones. With a session the read reports byte progress
/// and stops when the user cancels.
async fn read_pack_file(path: &Path, session: Option<&JobSession>, allow_large: bool) -> Result<Vec<u8>, String> {
    use tokio::io::AsyncReadExt;

    if !path.is_file() {
        return Err(format!("E_PACK_NOT_FOUND: {}", path.display()));
    }
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size > HARD_MAX_PACK_BYTES {
        return Err("E_PACK_TOO_LARGE".into());
    }
    if size > MAX_PACK_BYTES && !allow_large {
        return Err("E_PACK_NEEDS_CONFIRM".into());
    }
    let read_err = |e: std::io::Error| format!("E_PACK_UNREADABLE: {}", e);
    let mut file = tokio::fs::File::open(path).await.map_err(read_err)?;
    let mut bytes = Vec::with_capacity(size as usize);
    let mut buf = vec![0u8; 1024 * 1024];
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let started = std::time::Instant::now();
    loop {
        let n = file.read(&mut buf).await.map_err(read_err)?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        if let Some(s) = session {
            s.check()?;
            let speed = (bytes.len() as f64 / started.elapsed().as_secs_f64().max(0.001)) as u64;
            s.emit_full("read", &name, bytes.len() as u64, size, speed, None);
        }
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn import_modpack(
    app: AppHandle,
    pack_path: String,
    custom_name: Option<String>,
    import_id: Option<String>,
    allow_large: Option<bool>,
) -> Result<ModpackImportResult, String> {
    let session = JobSession::for_app(app, IMPORT_PROGRESS_EVENT, import_id);
    let path = PathBuf::from(&pack_path);
    // A folder is another launcher's instance (Prism / PCL / Focusite): copy it instead of unpacking an archive.
    if path.is_dir() {
        return super::launcher_import::import_instance_dir(&session, path, custom_name).await;
    }
    let archive_bytes = read_pack_file(&path, Some(&session), allow_large == Some(true)).await?;

    if archive_has(&archive_bytes, super::instance::INSTANCE_CONFIG_FILE) {
        super::instance_transfer::import_focusite_zip(&session, &archive_bytes, custom_name).await
    } else if is_mrpack_path(&path) {
        import_mrpack_internal(&session, &archive_bytes, custom_name).await
    } else {
        import_curseforge_internal(&session, &archive_bytes, custom_name).await
    }
}

/// Describes a pack file or instance folder without importing it.
#[tauri::command]
pub async fn inspect_modpack_file(pack_path: String, custom_name: Option<String>) -> Result<PackInspection, String> {
    let path = PathBuf::from(&pack_path);
    if path.is_dir() {
        return super::blocking(move || super::launcher_import::inspect_dir(&path, trimmed_name(custom_name))).await;
    }
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if size > MAX_PACK_BYTES && size <= HARD_MAX_PACK_BYTES {
        // Not opened: reading it all just to describe it would cost as much memory as the import itself.
        let name = path.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let name = trimmed_name(custom_name).unwrap_or(name);
        return Ok(PackInspection {
            format: "unknown".into(),
            folder_name: unique_folder_name(&get_instances_dir(), &name)?,
            name,
            size_bytes: size,
            large: true,
            ..Default::default()
        });
    }
    let bytes = read_pack_file(&path, None, false).await?;
    let is_mrpack = is_mrpack_path(&path);
    super::blocking(move || inspect_archive(&bytes, is_mrpack, trimmed_name(custom_name))).await
}

fn inspect_archive(bytes: &[u8], is_mrpack: bool, custom_name: Option<String>) -> Result<PackInspection, String> {
    let folder_for = |name: &str| unique_folder_name(&get_instances_dir(), name);
    if archive_has(bytes, super::instance::INSTANCE_CONFIG_FILE) {
        return super::instance_transfer::inspect_focusite_zip(bytes, custom_name);
    }
    let unpacked = archive_unpacked_size(bytes).map_err(super::ctx("E_PACK_UNREADABLE"))?;
    if is_mrpack {
        let index = read_mrpack_index(bytes).map_err(super::ctx("E_PACK_PARSE_FAILED"))?;
        let version = index.dependencies.get("minecraft").cloned().ok_or("E_PACK_NO_MC_VERSION")?;
        let (loader, loader_version) = mrpack_loader(&index.dependencies);
        let name = custom_name.unwrap_or_else(|| index.name.clone());
        let download: u64 = index.files.iter().map(|f| f.file_size).sum();
        let mut imported = vec!["overrides".to_string()];
        if archive_has(bytes, "icon.png") || archive_has(bytes, "overrides/icon.png") {
            imported.push("icon".into());
        }
        return Ok(PackInspection {
            format: "mrpack".into(),
            folder_name: folder_for(&name)?,
            name,
            version,
            loader,
            loader_version,
            file_count: index.files.len(),
            size_bytes: unpacked.saturating_add(download),
            imported,
            ..Default::default()
        });
    }
    let (manifest, _) = read_curseforge_manifest(bytes).map_err(super::ctx("E_PACK_PARSE_FAILED"))?;
    let (loader, loader_version) = curseforge_loader_of(&manifest);
    let name = custom_name.unwrap_or_else(|| manifest.name.clone());
    let mut imported = vec!["overrides".to_string()];
    if manifest.minecraft.recommended_ram.is_some() {
        imported.push("memory".into());
    }
    Ok(PackInspection {
        format: "curseforge".into(),
        folder_name: folder_for(&name)?,
        name,
        version: manifest.minecraft.version.clone(),
        loader,
        loader_version,
        file_count: manifest.files.len(),
        // File sizes are only known through the API; assume a mod averages 4 MiB.
        size_bytes: unpacked.saturating_add(manifest.files.len() as u64 * 4 * 1024 * 1024),
        missing_curseforge_key: load_settings_from_disk().curseforge_api_key.is_none(),
        imported,
        ..Default::default()
    })
}

#[derive(Deserialize)]
struct ModrinthFile {
    url: String,
    #[serde(default)]
    filename: String,
    #[serde(default)]
    primary: bool,
    #[serde(default)]
    size: u64,
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

/// Downloads the chosen `.mrpack` of a Modrinth modpack project and imports it as an instance.
#[tauri::command]
pub async fn import_modrinth_modpack(
    app: AppHandle,
    project_id: String,
    custom_name: Option<String>,
    version_id: Option<String>,
    import_id: Option<String>,
) -> Result<ModpackImportResult, String> {
    let session = JobSession::for_app(app, IMPORT_PROGRESS_EVENT, import_id);
    if project_id.is_empty() || !project_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("E_PACK_INVALID_PROJECT".into());
    }

    session.emit("download", "", 0, 0);
    let url = format!(
        "{}/project/{}/version",
        focusite_modpacks::workshop::MODRINTH_API_BASE,
        project_id
    );
    let versions: Vec<ModrinthPackVersion> = super::http()
        .get(&url)
        .send()
        .await
        .map_err(super::ctx("E_CONNECTION"))?
        .error_for_status()
        .map_err(super::ctx("E_SERVER_RESPONSE"))?
        .json()
        .await
        .map_err(super::ctx("E_BAD_RESPONSE"))?;
    session.check()?;

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
    .ok_or_else(|| "E_PACK_NO_MRPACK".to_string())?;
    let file = chosen
        .files
        .iter()
        .find(|f| f.primary && f.filename.ends_with(".mrpack"))
        .or_else(|| chosen.files.iter().find(|f| f.filename.ends_with(".mrpack")))
        .ok_or_else(|| "E_PACK_NO_MRPACK".to_string())?;

    super::workshop::validate_download_url(&file.url)?;
    if file.size > MAX_PACK_BYTES {
        return Err("E_PACK_DOWNLOAD_TOO_LARGE".into());
    }
    ensure_free_space(&std::env::temp_dir(), file.size)?;

    let sha1 = file.hashes.get("sha1").map(String::as_str).ok_or("E_PACK_NO_HASH")?;
    let temp = std::env::temp_dir().join(format!("fc_modpack_{}.mrpack", uuid::Uuid::new_v4()));
    let bytes = download_pack(&session, &file.url, &temp, Some(sha1)).await;
    // The temp file goes away on every path, including failure and cancellation.
    let read = match bytes {
        Ok(()) => tokio::fs::read(&temp).await.map_err(super::ctx("E_PACK_DOWNLOAD_FAILED")),
        Err(e) => Err(e),
    };
    let _ = tokio::fs::remove_file(&temp).await;
    let bytes = read?;

    import_mrpack_internal(&session, &bytes, custom_name).await
}

/// Downloads one file with byte progress, stopping as soon as the user cancels.
async fn download_pack(session: &JobSession, url: &str, dest: &Path, sha1: Option<&str>) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<focusite_download::DownloadProgress>(32);
    let forward = {
        let session = session.clone();
        tokio::spawn(async move {
            while let Some(p) = rx.recv().await {
                session.emit_full("download", "", p.downloaded_bytes, p.total_bytes.unwrap_or(0), p.speed_bytes_per_sec, None);
            }
        })
    };
    let downloader = focusite_download::Downloader::default();
    let result = tokio::select! {
        r = downloader.download_file(url, dest, sha1, Some(tx), "modrinth-modpack") => r.map_err(super::ctx("E_PACK_DOWNLOAD_FAILED")),
        _ = session.cancelled() => Err(CANCELLED_MESSAGE.to_string()),
    };
    forward.abort();
    result
}

/// Claims a new, uniquely named instance folder (with `minecraft/mods`) for an imported pack.
pub(super) fn create_pack_instance_dir(name: &str) -> Result<(String, PathBuf), String> {
    let base = get_instances_dir();
    let instance_id = unique_folder_name(&base, name)?;
    let inst_dir = base.join(&instance_id);
    // `create_dir` (not `_all`) fails if another import claimed the same name a moment ago.
    std::fs::create_dir_all(&base).map_err(super::ctx("E_INSTANCE_CREATE_FAILED"))?;
    std::fs::create_dir(&inst_dir).map_err(super::ctx("E_INSTANCE_CREATE_FAILED"))?;
    std::fs::create_dir_all(inst_dir.join("minecraft").join("mods")).map_err(super::ctx("E_INSTANCE_CREATE_FAILED"))?;
    Ok((instance_id, inst_dir))
}

/// Copies the pack's own icon (or a Prism icon) to `icon.png` and records its source in `cfg`.
fn set_pack_icon(archive_bytes: &[u8], inst_dir: &Path, cfg: &mut InstanceDiskConfig) -> bool {
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
            return true;
        }
    }
    false
}

/// One file the import still has to fetch, and how.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct PendingJob {
    pub item: MissingModItem,
    pub spec: PackJobSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum PackJobSpec {
    /// A plain download into `rel_path` (relative to the instance's `minecraft` folder).
    #[serde(rename_all = "camelCase")]
    Url { url: String, sha1: Option<String>, size: u64, rel_path: String },
    #[serde(rename_all = "camelCase")]
    Curseforge { project_id: u32, file_id: u32 },
}

/// Everything a download job needs besides its own spec.
#[derive(Clone)]
struct FetchCtx {
    http: reqwest::Client,
    cas: CasManager,
    mc_dir: PathBuf,
    api_key: Option<String>,
}

type JobFn = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

/// Rejects a pack-relative path that is absolute, has a drive or `..`, or would land outside `base`.
pub(super) fn safe_rel_target(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.starts_with('/') || rel.contains("..") || rel.contains(':') {
        return Err(format!("E_PACK_UNSAFE_PATH: {}", rel));
    }
    let target = base.join(&rel);
    if !target.starts_with(base) {
        return Err(format!("E_PACK_UNSAFE_PATH: {}", rel));
    }
    Ok(target)
}

fn job_for(spec: PackJobSpec, ctx: &FetchCtx) -> JobFn {
    let ctx = ctx.clone();
    Arc::new(move || {
        let (spec, ctx) = (spec.clone(), ctx.clone());
        Box::pin(async move {
            match spec {
                PackJobSpec::Url { url, sha1, size, rel_path } => {
                    let target = safe_rel_target(&ctx.mc_dir, &rel_path)?;
                    if let Some(parent) = target.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    fetch_pack_file(&ctx.http, &ctx.cas, &url, sha1.as_deref(), size, &target).await
                }
                PackJobSpec::Curseforge { project_id, file_id } => {
                    let key = ctx.api_key.as_deref().ok_or("E_CURSEFORGE_NO_KEY")?;
                    fetch_curseforge_file(&ctx.http, &ctx.cas, key, project_id, file_id, &ctx.mc_dir.join("mods")).await
                }
            }
        })
    })
}

/// Runs the download jobs four at a time, retrying transient failures. Returns the jobs that still failed, so
/// the import can finish and the user can fetch those files by hand. Stops with an error when cancelled.
async fn run_pack_jobs(session: &JobSession, jobs: Vec<(PendingJob, JobFn)>) -> Result<Vec<PendingJob>, String> {
    let total = jobs.len() as u64;
    let done = Arc::new(AtomicU64::new(0));
    let limit = Arc::new(tokio::sync::Semaphore::new(4));
    let mut set = tokio::task::JoinSet::new();
    session.emit("mods", "", 0, total);
    for (pending, job) in jobs {
        let (limit, session, done) = (limit.clone(), session.clone(), done.clone());
        set.spawn(async move {
            let _permit = limit.acquire_owned().await;
            if session.is_cancelled() {
                return (pending, Err(CANCELLED_MESSAGE.to_string()));
            }
            let name = pending.item.file_name.clone();
            session.emit("mods", &name, done.load(Ordering::Relaxed), total);
            let mut attempt = 0;
            let result = loop {
                match job().await {
                    Ok(()) => break Ok(()),
                    Err(e) if attempt < MAX_RETRIES && is_retryable(&e) && !session.is_cancelled() => {
                        attempt += 1;
                        session.emit_full("mods", &name, done.load(Ordering::Relaxed), total, 0, Some(attempt));
                        tokio::time::sleep(retry_delay(attempt)).await;
                    }
                    Err(e) => break Err(e),
                }
            };
            (pending, result)
        });
    }
    let mut failed = Vec::new();
    while let Some(joined) = set.join_next().await {
        if session.is_cancelled() {
            set.abort_all();
            return Err(CANCELLED_MESSAGE.into());
        }
        let (pending, result) = joined.map_err(|e| e.to_string())?;
        let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
        session.emit("mods", &pending.item.file_name, finished, total);
        if let Err(reason) = result {
            tracing::warn!("Modpack file {} failed to download: {}", pending.item.name, reason);
            failed.push(pending);
        }
    }
    session.check()?;
    Ok(failed)
}

/// Remembers the files that failed so they can be retried later; removes the record when none are left.
fn save_pending(inst_dir: &Path, pending: &[PendingJob]) {
    let path = inst_dir.join(PENDING_FILE);
    if pending.is_empty() {
        let _ = std::fs::remove_file(&path);
    } else if let Ok(json) = serde_json::to_vec_pretty(pending) {
        let _ = super::atomic_write(&path, &json);
    }
}

/// Runs `fill` for a freshly created pack instance and deletes the folder when it fails or is cancelled,
/// so a failed import never leaves a half-made instance behind.
pub(super) async fn finish_pack_import(
    inst_dir: &Path,
    fill: impl Future<Output = Result<ModpackImportResult, String>>,
) -> Result<ModpackImportResult, String> {
    let outcome = fill.await;
    if outcome.is_err() {
        let _ = std::fs::remove_dir_all(inst_dir);
    }
    outcome
}

/// Client for pack file downloads: a redirect is followed only when its target is also an allowlisted
/// download host, so an allowed host cannot bounce the launcher to an arbitrary server.
fn pack_http() -> &'static reqwest::Client {
    static CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Focusite-Launcher/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(15))
            .read_timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 {
                    attempt.error("too many redirects")
                } else if super::workshop::validate_download_url(attempt.url().as_str()).is_ok() {
                    attempt.follow()
                } else {
                    attempt.error("redirect to an untrusted host")
                }
            }))
            .build()
            .unwrap_or_default()
    });
    &CLIENT
}

fn cas() -> CasManager {
    CasManager::new(super::get_app_data_dir().join("cas"))
}

/// Maps `.mrpack` dependencies to our loader name and version.
fn mrpack_loader(deps: &std::collections::HashMap<String, String>) -> (String, Option<String>) {
    [
        ("fabric-loader", "Fabric"),
        ("neoforge", "NeoForge"),
        ("forge", "Forge"),
        ("quilt-loader", "Quilt"),
    ]
    .iter()
    .find_map(|(key, name)| deps.get(*key).map(|v| (name.to_string(), Some(v.clone()))))
    .unwrap_or_else(|| ("Vanilla".to_string(), None))
}

/// Converts the pack-extraction error, keeping a cancellation recognisable.
fn unpack_error(session: &JobSession, what: &str, e: ModpackError) -> String {
    if session.is_cancelled() {
        CANCELLED_MESSAGE.to_string()
    } else {
        format!("{}: {}", what, e)
    }
}

async fn import_mrpack_internal(
    session: &JobSession,
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    session.emit("read", "", 0, 0);
    let index = read_mrpack_index(archive_bytes).map_err(super::ctx("E_PACK_PARSE_FAILED"))?;

    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or("E_PACK_NO_MC_VERSION")?;
    let (loader, loader_version) = mrpack_loader(&index.dependencies);

    // Refuse before anything is created when the drive cannot hold the pack.
    let download: u64 = index
        .files
        .iter()
        .filter(|f| f.env.as_ref().and_then(|e| e.client.as_deref()) != Some("unsupported"))
        .map(|f| f.file_size)
        .sum();
    let unpacked = archive_unpacked_size(archive_bytes).map_err(super::ctx("E_PACK_UNREADABLE"))?;
    ensure_free_space(&get_instances_dir(), (download + unpacked) / 10 * 12)?;
    session.check()?;

    let name = trimmed_name(custom_name).unwrap_or_else(|| index.name.clone());
    // A pack never lands in an existing instance: the folder name is made unique.
    let (instance_id, inst_dir) = create_pack_instance_dir(&name)?;
    let mc_dir = inst_dir.join("minecraft");

    finish_pack_import(&inst_dir, async {
        session.emit("overrides", "", 0, 0);
        unpack_mrpack_with(archive_bytes, &mc_dir, &mut |done, total| {
            session.check().map_err(ModpackError::InvalidArchive)?;
            session.emit("overrides", "", done as u64, total as u64);
            Ok(())
        })
        .map_err(|e| unpack_error(session, "E_PACK_UNPACK_FAILED", e))?;

        let mut cfg = new_instance_config(&instance_id, &name, &mc_version, &loader, loader_version);
        cfg.description = index.summary.clone();
        let mut imported = vec!["overrides".to_string()];
        if set_pack_icon(archive_bytes, &inst_dir, &mut cfg) {
            imported.push("icon".into());
        }
        if super::instance_transfer::apply_pack_background(archive_bytes, &inst_dir, &mut cfg) {
            imported.push("background".into());
        }
        write_instance_config(&inst_dir, &cfg)?;

        // Files are checked (allowlisted host, size, SHA-1) and deduplicated through the CAS.
        let ctx = FetchCtx { http: pack_http().clone(), cas: cas(), mc_dir: mc_dir.clone(), api_key: None };
        let mut jobs = Vec::new();
        for file in index.files {
            if file.env.as_ref().and_then(|e| e.client.as_deref()) == Some("unsupported") || file.downloads.is_empty() {
                continue;
            }

            let rel_path = file.path.replace('\\', "/");
            let target = safe_rel_target(&mc_dir, &rel_path)?;
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if target.exists() {
                continue;
            }

            let url = file.downloads[0].clone();
            let file_name = rel_path.rsplit('/').next().unwrap_or(&rel_path).to_string();
            let item = MissingModItem {
                project_id: 0,
                file_id: 0,
                name: file_name.clone(),
                file_name,
                // Only links the allowlist accepts are offered for opening in the browser.
                web_url: if super::workshop::validate_download_url(&url).is_ok() { url.clone() } else { String::new() },
                rel_path: rel_path.clone(),
            };
            let spec = PackJobSpec::Url { url, sha1: file.hashes.get("sha1").cloned(), size: file.file_size, rel_path };
            jobs.push((PendingJob { item, spec: spec.clone() }, job_for(spec, &ctx)));
        }

        let failed = run_pack_jobs(session, jobs).await?;
        save_pending(&inst_dir, &failed);
        session.emit("done", "", 1, 1);
        Ok(ModpackImportResult {
            instance_id: instance_id.clone(),
            instance_name: name.clone(),
            version: mc_version.clone(),
            loader: loader.clone(),
            is_completed: failed.is_empty(),
            missing_mods: failed.into_iter().map(|p| p.item).collect(),
            imported,
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
    let sha1 = sha1.ok_or("E_PACK_NO_HASH")?;
    // The pack index states each file's size; a larger body is refused (0 = not stated).
    let max = if expected_size > 0 { expected_size } else { MAX_PACK_FILE_BYTES };
    let mut resp = http
        .get(url)
        .send()
        .await
        .map_err(super::ctx("E_CONNECTION"))?
        .error_for_status()
        .map_err(super::ctx("E_SERVER_RESPONSE"))?;
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(super::ctx("E_DOWNLOAD_INTERRUPTED"))? {
        if (bytes.len() + chunk.len()) as u64 > max {
            return Err("E_PACK_SIZE_MISMATCH".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let hash = cas.store_bytes(&bytes, Some(sha1)).map_err(super::ctx("E_FILE_STORE_FAILED"))?;
    cas.link_to_instance(&hash, target).map_err(super::ctx("E_FILE_STORE_FAILED"))?;
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
        .map_err(super::ctx("E_CONNECTION"))?
        .error_for_status()
        .map_err(super::ctx("E_SERVER_RESPONSE"))?
        .json()
        .await
        .map_err(super::ctx("E_BAD_RESPONSE"))?;
    let file_name = Path::new(&info.data.file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    validate_safe_filename(file_name)?;
    let url = info.data.download_url.as_deref().ok_or("E_DOWNLOAD_BLOCKED")?;
    let sha1 = info.data.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.as_str());
    std::fs::create_dir_all(mods_dir).map_err(super::ctx("E_FILE_STORE_FAILED"))?;
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

fn curseforge_loader_of(manifest: &focusite_modpacks::CurseForgeManifest) -> (String, Option<String>) {
    manifest
        .minecraft
        .mod_loaders
        .iter()
        .find(|l| l.primary)
        .or_else(|| manifest.minecraft.mod_loaders.first())
        .map(|l| curseforge_loader(&l.id))
        .unwrap_or_else(|| ("Vanilla".to_string(), None))
}

async fn import_curseforge_internal(
    session: &JobSession,
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    session.emit("read", "", 0, 0);
    let (manifest, modlist_map) =
        read_curseforge_manifest(archive_bytes).map_err(super::ctx("E_PACK_PARSE_FAILED"))?;

    let mc_version = manifest.minecraft.version.clone();
    let (loader, loader_version) = curseforge_loader_of(&manifest);

    let unpacked = archive_unpacked_size(archive_bytes).map_err(super::ctx("E_PACK_UNREADABLE"))?;
    let estimate = unpacked + manifest.files.len() as u64 * 4 * 1024 * 1024;
    ensure_free_space(&get_instances_dir(), estimate / 10 * 12)?;
    session.check()?;

    let name = trimmed_name(custom_name).unwrap_or_else(|| manifest.name.clone());
    let (instance_id, inst_dir) = create_pack_instance_dir(&name)?;
    let mc_dir = inst_dir.join("minecraft");

    finish_pack_import(&inst_dir, async {
        session.emit("overrides", "", 0, 0);
        unpack_curseforge_overrides_with(archive_bytes, &manifest, &mc_dir, &mut |done, total| {
            session.check().map_err(ModpackError::InvalidArchive)?;
            session.emit("overrides", "", done as u64, total as u64);
            Ok(())
        })
        .map_err(|e| unpack_error(session, "E_PACK_UNPACK_FAILED", e))?;

        let mut cfg = new_instance_config(&instance_id, &name, &mc_version, &loader, loader_version);
        cfg.description = Some(tr!("由 CurseForge 模組包「{}」導入", "Imported from the CurseForge modpack {}", manifest.name));
        let mut imported = vec!["overrides".to_string()];
        // The author's recommended memory becomes the instance's maximum, never below the default.
        if let Some(ram) = manifest.minecraft.recommended_ram.filter(|r| (512..=65536).contains(r)) {
            cfg.max_memory_mb = cfg.max_memory_mb.max(ram);
            imported.push("memory".into());
        }
        if set_pack_icon(archive_bytes, &inst_dir, &mut cfg) {
            imported.push("icon".into());
        }
        if super::instance_transfer::apply_pack_background(archive_bytes, &inst_dir, &mut cfg) {
            imported.push("background".into());
        }
        write_instance_config(&inst_dir, &cfg)?;

        let api_key = load_settings_from_disk().curseforge_api_key;
        let ctx = FetchCtx { http: pack_http().clone(), cas: cas(), mc_dir: mc_dir.clone(), api_key: api_key.clone() };
        let mut manual = Vec::new();
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
            let item = MissingModItem {
                project_id: file_ref.project_id,
                file_id: file_ref.file_id,
                name: matched_name,
                file_name: format!("{}-{}.jar", safe_mod_name.replace(' ', "-"), file_ref.file_id),
                web_url,
                rel_path: String::new(),
            };
            let spec = PackJobSpec::Curseforge { project_id: file_ref.project_id, file_id: file_ref.file_id };
            let pending = PendingJob { item, spec: spec.clone() };
            // Without an API key nothing can be resolved: every mod is listed for manual download.
            if api_key.is_none() {
                manual.push(pending);
            } else {
                jobs.push((pending, job_for(spec, &ctx)));
            }
        }
        let mut failed = manual;
        failed.extend(run_pack_jobs(session, jobs).await?);
        save_pending(&inst_dir, &failed);
        session.emit("done", "", 1, 1);

        Ok(ModpackImportResult {
            instance_id: instance_id.clone(),
            instance_name: name.clone(),
            version: mc_version.clone(),
            loader: loader.clone(),
            is_completed: failed.is_empty(),
            missing_mods: failed.into_iter().map(|p| p.item).collect(),
            imported,
        })
    })
    .await
}

/// Tries the files an import could not fetch again. Returns the ones that still fail.
#[tauri::command]
pub async fn retry_pack_downloads(
    app: AppHandle,
    instance_id: String,
    import_id: Option<String>,
) -> Result<Vec<MissingModItem>, String> {
    validate_safe_id(&instance_id)?;
    let session = JobSession::for_app(app, IMPORT_PROGRESS_EVENT, import_id);
    let inst_dir = get_instances_dir().join(&instance_id);
    let pending_path = inst_dir.join(PENDING_FILE);
    let pending: Vec<PendingJob> = std::fs::read(&pending_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or("E_PACK_NO_RETRY_LIST")?;

    let ctx = FetchCtx {
        http: pack_http().clone(),
        cas: cas(),
        mc_dir: inst_dir.join("minecraft"),
        api_key: load_settings_from_disk().curseforge_api_key,
    };
    // Files the user placed by hand in the meantime are not downloaded again.
    let missing: Vec<MissingModItem> = pending.iter().map(|p| p.item.clone()).collect();
    let still_missing = cf_rescan(&ctx.mc_dir, &missing);
    let jobs: Vec<(PendingJob, JobFn)> = pending
        .into_iter()
        .filter(|p| still_missing.contains(&p.item))
        .map(|p| {
            let job = job_for(p.spec.clone(), &ctx);
            (p, job)
        })
        .collect();

    let failed = run_pack_jobs(&session, jobs).await?;
    save_pending(&inst_dir, &failed);
    Ok(failed.into_iter().map(|p| p.item).collect())
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
    .map_err(super::ctx("E_BACKGROUND_TASK_FAILED"))
}

#[tauri::command]
pub fn open_external_urls(urls: Vec<String>) -> Result<(), String> {
    for url in urls {
        let trimmed = url.trim();
        if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
            return Err(format!("E_LINK_UNSUPPORTED: {}", trimmed));
        }

        #[cfg(windows)]
        let spawned = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .spawn();
        #[cfg(not(windows))]
        let spawned = std::process::Command::new("xdg-open").arg(trimmed).spawn();
        spawned.map_err(|e| format!("E_LINK_OPEN_FAILED: {} {}", trimmed, e))?;
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
        assert!(no_hash.unwrap_err().contains("E_PACK_NO_HASH"));
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

    #[test]
    fn pack_paths_cannot_escape_the_instance() {
        let base = std::env::temp_dir().join("fc_rel");
        for bad in ["/x", "C:/x", "../x", "a/../../x", "", "a:b"] {
            assert!(safe_rel_target(&base, bad).is_err(), "{bad}");
        }
        assert_eq!(safe_rel_target(&base, "mods\\a.jar").unwrap(), base.join("mods/a.jar"));
    }

    /// A pack above 1 GiB is described without being read, and is refused until the user confirmed it.
    #[test]
    fn large_pack_needs_confirmation() {
        let path = std::env::temp_dir().join(format!("fc_large_{}.mrpack", uuid::Uuid::new_v4()));
        std::fs::File::create(&path).unwrap().set_len(MAX_PACK_BYTES + 1).unwrap();
        let info = run(inspect_modpack_file(path.to_string_lossy().to_string(), None)).unwrap();
        assert!(info.large);
        assert_eq!(info.size_bytes, MAX_PACK_BYTES + 1);
        assert!(run(read_pack_file(&path, None, false)).unwrap_err().contains("E_PACK_NEEDS_CONFIRM"));
        std::fs::File::create(&path).unwrap().set_len(HARD_MAX_PACK_BYTES + 1).unwrap();
        assert!(run(read_pack_file(&path, None, true)).unwrap_err().contains("E_PACK_TOO_LARGE"));
        let _ = std::fs::remove_file(path);
    }

    /// A cancelled import removes the half-made instance folder and keeps the cancellation recognisable.
    #[test]
    fn cancelled_import_leaves_no_instance_folder() {
        let dir = std::env::temp_dir().join(format!("fc_cancel_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("minecraft")).unwrap();
        let session = JobSession::new(None, Some("cancel-test".into()));
        let err = run(finish_pack_import(&dir, async {
            std::fs::write(dir.join("minecraft").join("half.jar"), b"x").unwrap();
            super::super::import_support::cancel_job("cancel-test".into());
            session.check()?;
            Ok(ModpackImportResult::default())
        }))
        .unwrap_err();
        assert_eq!(err, CANCELLED_MESSAGE);
        assert!(!dir.exists());
    }

    /// A job that fails twice with a transient error and then succeeds ends up fetched, not missing.
    #[test]
    fn transient_failures_are_retried_then_succeed() {
        let calls = Arc::new(AtomicU64::new(0));
        let c = calls.clone();
        let job: JobFn = Arc::new(move || {
            let c = c.clone();
            Box::pin(async move {
                if c.fetch_add(1, Ordering::SeqCst) < 2 { Err("E_CONNECTION: boom".to_string()) } else { Ok(()) }
            })
        });
        let hard: JobFn = Arc::new(|| Box::pin(async { Err("伺服器回應錯誤：HTTP status client error (404)".to_string()) }));
        let item = |n: &str| MissingModItem {
            project_id: 0, file_id: 0, name: n.into(), file_name: n.into(), web_url: String::new(), rel_path: n.into(),
        };
        let spec = PackJobSpec::Curseforge { project_id: 1, file_id: 1 };
        let session = JobSession::new(None, Some("retry-test".into()));
        let failed = run(run_pack_jobs(
            &session,
            vec![
                (PendingJob { item: item("ok"), spec: spec.clone() }, job),
                (PendingJob { item: item("hard"), spec }, hard),
            ],
        ))
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].item.name, "hard");
    }
}
