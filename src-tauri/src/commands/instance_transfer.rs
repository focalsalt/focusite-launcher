//! Moving an instance between machines: exporting it to a Focusite archive (`.zip`) and importing one, plus
//! the per-instance background image that the archive carries.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;

use focusite_modpacks::mrpack::{archive_unpacked_size, extract_overrides, open_zip};
use focusite_modpacks::ModpackError;

use super::import_support::{ensure_free_space, JobSession, CANCELLED_MESSAGE, EXPORT_PROGRESS_EVENT};
use super::instance::{
    convert_disk_config_to_summary, get_instances_dir, is_instance_busy, new_disk_config, new_instance_config, read_instance_config,
    unique_folder_name, update_instance_config, validate_safe_id, write_instance_config, InstanceDiskConfig,
    InstanceSummaryDto, INSTANCE_CONFIG_FILE,
};
use super::modpack::{finish_pack_import, ModpackImportResult, PackInspection};

const BACKGROUND_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
const MAX_BACKGROUND_BYTES: u64 = 20 * 1024 * 1024;
const MAX_BACKGROUND_SIDE: u32 = 16384;
const MAX_ICON_BYTES: u64 = 8 * 1024 * 1024;
const MAX_EXPORT_FILES: usize = 200_000;

fn normalize_ext(ext: &str) -> Option<&'static str> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "webp" => Some("webp"),
        _ => None,
    }
}

fn remove_backgrounds(inst_dir: &Path) {
    for ext in BACKGROUND_EXTS {
        let _ = fs::remove_file(inst_dir.join(format!("background.{ext}")));
    }
}

/// Validates an image from memory (size, readable header, sane dimensions) and stores it as the instance's
/// `background.<ext>`. Returns the file name.
pub fn store_background_bytes(inst_dir: &Path, ext: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = normalize_ext(ext).ok_or("E_BACKGROUND_FORMAT")?;
    if bytes.len() as u64 > MAX_BACKGROUND_BYTES {
        return Err("E_BACKGROUND_TOO_LARGE".into());
    }
    let (w, h) = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("E_IMAGE_OPEN_FAILED: {}", e))?
        .into_dimensions()
        .map_err(|e| format!("E_IMAGE_DECODE_FAILED: {}", e))?;
    if w == 0 || h == 0 || w > MAX_BACKGROUND_SIDE || h > MAX_BACKGROUND_SIDE {
        return Err("E_BACKGROUND_DIMENSIONS".into());
    }
    remove_backgrounds(inst_dir);
    let name = format!("background.{ext}");
    super::atomic_write(&inst_dir.join(&name), bytes).map_err(|e| format!("E_BACKGROUND_SAVE_FAILED: {}", e))?;
    Ok(name)
}

pub fn read_limited(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let size = fs::metadata(path).map_err(|e| format!("E_IMAGE_OPEN_FAILED: {}", e))?.len();
    if size > max {
        return Err("E_BACKGROUND_TOO_LARGE".into());
    }
    fs::read(path).map_err(|e| format!("E_IMAGE_OPEN_FAILED: {}", e))
}

/// Copies a user-chosen image into the instance folder and records it as the instance's background.
#[tauri::command]
pub async fn set_instance_background(instance_id: String, source_path: String) -> Result<InstanceSummaryDto, String> {
    super::blocking(move || {
        validate_safe_id(&instance_id)?;
        let inst_dir = get_instances_dir().join(&instance_id);
        if !inst_dir.is_dir() {
            return Err("E_INSTANCE_NOT_FOUND".into());
        }
        let src = Path::new(&source_path);
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or_default();
        let bytes = read_limited(src, MAX_BACKGROUND_BYTES)?;
        let name = store_background_bytes(&inst_dir, ext, &bytes)?;
        let config = update_instance_config(&inst_dir, |c| {
            c.background_source = Some(name);
            c.clone()
        })?;
        Ok(convert_disk_config_to_summary(&inst_dir, config))
    })
    .await
}

#[tauri::command]
pub async fn reset_instance_background(instance_id: String) -> Result<InstanceSummaryDto, String> {
    super::blocking(move || {
        validate_safe_id(&instance_id)?;
        let inst_dir = get_instances_dir().join(&instance_id);
        if !inst_dir.is_dir() {
            return Err("E_INSTANCE_NOT_FOUND".into());
        }
        remove_backgrounds(&inst_dir);
        let config = update_instance_config(&inst_dir, |c| {
            c.background_source = None;
            c.clone()
        })?;
        Ok(convert_disk_config_to_summary(&inst_dir, config))
    })
    .await
}

