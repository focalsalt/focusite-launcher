//! Describes an instance for other party members: game version, loader and mods (with Modrinth download info).

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

use super::instance::{get_instances_dir, read_instance_config, resolve_custom_jar, validate_safe_id};

const MODRINTH_API: &str = "https://api.modrinth.com/v2";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareModDto {
    pub filename: String,
    pub sha1: String,
    pub size: u64,
    /// "client", "server", "both" or "unknown" (the file is not on Modrinth).
    pub side: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomJarDto {
    pub filename: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSpecDto {
    /// The sharer's instance name; guests name their copy the same.
    pub instance_name: String,
    pub mc_version: String,
    pub loader: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_jar: Option<CustomJarDto>,
    pub mods: Vec<ShareModDto>,
}

pub fn sha1_file(path: &Path) -> Result<(String, u64), String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| format!("cannot read {}: {}", path.display(), e))?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    Ok((hasher.finalize().iter().map(|b| format!("{b:02x}")).collect(), size))
}

/// Enabled mods in `mods/` with their hashes (disabled ones are not part of the game that is running).
fn hash_mods(mods_dir: &Path) -> Result<Vec<ShareModDto>, String> {
    let mut mods = Vec::new();
    let Ok(entries) = std::fs::read_dir(mods_dir) else { return Ok(mods) };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !path.is_file() || !(name.ends_with(".jar") || name.ends_with(".zip")) {
            continue;
        }
        let (sha1, size) = sha1_file(&path)?;
        mods.push(ShareModDto { filename: name, sha1, size, side: "unknown".into(), project_id: None, version_id: None, download_url: None });
    }
    mods.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(mods)
}

/// Which side a Modrinth project needs, from its `client_side` / `server_side` ("required", "optional", "unsupported").
fn side_of(client: &str, server: &str) -> &'static str {
    match (client != "unsupported", server != "unsupported") {
        (true, true) => "both",
        (true, false) => "client",
        (false, true) => "server",
        _ => "unknown",
    }
}

/// Fills in project, version, download URL and side for the mods Modrinth knows; the rest stay "unknown".
async fn fill_from_modrinth(mods: &mut [ShareModDto]) -> Result<(), String> {
    if mods.is_empty() {
        return Ok(());
    }
    let client = super::http();
    let hashes: Vec<&str> = mods.iter().map(|m| m.sha1.as_str()).collect();
    let versions: HashMap<String, serde_json::Value> = client
        .post(format!("{MODRINTH_API}/version_files"))
        .json(&serde_json::json!({ "hashes": hashes, "algorithm": "sha1" }))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mut project_ids: Vec<String> = versions.values().filter_map(|v| v["project_id"].as_str().map(str::to_string)).collect();
    project_ids.sort();
    project_ids.dedup();
    let mut sides: HashMap<String, &'static str> = HashMap::new();
    for chunk in project_ids.chunks(100) {
        let ids = serde_json::to_string(chunk).map_err(|e| e.to_string())?;
        let projects: Vec<serde_json::Value> = client
            .get(format!("{MODRINTH_API}/projects"))
            .query(&[("ids", ids)])
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        for p in projects {
            if let Some(id) = p["id"].as_str() {
                sides.insert(id.to_string(), side_of(p["client_side"].as_str().unwrap_or(""), p["server_side"].as_str().unwrap_or("")));
            }
        }
    }

    for m in mods.iter_mut() {
        let Some(v) = versions.get(&m.sha1) else { continue };
        m.project_id = v["project_id"].as_str().map(str::to_string);
        m.version_id = v["id"].as_str().map(str::to_string);
        m.download_url = v["files"]
            .as_array()
            .and_then(|files| files.iter().find(|f| f["hashes"]["sha1"].as_str() == Some(m.sha1.as_str())))
            .and_then(|f| f["url"].as_str().map(str::to_string));
        m.side = m.project_id.as_ref().and_then(|id| sides.get(id)).copied().unwrap_or("unknown").into();
    }
    Ok(())
}

