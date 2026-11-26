//! Imports instances made by other launchers (Prism / MultiMC / PolyMC and PCL) or by this one, by copying their
//! game files and carrying over the settings that can be read from them.
//!
//! The source folder is only read: files are copied into a new instance and nothing is moved or deleted.

use super::import_support::{ensure_free_space, JobSession};
use super::instance::{
    get_instances_dir, new_disk_config, read_instance_config, unique_folder_name, write_instance_config,
    InstanceDiskConfig, INSTANCE_CONFIG_FILE,
};
use super::instance_transfer::{describe_settings, overlay_settings, read_limited, store_background_bytes};
use super::modpack::{ModpackImportResult, PackInspection};
use focusite_modpacks::prism::PrismInstanceCfg;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Settings and assets found next to the game files of a source instance.
#[derive(Debug, Default)]
struct Extras {
    jvm_args: Option<Vec<String>>,
    min_memory_mb: Option<u32>,
    max_memory_mb: Option<u32>,
    java_path: Option<String>,
    window: Option<(u32, u32)>,
    description: Option<String>,
    icon: Option<PathBuf>,
    background: Option<PathBuf>,
}

/// What was recognised in a source folder.
#[derive(Debug)]
struct Detected {
    name: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
    /// Folder whose files are copied into the new instance's `minecraft` folder.
    game_dir: PathBuf,
    /// Top-level entries that are not copied.
    skip: Vec<String>,
    /// When set, only these top-level entries are copied (non-isolated PCL versions share one `.minecraft`).
    only: Option<Vec<&'static str>>,
    extras: Extras,
    /// The source is one of our own instance folders: all its settings carry over.
    focusite: Option<InstanceDiskConfig>,
}

fn folder_name(dir: &Path) -> String {
    dir.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
}

fn detect(dir: &Path) -> Result<Detected, String> {
    if dir.join(INSTANCE_CONFIG_FILE).is_file() {
        return detect_focusite(dir);
    }
    if dir.join("mmc-pack.json").is_file() {
        return detect_prism(dir);
    }
    if dir.join(format!("{}.json", folder_name(dir))).is_file() {
        return detect_pcl(dir);
    }
    Err("E_IMPORT_UNKNOWN_FOLDER".into())
}

fn detect_focusite(dir: &Path) -> Result<Detected, String> {
    let cfg = read_instance_config(dir)?;
    let game_dir = dir.join("minecraft");
    if !game_dir.is_dir() {
        return Err("E_IMPORT_NO_MC_FOLDER".into());
    }
    let extras = Extras {
        icon: Some(dir.join("icon.png")).filter(|p| p.is_file()),
        background: cfg.background_source.as_deref().map(|f| dir.join(f)).filter(|p| p.is_file()),
        ..Default::default()
    };
    Ok(Detected {
        name: cfg.name.clone(),
        version: cfg.version.clone(),
        loader: cfg.loader.clone(),
        loader_version: cfg.loader_version.clone(),
        game_dir,
        skip: vec!["logs".into(), "crash-reports".into()],
        only: None,
        extras,
        focusite: Some(cfg),
    })
}

/// Icon of a Prism instance: one inside the instance folder, or a custom one in Prism's shared `icons` folder.
fn prism_icon(dir: &Path, icon_key: Option<&str>) -> Option<PathBuf> {
    let own = [dir.join("icon.png"), dir.join(".minecraft").join("icon.png"), dir.join("minecraft").join("icon.png")];
    if let Some(p) = own.into_iter().find(|p| p.is_file()) {
        return Some(p);
    }
    let key = icon_key.filter(|k| !k.is_empty() && !k.contains(['/', '\\', ':']) && *k != "..")?;
    let icons = dir.parent()?.parent()?.join("icons");
    ["png", "jpg", "jpeg"].iter().map(|e| icons.join(format!("{key}.{e}"))).find(|p| p.is_file())
}

