//! Imports instances made by other launchers (Prism / MultiMC / PolyMC and PCL) by copying their game files.
//!
//! The source folder is only read: files are copied into a new instance and nothing is moved or deleted.

use super::instance::{
    get_instances_dir, new_disk_config, unique_folder_name, write_instance_config,
};
use super::modpack::ModpackImportResult;
use focusite_modpacks::prism::PrismInstanceCfg;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// What was recognised in a source folder.
#[derive(Debug, PartialEq)]
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
}

fn folder_name(dir: &Path) -> String {
    dir.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()
}

fn detect(dir: &Path) -> Result<Detected, String> {
    if dir.join("mmc-pack.json").is_file() {
        return detect_prism(dir);
    }
    if dir.join(format!("{}.json", folder_name(dir))).is_file() {
        return detect_pcl(dir);
    }
    Err("無法辨識此資料夾：請選擇 Prism Launcher 的實例資料夾（含 mmc-pack.json），或 PCL 的版本資料夾（.minecraft\\versions\\<版本名>）".into())
}

fn detect_prism(dir: &Path) -> Result<Detected, String> {
    let pack: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("mmc-pack.json")).map_err(|e| format!("無法讀取 mmc-pack.json：{e}"))?,
    )
    .map_err(|e| format!("mmc-pack.json 格式錯誤：{e}"))?;

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
        .ok_or("找不到實例的 minecraft 資料夾")?;
    let name = std::fs::read_to_string(dir.join("instance.cfg"))
        .map(|c| PrismInstanceCfg::parse(&c).name)
        .unwrap_or_else(|_| folder_name(dir));

    Ok(Detected {
        name,
        version: version.ok_or("實例沒有指定 Minecraft 版本")?,
        loader,
        loader_version,
        game_dir,
        skip: vec!["logs".into(), "crash-reports".into()],
        only: None,
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
        &std::fs::read_to_string(dir.join(format!("{name}.json"))).map_err(|e| format!("無法讀取版本 JSON：{e}"))?,
    )
    .map_err(|e| format!("版本 JSON 格式錯誤：{e}"))?;

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
    let version = mc_version.ok_or("無法判斷此 PCL 版本的 Minecraft 版本")?;

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
            .ok_or("找不到 PCL 的 .minecraft 資料夾")?
            .to_path_buf();
        (
            root,
            vec![],
            Some(vec!["mods", "config", "resourcepacks", "shaderpacks", "options.txt", "servers.dat"]),
        )
    };

    Ok(Detected { name, version, loader, loader_version, game_dir, skip, only })
}

fn copy_game_files(found: &Detected, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(&found.game_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let wanted = match &found.only {
            Some(only) => only.contains(&name.as_str()),
            None => !found.skip.contains(&name),
        };
        if !wanted {
            continue;
        }
        let to = dst.join(&name);
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            tracing::warn!("匯入時略過符號連結 {}", entry.path().display());
        } else if kind.is_dir() {
            super::copy_dir_all(&entry.path(), &to, true)?;
        } else {
            std::fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

fn import_blocking(source: &Path, custom_name: Option<String>) -> Result<ModpackImportResult, String> {
    import_into(&get_instances_dir(), source, custom_name)
}

fn import_into(base: &Path, source: &Path, custom_name: Option<String>) -> Result<ModpackImportResult, String> {
    let found = detect(source)?;
    let name = custom_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| found.name.clone());

    let folder = unique_folder_name(base, &name)?;
    let inst_dir = base.join(&folder);
    // Importing the instances folder into itself would recurse forever.
    if inst_dir.starts_with(&found.game_dir) {
        return Err("來源資料夾包含目標實例資料夾，請選擇其他來源".into());
    }

    let result = copy_game_files(&found, &inst_dir.join("minecraft"))
        .map_err(|e| format!("複製實例檔案失敗：{e}"))
        .and_then(|_| {
            let cfg = new_disk_config(&folder, &name, &found.version, &found.loader, found.loader_version.clone());
            write_instance_config(&inst_dir, &cfg)
        });
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&inst_dir);
        return Err(e);
    }

    Ok(ModpackImportResult {
        instance_id: folder,
        instance_name: name,
        version: found.version,
        loader: found.loader,
        missing_mods: Vec::new(),
        is_completed: true,
    })
}

/// Copies a Prism / PCL instance folder into a new instance.
pub async fn import_instance_dir(source: PathBuf, custom_name: Option<String>) -> Result<ModpackImportResult, String> {
    super::blocking(move || import_blocking(&source, custom_name)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("fc_li_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
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
        let res = import_into(&base, &src, None).unwrap();
        assert_eq!((res.instance_id.as_str(), res.version.as_str(), res.loader.as_str()), ("Imported", "1.20.1", "Vanilla"));
        let inst = base.join("Imported");
        assert!(inst.join("minecraft").join("mods").join("a.jar").is_file());
        assert!(!inst.join("minecraft").join("logs").exists(), "logs are skipped");
        assert!(inst.join(super::super::instance::INSTANCE_CONFIG_FILE).is_file());
        assert!(src.join(".minecraft").join("mods").join("a.jar").is_file(), "source is untouched");

        // A second import of the same name gets a new folder instead of overwriting.
        assert_eq!(import_into(&base, &src, None).unwrap().instance_id, "Imported (2)");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unknown_folder_is_rejected() {
        let root = temp();
        assert!(detect(&root).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