/// What other members need to build a matching instance. A Modrinth failure only leaves the mods "unknown".
#[tauri::command]
pub async fn instance_share_spec(instance_id: String) -> Result<ShareSpecDto, String> {
    validate_safe_id(&instance_id)?;
    let dir = get_instances_dir().join(&instance_id);
    let (cfg, mut mods, custom_jar) = super::blocking({
        let dir = dir.clone();
        move || {
            let cfg = read_instance_config(&dir)?;
            let mods = hash_mods(&dir.join("minecraft").join("mods"))?;
            let custom_jar = if cfg.loader.eq_ignore_ascii_case("custom") {
                let (jar, _) = resolve_custom_jar(&dir, &cfg)?;
                let (sha1, size) = sha1_file(&jar)?;
                let filename = jar.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                Some(CustomJarDto { filename, sha1, size })
            } else {
                None
            };
            Ok((cfg, mods, custom_jar))
        }
    })
    .await?;
    if let Err(e) = fill_from_modrinth(&mut mods).await {
        tracing::warn!("Modrinth lookup failed, mods are reported as unknown: {}", e);
    }
    let instance_name = cfg.name.chars().take(MAX_NAME_CHARS).collect();
    Ok(ShareSpecDto { instance_name, mc_version: cfg.version, loader: cfg.loader, loader_version: cfg.loader_version, custom_jar, mods })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareMatchDto {
    /// A local instance with the same game version, loader and loader version; none when the guest has to build one.
    pub instance_id: Option<String>,
    /// Mods the guest needs (client or both sides) that the matching instance does not have.
    pub missing: Vec<ShareModDto>,
}

const KNOWN_LOADERS: [&str; 6] = ["Vanilla", "Fabric", "Quilt", "Forge", "NeoForge", "Custom"];
/// Same limit as the signaling Worker, counted in characters (a CJK name is three bytes per character).
const MAX_NAME_CHARS: usize = 64;
/// A shared custom loader jar bigger than this is refused: the guest holds it in memory.
pub const MAX_CUSTOM_JAR_BYTES: u64 = 256 * 1024 * 1024;

/// Whether a received jar is the one the spec announced.
fn jar_matches(want: &CustomJarDto, bytes: &[u8]) -> bool {
    let mut h = Sha1::new();
    h.update(bytes);
    let sha1: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    sha1 == want.sha1 && bytes.len() as u64 == want.size
}

/// Mod files in `mods/` with their sizes; nothing is hashed here.
fn mod_files(mods_dir: &Path) -> Vec<(std::path::PathBuf, u64)> {
    let Ok(entries) = std::fs::read_dir(mods_dir) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".jar") || name.ends_with(".zip")
        })
        .filter_map(|e| e.metadata().ok().filter(|m| m.is_file()).map(|m| (e.path(), m.len())))
        .collect()
}

/// The wanted mods that no file in `mods_dir` matches. Only files of the same size are hashed, and each at most once.
fn missing_mods(mods_dir: &Path, wanted: &[ShareModDto], hashed: &mut HashMap<std::path::PathBuf, String>) -> Vec<ShareModDto> {
    let files = mod_files(mods_dir);
    wanted
        .iter()
        .filter(|m| needed_by_client(m))
        .filter(|m| {
            !files.iter().any(|(path, size)| {
                *size == m.size && {
                    if !hashed.contains_key(path) {
                        if let Ok((sha1, _)) = sha1_file(path) {
                            hashed.insert(path.clone(), sha1);
                        }
                    }
                    hashed.get(path).is_some_and(|sha1| *sha1 == m.sha1)
                }
            })
        })
        .cloned()
        .collect()
}

fn needed_by_client(m: &ShareModDto) -> bool {
    m.side != "server"
}

/// The local instance that already fits a shared world (fewest missing mods wins), and the mods it lacks.
#[tauri::command]
pub async fn instance_find_match(spec: ShareSpecDto) -> Result<ShareMatchDto, String> {
    super::blocking(move || {
        let mut best: Option<(String, Vec<ShareModDto>)> = None;
        let mut hashed = HashMap::new();
        for inst in super::instance::list_instances_blocking()? {
            let same_base = inst.version == spec.mc_version && inst.loader.eq_ignore_ascii_case(&spec.loader);
            if !same_base {
                continue;
            }
            let dir = get_instances_dir().join(&inst.id);
            // One unreadable instance must not stop the others from matching.
            let Ok(cfg) = read_instance_config(&dir) else { continue };
            let same_loader = if spec.loader.eq_ignore_ascii_case("custom") {
                match (&spec.custom_jar, resolve_custom_jar(&dir, &cfg)) {
                    (Some(want), Ok((jar, _))) => sha1_file(&jar).map(|(sha1, _)| sha1 == want.sha1).unwrap_or(false),
                    _ => false,
                }
            } else {
                spec.loader_version.is_none() || spec.loader_version == inst.loader_version
            };
            if !same_loader {
                continue;
            }
            let missing = missing_mods(&dir.join("minecraft").join("mods"), &spec.mods, &mut hashed);
            if best.as_ref().is_none_or(|(_, b)| missing.len() < b.len()) {
                best = Some((inst.id, missing));
            }
        }
        Ok(match best {
            Some((id, missing)) => ShareMatchDto { instance_id: Some(id), missing },
            None => ShareMatchDto { instance_id: None, missing: spec.mods.iter().filter(|m| needed_by_client(m)).cloned().collect() },
        })
    })
    .await
}