fn detect_prism(dir: &Path) -> Result<Detected, String> {
    let pack: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("mmc-pack.json")).map_err(|e| format!("E_IMPORT_PACK_JSON_UNREADABLE: {e}"))?,
    )
    .map_err(|e| format!("E_IMPORT_PACK_JSON_INVALID: {e}"))?;

    let mut version = None;
    let (mut loader, mut loader_version) = ("Vanilla".to_string(), None);
    for c in pack["components"].as_array().into_iter().flatten() {
        let (Some(uid), Some(v)) = (c["uid"].as_str(), c["version"].as_str()) else { continue };
        let found = match uid {
            "net.minecraft" => {
                version = Some(v.to_string());
                None
            }
            "net.fabricmc.fabric-loader" => Some("Fabric"),
            "org.quiltmc.quilt-loader" => Some("Quilt"),
            "net.neoforged" => Some("NeoForge"),
            "net.minecraftforge" => Some("Forge"),
            _ => None,
        };
        if let Some(l) = found {
            loader = l.into();
            loader_version = Some(v.to_string());
        }
    }

    let game_dir = [".minecraft", "minecraft"]
        .iter()
        .map(|d| dir.join(d))
        .find(|p| p.is_dir())
        .ok_or("E_IMPORT_NO_MC_FOLDER")?;
    let cfg = std::fs::read_to_string(dir.join("instance.cfg")).ok().map(|c| PrismInstanceCfg::parse(&c));
    let name = cfg.as_ref().map(|c| c.name.clone()).unwrap_or_else(|| folder_name(dir));
    let extras = cfg
        .as_ref()
        .map(|c| Extras {
            jvm_args: c.jvm_args.as_deref().map(|a| a.split_whitespace().map(str::to_string).collect()),
            min_memory_mb: c.min_memory_mb,
            max_memory_mb: c.max_memory_mb,
            java_path: c.java_path.clone(),
            window: c.window_width.zip(c.window_height),
            description: c.notes.clone().filter(|n| !n.trim().is_empty()),
            icon: prism_icon(dir, c.icon_key.as_deref()),
            background: None,
        })
        .unwrap_or_default();

    Ok(Detected {
        name,
        version: version.ok_or("E_IMPORT_NO_MC_VERSION")?,
        loader,
        loader_version,
        game_dir,
        skip: vec!["logs".into(), "crash-reports".into()],
        only: None,
        extras,
        focusite: None,
    })
}

/// Splits a Maven coordinate `group:artifact:version`.
fn parse_library(name: &str) -> Option<(&str, &str, &str)> {
    let mut parts = name.split(':');
    Some((parts.next()?, parts.next()?, parts.next()?))
}

/// Forge-style versions are `<mc>-<loader>[-<mc>]`; returns `(mc, loader)`.
fn split_forge_version(v: &str) -> Option<(&str, &str)> {
    let mut it = v.split('-');
    Some((it.next()?, it.next()?))
}