/// Takes a `background.*` image from the archive root (the Focusite export layout) into the instance.
pub fn apply_pack_background(archive_bytes: &[u8], inst_dir: &Path, cfg: &mut InstanceDiskConfig) -> bool {
    let Ok(mut zip) = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)) else { return false };
    for ext in BACKGROUND_EXTS {
        let Ok(file) = zip.by_name(&format!("background.{ext}")) else { continue };
        let mut buf = Vec::new();
        if file.take(MAX_BACKGROUND_BYTES + 1).read_to_end(&mut buf).is_ok() {
            if let Ok(name) = store_background_bytes(inst_dir, ext, &buf) {
                cfg.background_source = Some(name);
                return true;
            }
        }
    }
    false
}

/// Copies the user-tunable settings of `src` onto a freshly created config.
pub fn overlay_settings(dst: &mut InstanceDiskConfig, src: &InstanceDiskConfig) {
    dst.description = src.description.clone();
    dst.show_log_on_launch = src.show_log_on_launch;
    dst.window_width = src.window_width;
    dst.window_height = src.window_height;
    dst.min_memory_mb = src.min_memory_mb;
    dst.max_memory_mb = src.max_memory_mb;
    // The Java path is deliberately not carried over: it is machine-specific, and an archive from someone else
    // must not pick which executable the launcher runs.
    dst.jvm_args = src.jvm_args.clone();
    dst.group = src.group.clone();
    dst.custom_jvm_args = src.custom_jvm_args.clone();
    dst.environment_vars = src.environment_vars.clone();
    dst.custom_game_args = src.custom_game_args.clone();
}

/// Names of the settings in `cfg` that differ from a new instance's defaults, for the import summary.
pub fn describe_settings(cfg: &InstanceDiskConfig) -> Vec<String> {
    let base = new_disk_config("", "", "", "", None);
    let mut out = Vec::new();
    let has_extra = |args: &Option<Vec<String>>| args.as_ref().is_some_and(|a| !a.is_empty());
    if cfg.jvm_args != base.jvm_args || has_extra(&cfg.custom_jvm_args) || has_extra(&cfg.custom_game_args) {
        out.push("jvm".to_string());
    }
    if cfg.min_memory_mb != base.min_memory_mb || cfg.max_memory_mb != base.max_memory_mb {
        out.push("memory".into());
    }
    if cfg.java_path.is_some() {
        out.push("java".into());
    }
    if cfg.window_width.is_some() || cfg.window_height.is_some() {
        out.push("window".into());
    }
    if cfg.environment_vars.as_ref().is_some_and(|e| !e.is_empty()) {
        out.push("env".into());
    }
    if cfg.description.is_some() {
        out.push("description".into());
    }
    out
}

fn read_zip_config(zip: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>) -> Result<InstanceDiskConfig, String> {
    let file = zip.by_name(INSTANCE_CONFIG_FILE).map_err(|_| "E_EXPORT_NO_CONFIG".to_string())?;
    let mut text = String::new();
    file.take(16 * 1024 * 1024).read_to_string(&mut text).map_err(|e| format!("E_INSTANCE_CONFIG_UNREADABLE: {}", e))?;
    super::check_schema(&text, INSTANCE_CONFIG_FILE)?;
    let cfg: InstanceDiskConfig = serde_json::from_str(&text).map_err(|_| "E_EXPORT_CONFIG_INVALID".to_string())?;
    if cfg.version.trim().is_empty() {
        return Err("E_EXPORT_NO_MC_VERSION".into());
    }
    // These strings later become folder and file names, so an archive from someone else must not smuggle in paths.
    let fields = [Some(cfg.version.as_str()), Some(cfg.loader.as_str()), cfg.loader_version.as_deref()];
    if fields.into_iter().flatten().any(|v| validate_safe_id(v).is_err()) {
        return Err("E_EXPORT_UNSAFE_FIELD".into());
    }
    Ok(cfg)
}