/// Files this instance's sharer may hand to a guest through the tunnel (sha1 -> path): the custom loader jar.
#[tauri::command]
pub async fn instance_share_files(instance_id: String) -> Result<HashMap<String, String>, String> {
    validate_safe_id(&instance_id)?;
    super::blocking(move || {
        let dir = get_instances_dir().join(&instance_id);
        let cfg = read_instance_config(&dir)?;
        let mut files = HashMap::new();
        if cfg.loader.eq_ignore_ascii_case("custom") {
            let (jar, _) = resolve_custom_jar(&dir, &cfg)?;
            files.insert(sha1_file(&jar)?.0, jar.to_string_lossy().to_string());
        }
        Ok(files)
    })
    .await
}

/// Creates an instance that matches a shared world, named like the sharer's instance. `jar_path` is the custom loader jar
/// fetched through the tunnel; it is verified against the spec before anything is written.
#[tauri::command]
pub async fn instance_create_from_share(spec: ShareSpecDto, jar_path: Option<String>) -> Result<super::instance::InstanceSummaryDto, String> {
    let loader = KNOWN_LOADERS
        .iter()
        .find(|l| l.eq_ignore_ascii_case(&spec.loader))
        .ok_or_else(|| format!("unsupported loader: {}", spec.loader))?
        .to_string();
    if spec.mc_version.trim().is_empty() || spec.instance_name.trim().is_empty() || spec.instance_name.chars().count() > MAX_NAME_CHARS {
        return Err("invalid shared world description".into());
    }
    let (jar_name, jar_bytes) = if loader == "Custom" {
        let want = spec.custom_jar.clone().ok_or("the shared world has no custom jar")?;
        let path = jar_path.ok_or("the custom jar was not received")?;
        if want.size == 0 || want.size > MAX_CUSTOM_JAR_BYTES {
            return Err("the shared custom jar is too large".into());
        }
        let bytes = super::blocking(move || std::fs::read(&path).map_err(|e| format!("cannot read the custom jar: {e}"))).await?;
        if !jar_matches(&want, &bytes) {
            return Err("the received custom jar does not match the shared one".into());
        }
        (Some(want.filename), Some(bytes))
    } else {
        (None, None)
    };

    // Two instances may not share a display name: "Survival", "Survival (2)", ...
    let taken: std::collections::HashSet<String> = super::blocking(super::instance::list_instances_blocking).await?.into_iter().map(|i| i.name).collect();
    let mut name = spec.instance_name.trim().to_string();
    let mut n = 2;
    while taken.contains(&name) {
        name = format!("{} ({n})", spec.instance_name.trim());
        n += 1;
    }
    super::instance::create_instance(name, spec.mc_version, loader, spec.loader_version, None, None, jar_name, jar_bytes).await
}

/// Downloads everything a new instance needs to start (game files, loader, Java) without launching it.
#[tauri::command]
pub async fn instance_provision(app: tauri::AppHandle, instance_id: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let dir = get_instances_dir().join(&instance_id);
    let cfg = super::blocking({
        let dir = dir.clone();
        move || read_instance_config(&dir)
    })
    .await?;
    super::provisioning::ensure_instance_provisioned(&app, &instance_id, &cfg).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mod_dto(name: &str, sha1: &str, size: u64, side: &str) -> ShareModDto {
        ShareModDto { filename: name.into(), sha1: sha1.into(), size, side: side.into(), project_id: None, version_id: None, download_url: None }
    }

    #[test]
    fn custom_jar_must_match_sha1_and_size() {
        let bytes = b"abc";
        let sha1 = "a9993e364706816aba3e25717850c26c9cd0d89d".to_string();
        let want = CustomJarDto { filename: "x.jar".into(), sha1, size: 3 };
        assert!(jar_matches(&want, bytes));
        assert!(!jar_matches(&want, b"abd"));
        assert!(!jar_matches(&CustomJarDto { size: 4, ..want }, bytes));
    }

    #[test]
    fn missing_mods_compares_content_not_names() {
        let dir = std::env::temp_dir().join(format!("focusite-share-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("renamed.jar"), b"abc").unwrap();
        let abc = "a9993e364706816aba3e25717850c26c9cd0d89d";
        let wanted = vec![
            mod_dto("have.jar", abc, 3, "both"),
            mod_dto("other.jar", "f".repeat(40).as_str(), 3, "client"),
            mod_dto("server.jar", "e".repeat(40).as_str(), 9, "server"),
        ];
        let missing = missing_mods(&dir, &wanted, &mut HashMap::new());
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(missing.iter().map(|m| m.filename.as_str()).collect::<Vec<_>>(), vec!["other.jar"]);
    }

    #[test]
    fn side_follows_modrinth_support() {
        assert_eq!(side_of("required", "required"), "both");
        assert_eq!(side_of("required", "unsupported"), "client");
        assert_eq!(side_of("unsupported", "optional"), "server");
        assert_eq!(side_of("unsupported", "unsupported"), "unknown");
    }
}
