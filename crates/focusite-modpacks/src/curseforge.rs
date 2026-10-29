//! CurseForge modpack manifest (manifest.json) schema and extraction engine.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use zip::ZipArchive;
use crate::mrpack::safe_extract_entry;
use crate::ModpackError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeManifest {
    pub minecraft: CurseForgeMinecraftSpec,
    #[serde(rename = "manifestType")]
    pub manifest_type: String,
    #[serde(rename = "manifestVersion")]
    pub manifest_version: u32,
    pub name: String,
    pub version: String,
    pub author: String,
    pub files: Vec<CurseForgeFileRef>,
    pub overrides: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeMinecraftSpec {
    pub version: String,
    #[serde(rename = "modLoaders")]
    pub mod_loaders: Vec<CurseForgeModLoaderEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeModLoaderEntry {
    pub id: String,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeFileRef {
    #[serde(rename = "projectID")]
    pub project_id: u32,
    #[serde(rename = "fileID")]
    pub file_id: u32,
    pub required: bool,
}

/// Information about a missing CurseForge mod that cannot be downloaded automatically.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MissingModItem {
    #[serde(rename = "projectId")]
    pub project_id: u32,
    #[serde(rename = "fileId")]
    pub file_id: u32,
    pub name: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "webUrl")]
    pub web_url: String,
}

/// Parses an HTML modlist to extract project name and URL mappings.
pub fn parse_modlist_html(html: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    // Simple robust tag parser for <li><a href="...">Name</a></li>
    for part in html.split("<li") {
        if let Some(href_start) = part.find("href=\"") {
            let after_href = &part[href_start + 6..];
            if let Some(href_end) = after_href.find('"') {
                let url = after_href[..href_end].to_string();
                if let Some(tag_end) = after_href.find('>') {
                    let after_tag = &after_href[tag_end + 1..];
                    if let Some(close_tag) = after_tag.find("</a>") {
                        let name = after_tag[..close_tag].trim().to_string();
                        if !name.is_empty() {
                            map.insert(url, name);
                        }
                    }
                }
            }
        }
    }
    map
}

/// Unpacks a CurseForge modpack archive into `minecraft_dir`.
/// Extracts `overrides/` (or custom overrides directory) with Zip-Slip protection.
#[allow(clippy::type_complexity)]
pub fn unpack_curseforge_pack(
    archive_bytes: &[u8],
    minecraft_dir: &Path,
) -> Result<(CurseForgeManifest, HashMap<String, String>, Vec<PathBuf>), ModpackError> {
    let mut zip = ZipArchive::new(Cursor::new(archive_bytes))
        .map_err(|e| ModpackError::InvalidArchive(format!("Failed to open zip archive: {}", e)))?;

    // 1. Read manifest.json
    let manifest: CurseForgeManifest = {
        let mut manifest_file = zip
            .by_name("manifest.json")
            .map_err(|_| ModpackError::InvalidArchive("Missing manifest.json".into()))?;
        let mut content = String::new();
        manifest_file.read_to_string(&mut content)?;
        serde_json::from_str(&content)?
    };

    // 2. Read optional modlist.html
    let mut modlist_map = HashMap::new();
    if let Ok(mut modlist_file) = zip.by_name("modlist.html") {
        let mut html = String::new();
        if modlist_file.read_to_string(&mut html).is_ok() {
            modlist_map = parse_modlist_html(&html);
        }
    }

    let overrides_prefix = manifest.overrides.clone().unwrap_or_else(|| "overrides".into());
    let overrides_prefix = format!("{}/", overrides_prefix.trim_end_matches('/'));

    let mut extracted = Vec::new();

    // 3. Extract overrides
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
        let name = file.name().to_string();

        if let Some(rel_path) = name.strip_prefix(&overrides_prefix) {
            if rel_path.is_empty() || file.is_dir() {
                continue;
            }
            let path = safe_extract_entry(rel_path, &mut file, minecraft_dir)?;
            extracted.push(path);
        }
    }

    Ok((manifest, modlist_map, extracted))
}