pub fn inspect_focusite_zip(bytes: &[u8], custom_name: Option<String>) -> Result<PackInspection, String> {
    let mut zip = open_zip(bytes).map_err(|e| format!("E_EXPORT_UNREADABLE: {}", e))?;
    let cfg = read_zip_config(&mut zip)?;
    let file_count = zip
        .file_names()
        .filter(|n| n.starts_with("minecraft/") && !n.ends_with('/'))
        .count();
    let mut imported = vec!["overrides".to_string()];
    imported.extend(describe_settings(&cfg));
    if zip.by_name("icon.png").is_ok() {
        imported.push("icon".into());
    }
    if BACKGROUND_EXTS.iter().any(|e| zip.by_name(&format!("background.{e}")).is_ok()) {
        imported.push("background".into());
    }
    let name = custom_name.unwrap_or_else(|| cfg.name.clone());
    Ok(PackInspection {
        format: "focusite".into(),
        folder_name: unique_folder_name(&get_instances_dir(), &name)?,
        name,
        version: cfg.version.clone(),
        loader: cfg.loader.clone(),
        loader_version: cfg.loader_version.clone(),
        file_count,
        size_bytes: archive_unpacked_size(bytes).map_err(|e| e.to_string())?,
        imported,
        ..Default::default()
    })
}

pub async fn import_focusite_zip(
    session: &JobSession,
    bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    session.emit("read", "", 0, 0);
    let src_cfg = {
        let mut zip = open_zip(bytes).map_err(|e| format!("E_EXPORT_UNREADABLE: {}", e))?;
        read_zip_config(&mut zip)?
    };
    let unpacked = archive_unpacked_size(bytes).map_err(|e| format!("E_EXPORT_UNREADABLE: {}", e))?;
    ensure_free_space(&get_instances_dir(), unpacked / 10 * 11)?;
    session.check()?;

    let name = custom_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| src_cfg.name.clone());
    let (instance_id, inst_dir) = super::modpack::create_pack_instance_dir(&name)?;
    let mc_dir = inst_dir.join("minecraft");

    finish_pack_import(&inst_dir, async {
        session.emit("overrides", "", 0, 0);
        let mut zip = open_zip(bytes).map_err(|e| e.to_string())?;
        extract_overrides(&mut zip, &["minecraft/"], &mc_dir, &mut |done, total| {
            session.check().map_err(ModpackError::InvalidArchive)?;
            session.emit("overrides", "", done as u64, total as u64);
            Ok(())
        })
        .map_err(|e| if session.is_cancelled() { CANCELLED_MESSAGE.to_string() } else { format!("E_EXPORT_UNPACK_FAILED: {}", e) })?;

        // Identity and play statistics are new; everything the user tuned carries over.
        let mut cfg = new_instance_config(&instance_id, &name, &src_cfg.version, &src_cfg.loader, src_cfg.loader_version.clone());
        overlay_settings(&mut cfg, &src_cfg);
        cfg.is_favorite = false;
        let mut imported = vec!["overrides".to_string()];
        imported.extend(describe_settings(&cfg));
        if let Ok(mut icon) = zip.by_name("icon.png") {
            let mut buf = Vec::new();
            if (&mut icon).take(MAX_ICON_BYTES).read_to_end(&mut buf).is_ok() && fs::write(inst_dir.join("icon.png"), buf).is_ok() {
                cfg.icon_source = src_cfg.icon_source.clone().or(Some("custom".into()));
                cfg.icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
                imported.push("icon".into());
            }
        }
        if apply_pack_background(bytes, &inst_dir, &mut cfg) {
            imported.push("background".into());
        }
        write_instance_config(&inst_dir, &cfg)?;
        session.emit("done", "", 1, 1);
        Ok(ModpackImportResult {
            instance_id: instance_id.clone(),
            instance_name: name.clone(),
            version: src_cfg.version.clone(),
            loader: src_cfg.loader.clone(),
            missing_mods: Vec::new(),
            is_completed: true,
            imported,
        })
    })
    .await
}

// ---- export ------------------------------------------------------------------------------------------------

/// Top-level entries that are selected by default; everything else can be ticked by hand.
const DEFAULT_INCLUDED: [&str; 6] = ["coremods", "mods", "resourcepacks", "shaderpacks", "texturepacks", "options.txt"];

