//! Labels each mod of an instance as client, server or both: jar metadata first, then Modrinth by file hash.

use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

use focusite_core::mod_side::{modrinth_side, read_jar_side, resolve_side, ModSide, SideSource};
use focusite_modpacks::workshop::MODRINTH_API_BASE;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use super::instance::{get_instances_dir, read_instance_config, validate_safe_id};

/// Keeps the `ids` query of one project request well within URL limits.
const BATCH: usize = 100;

#[derive(Debug, Serialize)]
pub struct ModSideEntry {
    pub filename: String,
    pub side: ModSide,
    pub source: Option<SideSource>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSidesDto {
    pub mods: Vec<ModSideEntry>,
    /// Some mods may read as unknown only because Modrinth could not be asked.
    pub modrinth_failed: bool,
}

#[derive(Clone)]
struct Scanned {
    jar: Option<ModSide>,
    /// Only computed when Modrinth still has a say.
    sha1: Option<String>,
}

type ScanKey = (PathBuf, u64, Option<SystemTime>, String);

static SCANS: LazyLock<Mutex<HashMap<ScanKey, Scanned>>> = LazyLock::new(Default::default);
/// Answers by SHA-1, including "Modrinth does not know this file". Kept until the app closes.
static MODRINTH: LazyLock<Mutex<HashMap<String, Option<ModSide>>>> = LazyLock::new(Default::default);

fn file_sha1(path: &Path) -> std::io::Result<String> {
    let mut hasher = Sha1::new();
    std::io::copy(&mut File::open(path)?, &mut hasher)?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn scan_jar(path: PathBuf, loader: &str) -> Scanned {
    let meta = std::fs::metadata(&path).ok();
    let key = (
        path.clone(),
        meta.as_ref().map_or(0, |m| m.len()),
        meta.and_then(|m| m.modified().ok()),
        loader.to_string(),
    );
    if let Some(hit) = SCANS.lock().ok().and_then(|c| c.get(&key).cloned()) {
        return hit;
    }
    let jar = read_jar_side(&path, loader);
    // A single-sided declaration is final, so such a file is neither hashed nor sent anywhere.
    let sha1 = if matches!(jar, Some(ModSide::Client | ModSide::Server)) { None } else { file_sha1(&path).ok() };
    let scanned = Scanned { jar, sha1 };
    if let Ok(mut cache) = SCANS.lock() {
        cache.insert(key, scanned.clone());
    }
    scanned
}

#[derive(Deserialize)]
struct VersionRef {
    project_id: String,
}

#[derive(Deserialize)]
struct Project {
    id: String,
    #[serde(default)]
    client_side: String,
    #[serde(default)]
    server_side: String,
}

async fn query_modrinth(hashes: &[String]) -> Result<HashMap<String, Option<ModSide>>, reqwest::Error> {
    let versions: HashMap<String, VersionRef> = super::http()
        .post(format!("{MODRINTH_API_BASE}/version_files"))
        .json(&serde_json::json!({ "hashes": hashes, "algorithm": "sha1" }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut ids: Vec<&str> = versions.values().map(|v| v.project_id.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    let mut sides: HashMap<String, Option<ModSide>> = HashMap::new();
    if !ids.is_empty() {
        let ids = serde_json::to_string(&ids).unwrap_or_default();
        let projects: Vec<Project> = super::http()
            .get(format!("{MODRINTH_API_BASE}/projects"))
            .query(&[("ids", ids)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        for p in projects {
            sides.insert(p.id, modrinth_side(&p.client_side, &p.server_side));
        }
    }
    Ok(hashes
        .iter()
        .map(|h| (h.clone(), versions.get(h).and_then(|v| sides.get(&v.project_id).copied().flatten())))
        .collect())
}

#[tauri::command]
pub async fn get_mod_sides(instance_id: String) -> Result<ModSidesDto, String> {
    validate_safe_id(&instance_id)?;
    let scanned = super::blocking(move || {
        let inst_dir = get_instances_dir().join(&instance_id);
        // An instance without a readable config still gets its jars read, just without a loader preference.
        let loader = read_instance_config(&inst_dir).map(|c| c.loader).unwrap_or_default();
        let mods_dir = inst_dir.join("minecraft").join("mods");
        if !mods_dir.exists() {
            return Ok(Vec::new());
        }
        let entries = std::fs::read_dir(&mods_dir).map_err(|e| format!("E_MODS_READ_FAILED: {}", e))?;
        Ok(entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .filter_map(|e| {
                let filename = e.file_name().to_string_lossy().to_string();
                // `.zip` mods carry no side metadata and stay unknown.
                let is_jar = filename.strip_suffix(".disabled").unwrap_or(&filename).ends_with(".jar");
                is_jar.then(|| (filename, scan_jar(e.path(), &loader)))
            })
            .collect::<Vec<_>>())
    })
    .await?;

    let missing: Vec<String> = {
        let cache = MODRINTH.lock().map_err(|e| e.to_string())?;
        scanned
            .iter()
            .filter_map(|(_, s)| s.sha1.clone())
            .filter(|h| !cache.contains_key(h))
            .collect()
    };
    let mut modrinth_failed = false;
    for batch in missing.chunks(BATCH) {
        match query_modrinth(batch).await {
            Ok(found) => MODRINTH.lock().map_err(|e| e.to_string())?.extend(found),
            Err(e) => {
                tracing::warn!("Modrinth side lookup failed: {e}");
                modrinth_failed = true;
                break;
            }
        }
    }

    let cache = MODRINTH.lock().map_err(|e| e.to_string())?;
    let mods = scanned
        .into_iter()
        .map(|(filename, s)| {
            let remote = s.sha1.as_ref().and_then(|h| cache.get(h).copied().flatten());
            let (side, source) = resolve_side(s.jar, remote);
            ModSideEntry { filename, side, source }
        })
        .collect();
    Ok(ModSidesDto { mods, modrinth_failed })
}