/// Scans the instance's mods directory to determine which missing mods have been downloaded.
/// Uses greedy 1-to-1 matching across filename, prefix, mod name, and CurseForge IDs.
pub fn rescan_missing_mods(
    minecraft_dir: &Path,
    current_missing: &[MissingModItem],
) -> Vec<MissingModItem> {
    let mods_dir = minecraft_dir.join("mods");
    if !mods_dir.is_dir() {
        return current_missing.to_vec();
    }

    let mut existing_files: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ext_str == "jar" || ext_str == "disabled" {
                        let fname = path
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_lowercase();
                        existing_files.push(fname);
                    }
                }
            }
        }
    }

    let mut claimed = vec![false; existing_files.len()];
    let mut remaining = Vec::new();

    for item in current_missing {
        let target = item.file_name.to_lowercase();
        let target_no_ext = target.trim_end_matches(".jar").trim_end_matches(".disabled");
        let name_clean = item.name.to_lowercase().replace(' ', "-");
        let file_id_str = item.file_id.to_string();
        let project_id_str = item.project_id.to_string();

        let mut matched_idx = None;

        for (idx, fname) in existing_files.iter().enumerate() {
            if claimed[idx] {
                continue;
            }

            let is_match = fname == &target
                || fname.starts_with(target_no_ext)
                || (!name_clean.is_empty() && fname.contains(&name_clean))
                || (!file_id_str.is_empty() && fname.contains(&file_id_str))
                || (!project_id_str.is_empty() && fname.contains(&project_id_str));

            if is_match {
                matched_idx = Some(idx);
                break;
            }
        }

        if let Some(idx) = matched_idx {
            claimed[idx] = true;
        } else {
            remaining.push(item.clone());
        }
    }

    remaining
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn test_parse_modlist_html() {
        let html = r#"
        <ul>
            <li><a href="https://www.curseforge.com/minecraft/mc-mods/jei">Just Enough Items (JEI)</a></li>
            <li><a href="https://www.curseforge.com/projects/238222">AppleSkin</a></li>
        </ul>
        "#;
        let map = parse_modlist_html(html);
        assert_eq!(map.get("https://www.curseforge.com/minecraft/mc-mods/jei").unwrap(), "Just Enough Items (JEI)");
        assert_eq!(map.get("https://www.curseforge.com/projects/238222").unwrap(), "AppleSkin");
    }

    #[test]
    fn test_unpack_curseforge_pack_in_memory() {
        let temp_dir = std::env::temp_dir().join(format!("focusite_cf_test_{}", uuid::Uuid::new_v4()));
        let mc_dir = temp_dir.join("minecraft");
        std::fs::create_dir_all(&mc_dir).unwrap();

        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = SimpleFileOptions::default();

            zip.start_file("manifest.json", options).unwrap();
            let manifest_json = r#"{
                "minecraft": {
                    "version": "1.20.1",
                    "modLoaders": [{"id": "forge-47.2.0", "primary": true}]
                },
                "manifestType": "minecraftModpack",
                "manifestVersion": 1,
                "name": "Test CF Pack",
                "version": "1.0",
                "author": "Tester",
                "files": [
                    {"projectID": 238222, "fileID": 456789, "required": true}
                ],
                "overrides": "overrides"
            }"#;
            zip.write_all(manifest_json.as_bytes()).unwrap();

            zip.start_file("overrides/config/test.cfg", options).unwrap();
            zip.write_all(b"enable=true\n").unwrap();

            zip.finish().unwrap();
        }

        let (manifest, _, overrides) = unpack_curseforge_pack(&buf, &mc_dir).unwrap();
        assert_eq!(manifest.name, "Test CF Pack");
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(overrides.len(), 1);
        assert!(mc_dir.join("config/test.cfg").is_file());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rescan_missing_mods() {
        let temp_dir = std::env::temp_dir().join(format!("focusite_rescan_test_{}", uuid::Uuid::new_v4()));
        let mods_dir = temp_dir.join("mods");
        std::fs::create_dir_all(&mods_dir).unwrap();

        let missing = vec![
            MissingModItem {
                project_id: 1,
                file_id: 10,
                name: "JEI".into(),
                file_name: "jei-1.20.1.jar".into(),
                web_url: "https://curseforge.com/projects/1".into(),
            },
            MissingModItem {
                project_id: 2,
                file_id: 20,
                name: "AppleSkin".into(),
                file_name: "appleskin-forge.jar".into(),
                web_url: "https://curseforge.com/projects/2".into(),
            },
        ];

        // Initially neither exists
        let remaining1 = rescan_missing_mods(&temp_dir, &missing);
        assert_eq!(remaining1.len(), 2);

        // Create jei-1.20.1.jar
        std::fs::write(mods_dir.join("jei-1.20.1.jar"), b"dummy").unwrap();

        let remaining2 = rescan_missing_mods(&temp_dir, &missing);
        assert_eq!(remaining2.len(), 1);
        assert_eq!(remaining2[0].name, "AppleSkin");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