fn detect_pcl(dir: &Path) -> Result<Detected, String> {
    let name = folder_name(dir);
    let json: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join(format!("{name}.json"))).map_err(|e| format!("E_IMPORT_VERSION_JSON_UNREADABLE: {e}"))?,
    )
    .map_err(|e| format!("E_IMPORT_VERSION_JSON_INVALID: {e}"))?;

    let mut mc_version = json["inheritsFrom"]
        .as_str()
        .or_else(|| json["clientVersion"].as_str())
        .or_else(|| json["jar"].as_str())
        .map(str::to_string);
    let (mut loader, mut loader_version) = ("Vanilla".to_string(), None);

    for lib in json["libraries"].as_array().into_iter().flatten() {
        let Some((group, artifact, v)) = lib["name"].as_str().and_then(parse_library) else { continue };
        match (group, artifact) {
            ("net.fabricmc", "fabric-loader") => {
                loader = "Fabric".into();
                loader_version = Some(v.to_string());
            }
            ("net.fabricmc", "intermediary") => {
                mc_version.get_or_insert_with(|| v.to_string());
            }
            ("org.quiltmc", "quilt-loader") => {
                loader = "Quilt".into();
                loader_version = Some(v.to_string());
            }
            ("net.neoforged", "neoforge") => {
                loader = "NeoForge".into();
                loader_version = Some(v.to_string());
            }
            ("net.neoforged", "forge") | ("net.minecraftforge", "forge") | ("net.minecraftforge", "fmlloader") => {
                if let Some((mc, lv)) = split_forge_version(v) {
                    loader = if group == "net.neoforged" { "NeoForge" } else { "Forge" }.into();
                    loader_version = Some(lv.to_string());
                    mc_version.get_or_insert_with(|| mc.to_string());
                }
            }
            _ => {}
        }
    }
    // A vanilla version keeps its Minecraft version as the JSON id when PCL did not rename it.
    if mc_version.is_none() {
        mc_version = json["id"]
            .as_str()
            .filter(|id| id.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .map(str::to_string);
    }
    let version = mc_version.ok_or("E_IMPORT_PCL_NO_MC_VERSION")?;

    // PCL "version isolation" keeps mods/saves inside the version folder; otherwise they live in the shared
    // `.minecraft`, where only the settings and packs that belong to a setup are taken.
    let isolated = ["mods", "saves", "options.txt", "config"].iter().any(|e| dir.join(e).exists());
    let (game_dir, skip, only) = if isolated {
        (
            dir.to_path_buf(),
            vec![
                format!("{name}.json"),
                format!("{name}.jar"),
                format!("{name}-natives"),
                "natives".into(),
                "PCL".into(),
                "logs".into(),
                "crash-reports".into(),
            ],
            None,
        )
    } else {
        let root = dir
            .parent()
            .and_then(Path::parent)
            .ok_or("E_IMPORT_PCL_NO_ROOT")?
            .to_path_buf();
        (
            root,
            vec![],
            Some(vec!["mods", "config", "resourcepacks", "shaderpacks", "options.txt", "servers.dat"]),
        )
    };

    let extras = pcl_extras(dir);
    Ok(Detected { name, version, loader, loader_version, game_dir, skip, only, extras, focusite: None })
}

/// PCL keeps per-version settings in `PCL\Setup.ini` (`Key:Value` lines) and a custom logo in `PCL\Logo.png`.
// shortcut: key names follow PCL's own files as far as known (only the JVM arguments are read); extend when
// more keys are verified against a real PCL install.
fn pcl_extras(dir: &Path) -> Extras {
    let pcl = dir.join("PCL");
    let jvm_args = std::fs::read_to_string(pcl.join("Setup.ini")).ok().and_then(|text| {
        text.lines().find_map(|l| {
            let (k, v) = l.split_once(':').or_else(|| l.split_once('='))?;
            (k.trim() == "VersionAdvanceJvm" && !v.trim().is_empty())
                .then(|| v.split_whitespace().map(str::to_string).collect::<Vec<_>>())
        })
    });
    Extras { jvm_args, icon: Some(pcl.join("Logo.png")).filter(|p| p.is_file()), ..Default::default() }
}

fn wanted(found: &Detected, name: &str) -> bool {
    match &found.only {
        Some(only) => only.contains(&name),
        None => !found.skip.iter().any(|s| s == name),
    }
}

/// Counts the files and bytes that would be copied (symbolic links are skipped, as when copying).
fn scan_tree(path: &Path, files: &mut u64, bytes: &mut u64) {
    let Ok(rd) = std::fs::read_dir(path) else { return };
    for e in rd.flatten() {
        match e.file_type() {
            Ok(t) if t.is_symlink() => {}
            Ok(t) if t.is_dir() => scan_tree(&e.path(), files, bytes),
            Ok(_) => {
                *files += 1;
                *bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
            Err(_) => {}
        }
    }
}

fn measure(found: &Detected) -> Result<(u64, u64), String> {
    let (mut files, mut bytes) = (0, 0);
    let rd = std::fs::read_dir(&found.game_dir).map_err(|e| format!("E_IMPORT_SOURCE_UNREADABLE: {e}"))?;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !wanted(found, &name) {
            continue;
        }
        match e.file_type() {
            Ok(t) if t.is_symlink() => {}
            Ok(t) if t.is_dir() => scan_tree(&e.path(), &mut files, &mut bytes),
            Ok(_) => {
                files += 1;
                bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            }
            Err(_) => {}
        }
    }
    Ok((files, bytes))
}

