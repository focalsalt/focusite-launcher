//! Modrinth modpack index (modrinth.index.json) schema and extraction engine.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use zip::ZipArchive;
use crate::ModpackError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthIndex {
    #[serde(rename = "formatVersion")]
    pub format_version: u32,
    pub game: String,
    #[serde(rename = "versionId")]
    pub version_id: String,
    pub name: String,
    pub summary: Option<String>,
    pub files: Vec<ModrinthFileEntry>,
    pub dependencies: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthFileEntry {
    pub path: String,
    pub hashes: HashMap<String, String>,
    pub env: Option<ModrinthEnv>,
    pub downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthEnv {
    pub client: Option<String>,
    pub server: Option<String>,
}

/// Safely extracts a zip entry preventing Zip-Slip directory traversal vulnerabilities.
pub fn safe_extract_entry<R: Read>(
    entry_name: &str,
    mut reader: R,
    base_dir: &Path,
) -> Result<PathBuf, ModpackError> {
    let normalized = entry_name.replace('\\', "/");
    let safe_rel = Path::new(&normalized);

    for comp in safe_rel.components() {
        if let std::path::Component::ParentDir = comp {
            return Err(ModpackError::InvalidArchive(format!(
                "Zip-Slip path traversal detected in entry: {}",
                entry_name
            )));
        }
    }

    let target_path = base_dir.join(safe_rel);

    if !target_path.starts_with(base_dir) {
        return Err(ModpackError::InvalidArchive(format!(
            "Entry destination escapes base directory: {}",
            entry_name
        )));
    }

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut out = File::create(&target_path)?;
    std::io::copy(&mut reader, &mut out)?;
    Ok(target_path)
}

/// Extracts a .mrpack archive into an instance directory.
/// Overrides (`overrides/` or `client-overrides/`) are unpacked into `minecraft_dir`.
/// Returns parsed `ModrinthIndex` and the list of extracted override file paths.
pub fn unpack_mrpack(
    archive_bytes: &[u8],
    minecraft_dir: &Path,
) -> Result<(ModrinthIndex, Vec<PathBuf>), ModpackError> {
    let mut zip = ZipArchive::new(Cursor::new(archive_bytes))
        .map_err(|e| ModpackError::InvalidArchive(format!("Failed to open zip archive: {}", e)))?;

    // 1. Read modrinth.index.json
    let index: ModrinthIndex = {
        let mut index_file = zip
            .by_name("modrinth.index.json")
            .map_err(|_| ModpackError::InvalidArchive("Missing modrinth.index.json".into()))?;
        let mut content = String::new();
        index_file.read_to_string(&mut content)?;
        serde_json::from_str(&content)?
    };

    let mut extracted_overrides = Vec::new();

    // 2. Extract overrides/ and client-overrides/
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
        let name = file.name().to_string();

        let rel_path = if let Some(stripped) = name.strip_prefix("overrides/") {
            stripped
        } else if let Some(stripped) = name.strip_prefix("client-overrides/") {
            stripped
        } else {
            continue;
        };

        if rel_path.is_empty() || file.is_dir() {
            continue;
        }

        let extracted = safe_extract_entry(rel_path, &mut file, minecraft_dir)?;
        extracted_overrides.push(extracted);
    }

    Ok((index, extracted_overrides))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn test_parse_mrpack_index() {
        let json = r#"{
            "formatVersion": 1,
            "game": "minecraft",
            "versionId": "1.0.0",
            "name": "Focusite Pack",
            "files": [],
            "dependencies": {
                "minecraft": "1.20.4",
                "fabric-loader": "0.15.7"
            }
        }"#;

        let index: ModrinthIndex = serde_json::from_str(json).unwrap();
        assert_eq!(index.format_version, 1);
        assert_eq!(index.name, "Focusite Pack");
        assert_eq!(index.dependencies.get("minecraft").unwrap(), "1.20.4");
    }

    #[test]
    fn test_safe_extract_zip_slip_rejection() {
        let temp_dir = std::env::temp_dir().join("focusite_test_zip_slip");
        let _ = std::fs::create_dir_all(&temp_dir);

        let malicious_entry = "../outside.txt";
        let dummy_data = b"malicious content";
        let res = safe_extract_entry(malicious_entry, &dummy_data[..], &temp_dir);
        assert!(res.is_err());
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_unpack_mrpack_in_memory() {
        let temp_dir = std::env::temp_dir().join(format!("focusite_mrpack_test_{}", uuid::Uuid::new_v4()));
        let mc_dir = temp_dir.join("minecraft");
        std::fs::create_dir_all(&mc_dir).unwrap();

        // Create in-memory zip
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let options = SimpleFileOptions::default();

            zip.start_file("modrinth.index.json", options).unwrap();
            let index_json = r#"{
                "formatVersion": 1,
                "game": "minecraft",
                "versionId": "1.0.0",
                "name": "Test Memory Pack",
                "files": [],
                "dependencies": {
                    "minecraft": "1.21.4"
                }
            }"#;
            zip.write_all(index_json.as_bytes()).unwrap();

            zip.start_file("overrides/config/options.txt", options).unwrap();
            zip.write_all(b"fov:70\n").unwrap();

            zip.finish().unwrap();
        }

        let (index, overrides) = unpack_mrpack(&buf, &mc_dir).unwrap();
        assert_eq!(index.name, "Test Memory Pack");
        assert_eq!(overrides.len(), 1);
        assert!(mc_dir.join("config/options.txt").is_file());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