/// Folders whose children (a world, a pack) are listed but never opened any further.
const ONE_LEVEL_DIRS: [&str; 4] = ["saves", "resourcepacks", "texturepacks", "shaderpacks"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEntry {
    pub name: String,
    /// Path below the `minecraft` folder, `/`-separated.
    pub path: String,
    pub is_dir: bool,
    /// Whether the dialog may open this folder to pick what is inside it.
    pub expandable: bool,
    pub size_bytes: u64,
    /// Only meaningful for top-level entries: an empty folder is never selected by default.
    pub default_included: bool,
}

fn dir_size(path: &Path, files: &mut usize) -> u64 {
    let Ok(rd) = fs::read_dir(path) else { return 0 };
    rd.flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_symlink() => 0,
            Ok(t) if t.is_dir() => dir_size(&e.path(), files),
            Ok(_) => {
                *files += 1;
                e.metadata().map(|m| m.len()).unwrap_or(0)
            }
            Err(_) => 0,
        })
        .sum()
}

/// Whether `path` is a child of a one-level folder (`saves/World`), or deeper.
fn is_in_one_level(path: &str) -> bool {
    path.split_once('/').is_some_and(|(first, _)| ONE_LEVEL_DIRS.contains(&first))
}

/// Resolves a `/`-separated path below `base`, refusing traversal, absolute paths and symlinked parts.
fn resolve_rel(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let mut abs = base.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':']) {
            return Err(format!("E_EXPORT_ITEM_INVALID: {}", rel));
        }
        abs.push(part);
        if fs::symlink_metadata(&abs).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(format!("E_SYMLINK_UNSUPPORTED: {}", rel));
        }
    }
    Ok(abs)
}

/// Lists the entries of a folder inside an instance's `minecraft` folder (`sub_path` empty = the folder itself)
/// with their sizes, for the export dialog. Worlds and packs are only listed one level deep.
#[tauri::command]
pub async fn list_export_entries(instance_id: String, sub_path: Option<String>) -> Result<Vec<ExportEntry>, String> {
    super::blocking(move || {
        validate_safe_id(&instance_id)?;
        let mc = get_instances_dir().join(&instance_id).join("minecraft");
        let sub = sub_path.unwrap_or_default();
        let dir = if sub.is_empty() { mc.clone() } else { resolve_rel(&mc, &sub)? };
        let top = sub.is_empty();
        if is_in_one_level(&sub) {
            return Err("E_FOLDER_ONE_LEVEL".into());
        }
        let rd = fs::read_dir(&dir).map_err(|e| format!("E_INSTANCE_FOLDER_UNREADABLE: {}", e))?;
        let mut out: Vec<ExportEntry> = rd
            .flatten()
            .filter_map(|e| {
                let t = e.file_type().ok()?;
                if t.is_symlink() {
                    return None;
                }
                let name = e.file_name().to_string_lossy().to_string();
                let (is_dir, size_bytes) = if t.is_dir() {
                    (true, dir_size(&e.path(), &mut 0))
                } else {
                    (false, e.metadata().map(|m| m.len()).unwrap_or(0))
                };
                let path = if top { name.clone() } else { format!("{sub}/{name}") };
                Some(ExportEntry {
                    default_included: top && DEFAULT_INCLUDED.contains(&name.as_str()) && !(is_dir && size_bytes == 0),
                    expandable: is_dir && !is_in_one_level(&path),
                    name,
                    path,
                    is_dir,
                    size_bytes,
                })
            })
            .collect();
        out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(out)
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// Paths (`/`-separated) inside the instance's `minecraft` folder to include; a folder includes everything in it.
    pub include: Vec<String>,
}

struct ExportFile {
    abs: PathBuf,
    rel: String,
    size: u64,
}

fn collect_files(
    session: &JobSession,
    abs: &Path,
    rel: &str,
    out: &mut Vec<ExportFile>,
) -> Result<(), String> {
    session.check()?;
    let meta = fs::symlink_metadata(abs).map_err(|e| format!("E_FILE_READ_FAILED: {}: {}", abs.display(), e))?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        for e in fs::read_dir(abs).map_err(|e| format!("E_FILE_READ_FAILED: {}: {}", abs.display(), e))?.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            collect_files(session, &e.path(), &format!("{rel}/{name}"), out)?;
        }
    } else {
        if out.len() >= MAX_EXPORT_FILES {
            return Err("E_EXPORT_TOO_MANY_FILES".into());
        }
        out.push(ExportFile { abs: abs.to_path_buf(), rel: rel.to_string(), size: meta.len() });
    }
    Ok(())
}