struct CopyProgress<'a> {
    session: &'a JobSession,
    total_files: u64,
    total_bytes: u64,
    done_files: u64,
    done_bytes: u64,
    started: Instant,
    last_emit: Instant,
}

impl CopyProgress<'_> {
    fn file_done(&mut self, name: &str, size: u64) {
        self.done_files += 1;
        self.done_bytes += size;
        if self.last_emit.elapsed().as_millis() >= 100 || self.done_files == self.total_files {
            let speed = (self.done_bytes as f64 / self.started.elapsed().as_secs_f64().max(0.001)) as u64;
            self.session.emit_full("copy", name, self.done_bytes, self.total_bytes, speed, None);
            self.last_emit = Instant::now();
        }
    }
}

fn copy_tree(src: &Path, dst: &Path, p: &mut CopyProgress) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))? {
        let entry = entry.map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
        p.session.check()?;
        let to = dst.join(entry.file_name());
        let kind = entry.file_type().map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
        if kind.is_symlink() {
            tracing::warn!("Skipping symlink during import: {}", entry.path().display());
        } else if kind.is_dir() {
            copy_tree(&entry.path(), &to, p)?;
        } else {
            let size = std::fs::copy(entry.path(), &to).map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
            p.file_done(&entry.file_name().to_string_lossy(), size);
        }
    }
    Ok(())
}

fn copy_game_files(found: &Detected, dst: &Path, session: &JobSession, total: (u64, u64)) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
    let mut p = CopyProgress {
        session,
        total_files: total.0,
        total_bytes: total.1,
        done_files: 0,
        done_bytes: 0,
        started: Instant::now(),
        last_emit: Instant::now(),
    };
    session.emit("copy", "", 0, total.1);
    for entry in std::fs::read_dir(&found.game_dir).map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))? {
        let entry = entry.map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
        session.check()?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !wanted(found, &name) {
            continue;
        }
        let to = dst.join(&name);
        let kind = entry.file_type().map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
        if kind.is_symlink() {
            tracing::warn!("Skipping symlink during import: {}", entry.path().display());
        } else if kind.is_dir() {
            copy_tree(&entry.path(), &to, &mut p)?;
        } else {
            let size = std::fs::copy(entry.path(), to).map_err(|e| format!("E_IMPORT_COPY_FAILED: {e}"))?;
            p.file_done(&name, size);
        }
    }
    Ok(())
}

/// Carries the source's settings over to `cfg` and returns what was taken.
fn apply_settings(found: &Detected, cfg: &mut InstanceDiskConfig) -> Vec<String> {
    let mut imported = vec!["overrides".to_string()];
    if let Some(src) = &found.focusite {
        overlay_settings(cfg, src);
        cfg.is_favorite = false;
        imported.extend(describe_settings(cfg));
        return imported;
    }
    let x = &found.extras;
    if let Some(args) = x.jvm_args.as_ref().filter(|a| !a.is_empty()) {
        cfg.custom_jvm_args = Some(args.clone());
        imported.push("jvm".into());
    }
    if x.min_memory_mb.is_some() || x.max_memory_mb.is_some() {
        let max = x.max_memory_mb.unwrap_or(cfg.max_memory_mb).clamp(512, 65536);
        cfg.max_memory_mb = max;
        cfg.min_memory_mb = x.min_memory_mb.unwrap_or(cfg.min_memory_mb).clamp(256, max);
        imported.push("memory".into());
    }
    // A Java from another launcher's folder is only kept when it still exists.
    if let Some(java) = x.java_path.as_ref().filter(|p| Path::new(p).exists()) {
        cfg.java_path = Some(java.clone());
        imported.push("java".into());
    }
    if let Some((w, h)) = x.window.filter(|(w, h)| *w >= 200 && *h >= 200) {
        cfg.window_width = Some(w);
        cfg.window_height = Some(h);
        imported.push("window".into());
    }
    if let Some(desc) = &x.description {
        cfg.description = Some(desc.clone());
        imported.push("description".into());
    }
    imported
}

