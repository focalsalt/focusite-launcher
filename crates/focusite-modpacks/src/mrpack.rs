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
/// Largest single file accepted from a modpack archive.
pub const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub fn safe_extract_entry<R: Read>(
    entry_name: &str,
    reader: R,
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

    // Stop a decompression bomb: one entry may not expand past the limit.
    let mut out = File::create(&target_path)?;
    let written = std::io::copy(&mut reader.take(MAX_ENTRY_BYTES + 1), &mut out)?;
    if written > MAX_ENTRY_BYTES {
        drop(out);
        let _ = std::fs::remove_file(&target_path);
        return Err(ModpackError::InvalidArchive(format!(
            "Entry is larger than {} MiB: {}",
            MAX_ENTRY_BYTES / (1024 * 1024),
            entry_name
        )));
    }
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

/// Creates a .mrpack archive with index metadata and optional overrides directory.
pub fn create_mrpack<W: std::io::Write + std::io::Seek>(
    writer: W,
    index: &ModrinthIndex,
    overrides_dir: Option<&Path>,
) -> Result<(), ModpackError> {
    let mut zip = zip::ZipWriter::new(writer);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 1. Write modrinth.index.json
    zip.start_file("modrinth.index.json", options)
        .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
    let index_json = serde_json::to_string_pretty(index)?;
    std::io::Write::write_all(&mut zip, index_json.as_bytes())?;

    // 2. Write overrides/ if provided
    if let Some(ov_dir) = overrides_dir {
        if ov_dir.is_dir() {
            fn add_dir<W: std::io::Write + std::io::Seek>(
                zip: &mut zip::ZipWriter<W>,
                base: &Path,
                current: &Path,
                opts: zip::write::SimpleFileOptions,
            ) -> Result<(), ModpackError> {
                for entry in std::fs::read_dir(current)? {
                    let entry = entry?;
                    let path = entry.path();
                    if path.is_file() {
                        let rel = path
                            .strip_prefix(base)
                            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
                        let zip_path = format!("overrides/{}", rel.to_string_lossy().replace('\\', "/"));
                        zip.start_file(zip_path, opts)
                            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
                        let mut f = File::open(&path)?;
                        std::io::copy(&mut f, zip)?;
                    } else if path.is_dir() {
                        add_dir(zip, base, &path, opts)?;
                    }
                }
                Ok(())
            }
            add_dir(&mut zip, ov_dir, ov_dir, options)?;
        }
    }

    zip.finish().map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn test_entry_over_limit_is_rejected_and_removed() {
        struct Endless;
        impl Read for Endless {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                buf.fill(0);
                Ok(buf.len())
            }
        }
        let dir = std::env::temp_dir().join(format!("fc_bomb_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(safe_extract_entry("big.bin", Endless, &dir).is_err());
        assert!(!dir.join("big.bin").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

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

    #[test]
    fn test_create_mrpack_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("focusite_mrpack_create_{}", uuid::Uuid::new_v4()));
        let ov_dir = temp_dir.join("overrides_src");
        let dest_mc = temp_dir.join("dest_mc");
        std::fs::create_dir_all(ov_dir.join("mods")).unwrap();
        std::fs::write(ov_dir.join("mods/test_mod.jar"), b"PK_DUMMY_JAR").unwrap();

        let index = ModrinthIndex {
            format_version: 1,
            game: "minecraft".into(),
            version_id: "1.0.0".into(),
            name: "Created Pack".into(),
            summary: Some("Test export".into()),
            files: vec![],
            dependencies: HashMap::from([("minecraft".into(), "1.20.1".into())]),
        };

        let mut out_buf = Cursor::new(Vec::new());
        create_mrpack(&mut out_buf, &index, Some(&ov_dir)).unwrap();

        let raw_bytes = out_buf.into_inner();
        let (unpacked_idx, unpacked_overrides) = unpack_mrpack(&raw_bytes, &dest_mc).unwrap();
        assert_eq!(unpacked_idx.name, "Created Pack");
        assert_eq!(unpacked_overrides.len(), 1);
        assert!(dest_mc.join("mods/test_mod.jar").is_file());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