fn is_already_compressed(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    ["jar", "zip", "png", "jpg", "jpeg", "webp", "ogg", "mp3", "mp4", "gz", "7z", "rar", "mca"]
        .iter()
        .any(|e| lower.ends_with(&format!(".{e}")))
}

/// Drops JVM arguments that name the local user (home folder, user name or a `Users`/`home` path).
fn scrub_user_args(args: &[String]) -> Vec<String> {
    let norm = |v: &str| v.replace('\\', "/").to_lowercase();
    let mut marks: Vec<String> = ["/users/", "/home/"].iter().map(|m| m.to_string()).collect();
    for var in ["USERPROFILE", "HOME"] {
        if let Ok(v) = std::env::var(var) {
            marks.push(norm(&v));
        }
    }
    // Very short user names would match unrelated arguments; the path markers above cover those.
    for var in ["USERNAME", "USER"] {
        if let Ok(v) = std::env::var(var) {
            if v.len() >= 3 {
                marks.push(norm(&v));
            }
        }
    }
    marks.retain(|m| !m.is_empty());
    args.iter().filter(|a| { let a = norm(a); !marks.iter().any(|m| a.contains(m.as_str())) }).cloned().collect()
}

/// Writes the export archive to `tmp`. The caller renames it into place or deletes it.
fn write_export(
    session: &JobSession,
    inst_dir: &Path,
    cfg: &InstanceDiskConfig,
    files: &[ExportFile],
    total: u64,
    tmp: &Path,
) -> Result<(), String> {
    let out = fs::File::create(tmp).map_err(|e| format!("E_EXPORT_CREATE_FAILED: {}", e))?;
    let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(out));
    let deflate = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let werr = |e: zip::result::ZipError| format!("E_EXPORT_WRITE_FAILED: {}", e);
    let ioerr = |e: std::io::Error| format!("E_EXPORT_WRITE_FAILED: {}", e);

    let mut cfg = cfg.clone();
    cfg.last_played_at = None;
    cfg.total_play_time_ms = 0;
    // Machine-specific or private: a local Java path carries the user name, environment variables may hold keys.
    cfg.java_path = None;
    cfg.environment_vars = None;
    cfg.jvm_args = scrub_user_args(&cfg.jvm_args);
    cfg.custom_jvm_args = cfg.custom_jvm_args.as_deref().map(scrub_user_args);
    cfg.custom_game_args = cfg.custom_game_args.as_deref().map(scrub_user_args);
    cfg.background_source = BACKGROUND_EXTS
        .iter()
        .map(|e| format!("background.{e}"))
        .find(|n| inst_dir.join(n).is_file());
    zip.start_file(INSTANCE_CONFIG_FILE, deflate).map_err(werr)?;
    zip.write_all(super::to_versioned_json(&cfg).map_err(|e| e.to_string())?.as_bytes()).map_err(ioerr)?;
    let icon = inst_dir.join("icon.png");
    if icon.is_file() {
        zip.start_file("icon.png", stored).map_err(werr)?;
        zip.write_all(&fs::read(&icon).map_err(ioerr)?).map_err(ioerr)?;
    }
    if let Some(bg) = &cfg.background_source {
        zip.start_file(bg.as_str(), stored).map_err(werr)?;
        zip.write_all(&fs::read(inst_dir.join(bg)).map_err(ioerr)?).map_err(ioerr)?;
    }

    let started = Instant::now();
    let mut done: u64 = 0;
    let mut last_emit = Instant::now();
    let mut buf = vec![0u8; 256 * 1024];
    for f in files {
        session.check()?;
        let opts = if is_already_compressed(&f.rel) { stored } else { deflate }.large_file(f.size >= 3 * 1024 * 1024 * 1024);
        zip.start_file(format!("minecraft{}", f.rel), opts).map_err(werr)?;
        let mut src = fs::File::open(&f.abs).map_err(|e| format!("E_FILE_READ_FAILED: {}: {}", f.abs.display(), e))?;
        loop {
            let n = src.read(&mut buf).map_err(ioerr)?;
            if n == 0 {
                break;
            }
            zip.write_all(&buf[..n]).map_err(ioerr)?;
            done += n as u64;
            if last_emit.elapsed().as_millis() >= 100 {
                session.check()?;
                let speed = (done as f64 / started.elapsed().as_secs_f64().max(0.001)) as u64;
                session.emit_full("pack", f.rel.trim_start_matches('/'), done, total, speed, None);
                last_emit = Instant::now();
            }
        }
    }
    // Finishing writes the central directory and flushes to disk, which can take a moment on a big archive.
    session.emit_full("pack", "", total, total, 0, None);
    zip.finish().map_err(werr)?.into_inner().map_err(|e| format!("E_EXPORT_WRITE_FAILED: {}", e))?.sync_all().map_err(ioerr)?;
    Ok(())
}