/// Copies the source's icon and background into the new instance folder.
fn copy_assets(found: &Detected, inst_dir: &Path, cfg: &mut InstanceDiskConfig) -> Vec<String> {
    let mut imported = Vec::new();
    if let Some(icon) = &found.extras.icon {
        let saved = image::ImageReader::open(icon)
            .ok()
            .and_then(|r| r.with_guessed_format().ok())
            .and_then(|r| r.decode().ok())
            .map(|img| img.resize_exact(256, 256, image::imageops::FilterType::Lanczos3))
            .is_some_and(|img| img.save(inst_dir.join("icon.png")).is_ok());
        if saved {
            cfg.icon_source = Some("import".into());
            cfg.icon_updated_at = Some(chrono::Utc::now().timestamp_millis());
            imported.push("icon".to_string());
        }
    }
    if let Some(bg) = &found.extras.background {
        let ext = bg.extension().and_then(|e| e.to_str()).unwrap_or_default();
        if let Ok(name) = read_limited(bg, 20 * 1024 * 1024).and_then(|b| store_background_bytes(inst_dir, ext, &b)) {
            cfg.background_source = Some(name);
            imported.push("background".into());
        }
    }
    imported
}

fn import_blocking(source: &Path, custom_name: Option<String>, session: &JobSession) -> Result<ModpackImportResult, String> {
    import_into(&get_instances_dir(), source, custom_name, session)
}

fn import_into(
    base: &Path,
    source: &Path,
    custom_name: Option<String>,
    session: &JobSession,
) -> Result<ModpackImportResult, String> {
    session.emit("read", "", 0, 0);
    let found = detect(source)?;
    let name = custom_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| found.name.clone());

    let folder = unique_folder_name(base, &name)?;
    let inst_dir = base.join(&folder);
    // Importing the instances folder into itself would recurse forever.
    if inst_dir.starts_with(&found.game_dir) {
        return Err("E_IMPORT_SOURCE_CONTAINS_TARGET".into());
    }
    let total = measure(&found)?;
    ensure_free_space(base, total.1 / 10 * 11)?;
    session.check()?;

    let result = copy_game_files(&found, &inst_dir.join("minecraft"), session, total).and_then(|_| {
        let mut cfg = new_disk_config(&folder, &name, &found.version, &found.loader, found.loader_version.clone());
        let mut imported = apply_settings(&found, &mut cfg);
        imported.extend(copy_assets(&found, &inst_dir, &mut cfg));
        write_instance_config(&inst_dir, &cfg)?;
        Ok(imported)
    });
    let imported = match result {
        Ok(i) => i,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&inst_dir);
            return Err(e);
        }
    };
    session.emit("done", "", 1, 1);

    Ok(ModpackImportResult {
        instance_id: folder,
        instance_name: name,
        version: found.version,
        loader: found.loader,
        missing_mods: Vec::new(),
        is_completed: true,
        imported,
    })
}

/// Copies a Prism / PCL / Focusite instance folder into a new instance.
pub async fn import_instance_dir(
    session: &JobSession,
    source: PathBuf,
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let session = session.clone();
    super::blocking(move || import_blocking(&source, custom_name, &session)).await
}

