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

/// Largest single file accepted from a modpack archive.
pub const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Limits for the whole archive: all unpacked overrides together, entry count, and small text files.
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 50_000;
const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;

/// Safely extracts a zip entry preventing Zip-Slip directory traversal vulnerabilities.
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

pub(crate) fn open_zip(archive_bytes: &[u8]) -> Result<ZipArchive<Cursor<&[u8]>>, ModpackError> {
    let zip = ZipArchive::new(Cursor::new(archive_bytes))
        .map_err(|e| ModpackError::InvalidArchive(format!("Failed to open zip archive: {}", e)))?;
    if zip.len() > MAX_ENTRIES {
        return Err(ModpackError::InvalidArchive(format!("Archive has more than {} entries", MAX_ENTRIES)));
    }
    Ok(zip)
}

/// Reads a small text file from the archive (at most 16 MiB); `None` when the archive has no such file.
pub(crate) fn read_text(zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Option<String>, ModpackError> {
    let Ok(file) = zip.by_name(name) else { return Ok(None) };
    let mut content = String::new();
    file.take(MAX_TEXT_BYTES).read_to_string(&mut content)?;
    Ok(Some(content))
}

/// Extracts every file under one of `prefixes` into `dir` (prefix stripped), within the archive limits.
pub(crate) fn extract_overrides(
    zip: &mut ZipArchive<Cursor<&[u8]>>,
    prefixes: &[&str],
    dir: &Path,
) -> Result<Vec<PathBuf>, ModpackError> {
    let mut total_bytes: u64 = 0;
    let mut extracted = Vec::new();
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
        let name = file.name().to_string();
        let Some(rel_path) = prefixes.iter().find_map(|p| name.strip_prefix(p)) else { continue };
        if rel_path.is_empty() || file.is_dir() {
            continue;
        }
        let path = safe_extract_entry(rel_path, &mut file, dir)?;
        total_bytes += std::fs::metadata(&path)?.len();
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(ModpackError::InvalidArchive(format!(
                "Archive expands to more than {} MiB",
                MAX_TOTAL_BYTES / (1024 * 1024)
            )));
        }
        extracted.push(path);
    }
    Ok(extracted)
}

/// Reads `modrinth.index.json` without unpacking anything.
pub fn read_mrpack_index(archive_bytes: &[u8]) -> Result<ModrinthIndex, ModpackError> {
    let mut zip = open_zip(archive_bytes)?;
    let content = read_text(&mut zip, "modrinth.index.json")?
        .ok_or_else(|| ModpackError::InvalidArchive("Missing modrinth.index.json".into()))?;
    Ok(serde_json::from_str(&content)?)
}

/// Extracts a .mrpack archive into an instance directory.
/// Overrides (`overrides/` or `client-overrides/`) are unpacked into `minecraft_dir`.
/// Returns parsed `ModrinthIndex` and the list of extracted override file paths.
pub fn unpack_mrpack(
    archive_bytes: &[u8],
    minecraft_dir: &Path,
) -> Result<(ModrinthIndex, Vec<PathBuf>), ModpackError> {
    let index = read_mrpack_index(archive_bytes)?;
    let mut zip = open_zip(archive_bytes)?;
    let extracted = extract_overrides(&mut zip, &["overrides/", "client-overrides/"], minecraft_dir)?;
    Ok((index, extracted))
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
}