/// Packs an instance (settings, icon, background and the chosen game folders) into a `.zip` the launcher can
/// import again. Refuses while the game runs; the archive is written to a temp file and renamed on success.
#[tauri::command]
pub async fn export_instance(
    app: AppHandle,
    instance_id: String,
    dest_path: String,
    options: ExportOptions,
    export_id: Option<String>,
) -> Result<String, String> {
    let session = JobSession::for_app(app, EXPORT_PROGRESS_EVENT, export_id);
    super::blocking(move || {
        validate_safe_id(&instance_id)?;
        if is_instance_busy(&instance_id) {
            return Err("E_EXPORT_WHILE_RUNNING".into());
        }
        let inst_dir = get_instances_dir().join(&instance_id);
        let cfg = read_instance_config(&inst_dir)?;
        let dest = PathBuf::from(&dest_path);
        if !dest.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
            return Err("E_EXPORT_NOT_ZIP".into());
        }
        let parent = dest.parent().filter(|p| p.is_dir()).ok_or("E_EXPORT_NO_DEST")?;

        session.emit("scan", "", 0, 0);
        let mc = inst_dir.join("minecraft");
        let mut files = Vec::new();
        // Sorted so a folder comes before its own children; a child of an included folder is already packed.
        let mut include = options.include.clone();
        include.sort();
        include.dedup();
        let mut packed: Vec<String> = Vec::new();
        for (i, name) in include.iter().enumerate() {
            // Paths below the game folder only, never absolute or climbing out of it.
            let abs = resolve_rel(&mc, name)?;
            if packed.iter().any(|p| name.starts_with(&format!("{p}/"))) {
                continue;
            }
            session.emit("scan", name.as_str(), i as u64, include.len() as u64);
            if abs.exists() {
                collect_files(&session, &abs, &format!("/{name}"), &mut files)?;
                packed.push(name.clone());
            }
        }
        let total: u64 = files.iter().map(|f| f.size).sum();
        ensure_free_space(parent, total)?;
        session.check()?;

        let tmp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
        let result = write_export(&session, &inst_dir, &cfg, &files, total, &tmp).and_then(|_| {
            session.check()?;
            fs::rename(&tmp, &dest).map_err(|e| format!("E_EXPORT_FINISH_FAILED: {}", e))
        });
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result?;
        session.emit("done", "", total, total);
        Ok(dest.to_string_lossy().to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("fc_xfer_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn tiny_png() -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn background_must_be_a_real_image() {
        let dir = temp();
        assert!(store_background_bytes(&dir, "png", b"not an image").is_err());
        assert!(store_background_bytes(&dir, "exe", &tiny_png()).is_err());
        assert_eq!(store_background_bytes(&dir, "PNG", &tiny_png()).unwrap(), "background.png");
        // A new background replaces the old one, whatever its extension.
        assert_eq!(store_background_bytes(&dir, "png", &tiny_png()).unwrap(), "background.png");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn export_then_import_round_trips_settings_icon_background_and_files() {
        let root = temp();
        let inst = root.join("Src");
        fs::create_dir_all(inst.join("minecraft").join("mods")).unwrap();
        fs::create_dir_all(inst.join("minecraft").join("logs")).unwrap();
        fs::write(inst.join("minecraft").join("mods").join("a.jar"), "jar").unwrap();
        fs::write(inst.join("minecraft").join("options.txt"), "opt").unwrap();
        fs::write(inst.join("minecraft").join("logs").join("latest.log"), "log").unwrap();
        fs::write(inst.join("icon.png"), tiny_png()).unwrap();
        fs::write(inst.join("background.png"), tiny_png()).unwrap();
        let mut cfg = new_disk_config("Src", "Src", "1.20.1", "Fabric", Some("0.15.7".into()));
        cfg.max_memory_mb = 6144;
        cfg.custom_jvm_args = Some(vec!["-Xss4m".into()]);
        cfg.window_width = Some(1280);
        cfg.total_play_time_ms = 999;
        cfg.java_path = Some("C:/Users/someone/java/bin/javaw.exe".into());
        write_instance_config(&inst, &cfg).unwrap();

        let session = JobSession::new(None, Some("t-exp".into()));
        let mut files = Vec::new();
        for name in ["mods", "options.txt"] {
            collect_files(&session, &inst.join("minecraft").join(name), &format!("/{name}"), &mut files).unwrap();
        }
        let zip_path = root.join("out.zip");
        write_export(&session, &inst, &cfg, &files, 10, &zip_path).unwrap();
        let bytes = fs::read(&zip_path).unwrap();

        let info = inspect_focusite_zip(&bytes, None).unwrap();
        assert_eq!((info.version.as_str(), info.loader.as_str(), info.file_count), ("1.20.1", "Fabric", 2));
        assert!(["jvm", "memory", "window", "icon", "background"].iter().all(|k| info.imported.contains(&k.to_string())));

        // Import into a scratch folder through the same extraction path the command uses.
        let mut zip = open_zip(&bytes).unwrap();
        let back = read_zip_config(&mut zip).unwrap();
        assert_eq!(back.max_memory_mb, 6144);
        assert_eq!(back.total_play_time_ms, 0, "play time is not exported");
        assert!(back.java_path.is_none(), "a local Java path is not exported");
        assert_eq!(back.custom_jvm_args, Some(vec!["-Xss4m".to_string()]));
        let dst = root.join("Dst");
        extract_overrides(&mut zip, &["minecraft/"], &dst.join("minecraft"), &mut |_, _| Ok(())).unwrap();
        assert!(dst.join("minecraft").join("mods").join("a.jar").is_file());
        assert!(dst.join("minecraft").join("options.txt").is_file());
        assert!(!dst.join("minecraft").join("logs").exists(), "unselected folders are not exported");
        let mut fresh = new_disk_config("Dst", "Dst", &back.version, &back.loader, back.loader_version.clone());
        overlay_settings(&mut fresh, &back);
        assert_eq!((fresh.max_memory_mb, fresh.window_width), (6144, Some(1280)));
        assert!(apply_pack_background(&bytes, &dst, &mut fresh));
        assert_eq!(fresh.background_source.as_deref(), Some("background.png"));

        // An archive whose version or loader is a path is refused when read.
        let mut evil = cfg.clone();
        evil.version = "..\\..\\x".into();
        let evil_zip = root.join("evil.zip");
        write_export(&session, &inst, &evil, &files, 10, &evil_zip).unwrap();
        let evil_bytes = fs::read(&evil_zip).unwrap();
        assert!(read_zip_config(&mut open_zip(&evil_bytes).unwrap()).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn user_specific_jvm_args_are_not_exported() {
        let args: Vec<String> = ["-Xss4m", r"-Djava.io.tmpdir=C:\Users\someone\tmp", "-javaagent:/home/bob/a.jar", "-XX:+UseG1GC"]
            .iter()
            .map(|a| a.to_string())
            .collect();
        assert_eq!(scrub_user_args(&args), vec!["-Xss4m".to_string(), "-XX:+UseG1GC".to_string()]);
    }

    #[test]
    fn export_paths_stay_inside_the_game_folder() {
        let root = temp();
        fs::create_dir_all(root.join("mods").join("sub")).unwrap();
        assert!(resolve_rel(&root, "mods/sub").is_ok());
        for bad in ["", "..", "mods/../x", "/mods", "mods//sub", "C:/x", r"mods\sub"] {
            assert!(resolve_rel(&root, bad).is_err(), "{bad:?} must be refused");
        }
        assert!(is_in_one_level("saves/World") && is_in_one_level("shaderpacks/a/b"));
        assert!(!is_in_one_level("saves") && !is_in_one_level("mods/sub"));
        let _ = fs::remove_dir_all(root);
    }
}