/// Describes a source instance folder without copying anything.
pub fn inspect_dir(source: &Path, custom_name: Option<String>) -> Result<PackInspection, String> {
    let found = detect(source)?;
    let (file_count, size_bytes) = measure(&found)?;
    let name = custom_name.unwrap_or_else(|| found.name.clone());
    let mut probe = new_disk_config("", &name, &found.version, &found.loader, None);
    let mut imported = apply_settings(&found, &mut probe);
    if found.extras.icon.is_some() {
        imported.push("icon".into());
    }
    if found.extras.background.is_some() {
        imported.push("background".into());
    }
    Ok(PackInspection {
        format: "folder".into(),
        folder_name: unique_folder_name(&get_instances_dir(), &name)?,
        name,
        version: found.version,
        loader: found.loader,
        loader_version: found.loader_version,
        file_count: file_count as usize,
        size_bytes,
        imported,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::import_support::cancel_job;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("fc_li_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn session() -> JobSession {
        JobSession::new(None, None)
    }

    #[test]
    fn detects_prism_instance() {
        let root = temp();
        std::fs::create_dir_all(root.join(".minecraft").join("mods")).unwrap();
        std::fs::write(root.join("instance.cfg"), "name=My Pack\n").unwrap();
        std::fs::write(
            root.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.15.7"}]}"#,
        )
        .unwrap();
        let d = detect(&root).unwrap();
        assert_eq!((d.name.as_str(), d.version.as_str(), d.loader.as_str()), ("My Pack", "1.20.1", "Fabric"));
        assert_eq!(d.loader_version.as_deref(), Some("0.15.7"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn detects_pcl_forge_and_isolation() {
        let root = temp();
        let ver = root.join(".minecraft").join("versions").join("Pack");
        std::fs::create_dir_all(ver.join("mods")).unwrap();
        std::fs::write(
            ver.join("Pack.json"),
            r#"{"id":"Pack","libraries":[{"name":"net.minecraftforge:forge:1.20.1-47.2.0"}]}"#,
        )
        .unwrap();
        let d = detect(&ver).unwrap();
        assert_eq!((d.version.as_str(), d.loader.as_str()), ("1.20.1", "Forge"));
        assert_eq!(d.loader_version.as_deref(), Some("47.2.0"));
        assert_eq!(d.game_dir, ver);
        assert!(d.skip.contains(&"Pack.json".to_string()));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pcl_without_isolation_uses_shared_minecraft_and_vanilla_id() {
        let root = temp();
        let ver = root.join(".minecraft").join("versions").join("1.20.4");
        std::fs::create_dir_all(&ver).unwrap();
        std::fs::write(ver.join("1.20.4.json"), r#"{"id":"1.20.4","libraries":[]}"#).unwrap();
        let d = detect(&ver).unwrap();
        assert_eq!((d.version.as_str(), d.loader.as_str()), ("1.20.4", "Vanilla"));
        assert_eq!(d.game_dir, root.join(".minecraft"));
        assert!(d.only.is_some());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pcl_jvm_args_are_read_from_setup_ini() {
        let root = temp();
        std::fs::create_dir_all(root.join("PCL")).unwrap();
        std::fs::write(root.join("PCL").join("Setup.ini"), "VersionAdvanceJvm:-Xss4m -Dx=y\nOther:1\n").unwrap();
        assert_eq!(pcl_extras(&root).jvm_args, Some(vec!["-Xss4m".to_string(), "-Dx=y".to_string()]));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn import_copies_files_and_leaves_source_untouched() {
        let root = temp();
        let src = root.join("src-inst");
        std::fs::create_dir_all(src.join(".minecraft").join("mods")).unwrap();
        std::fs::write(src.join(".minecraft").join("mods").join("a.jar"), "x").unwrap();
        std::fs::write(src.join(".minecraft").join("options.txt"), "o").unwrap();
        std::fs::create_dir_all(src.join(".minecraft").join("logs")).unwrap();
        std::fs::write(src.join("instance.cfg"), "name=Imported\n").unwrap();
        std::fs::write(
            src.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"}]}"#,
        )
        .unwrap();

        let base = root.join("instances");
        let s = session();
        let res = import_into(&base, &src, None, &s).unwrap();
        assert_eq!((res.instance_id.as_str(), res.version.as_str(), res.loader.as_str()), ("Imported", "1.20.1", "Vanilla"));
        let inst = base.join("Imported");
        assert!(inst.join("minecraft").join("mods").join("a.jar").is_file());
        assert!(!inst.join("minecraft").join("logs").exists(), "logs are skipped");
        assert!(inst.join(INSTANCE_CONFIG_FILE).is_file());
        assert!(src.join(".minecraft").join("mods").join("a.jar").is_file(), "source is untouched");

        // A second import of the same name gets a new folder instead of overwriting.
        assert_eq!(import_into(&base, &src, None, &s).unwrap().instance_id, "Imported (2)");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn prism_settings_and_icon_come_along() {
        let root = temp();
        let src = root.join("instances").join("Fancy");
        std::fs::create_dir_all(src.join(".minecraft")).unwrap();
        std::fs::write(
            src.join("instance.cfg"),
            "name=Fancy\nnotes=Hello\nOverrideJavaArgs=true\nJvmArgs=-Xss4m\nOverrideMemory=true\n\
             MinMemAlloc=1024\nMaxMemAlloc=6144\nOverrideWindow=true\nMinecraftWinWidth=1280\nMinecraftWinHeight=720\n",
        )
        .unwrap();
        std::fs::write(
            src.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"}]}"#,
        )
        .unwrap();
        let mut png = Vec::new();
        image::DynamicImage::new_rgba8(4, 4)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        std::fs::write(src.join("icon.png"), png).unwrap();

        let base = root.join("out");
        let res = import_into(&base, &src, None, &session()).unwrap();
        for k in ["jvm", "memory", "window", "icon", "description"] {
            assert!(res.imported.contains(&k.to_string()), "{k}");
        }
        let cfg = read_instance_config(&base.join("Fancy")).unwrap();
        assert_eq!(cfg.custom_jvm_args, Some(vec!["-Xss4m".to_string()]));
        assert_eq!((cfg.min_memory_mb, cfg.max_memory_mb), (1024, 6144));
        assert_eq!((cfg.window_width, cfg.window_height), (Some(1280), Some(720)));
        assert_eq!(cfg.description.as_deref(), Some("Hello"));
        assert!(base.join("Fancy").join("icon.png").is_file());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn focusite_instance_folder_keeps_settings_icon_and_background() {
        let root = temp();
        let src = root.join("Src");
        std::fs::create_dir_all(src.join("minecraft").join("mods")).unwrap();
        std::fs::write(src.join("minecraft").join("mods").join("a.jar"), "x").unwrap();
        let mut png = Vec::new();
        image::DynamicImage::new_rgba8(4, 4)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        std::fs::write(src.join("icon.png"), &png).unwrap();
        std::fs::write(src.join("background.png"), &png).unwrap();
        let mut cfg = new_disk_config("Src", "Src", "1.21.4", "Vanilla", None);
        cfg.max_memory_mb = 8192;
        cfg.custom_jvm_args = Some(vec!["-Xss8m".into()]);
        cfg.background_source = Some("background.png".into());
        cfg.total_play_time_ms = 5000;
        write_instance_config(&src, &cfg).unwrap();

        let base = root.join("out");
        let res = import_into(&base, &src, Some("Copy".into()), &session()).unwrap();
        for k in ["jvm", "memory", "icon", "background"] {
            assert!(res.imported.contains(&k.to_string()), "{k}");
        }
        let got = read_instance_config(&base.join("Copy")).unwrap();
        assert_eq!((got.max_memory_mb, got.total_play_time_ms), (8192, 0));
        assert_eq!(got.background_source.as_deref(), Some("background.png"));
        assert!(base.join("Copy").join("background.png").is_file());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cancelled_import_leaves_no_folder_behind() {
        let root = temp();
        let src = root.join("Cancel");
        std::fs::create_dir_all(src.join(".minecraft").join("mods")).unwrap();
        std::fs::write(src.join(".minecraft").join("mods").join("a.jar"), "x").unwrap();
        std::fs::write(src.join("mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"}]}"#).unwrap();
        let base = root.join("out");
        let s = JobSession::new(None, Some("li-cancel".into()));
        cancel_job("li-cancel".into());
        assert!(import_into(&base, &src, None, &s).is_err());
        assert!(!base.join("Cancel").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unknown_folder_is_rejected() {
        let root = temp();
        assert!(detect(&root).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
