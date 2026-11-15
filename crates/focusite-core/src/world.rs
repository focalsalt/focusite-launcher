//! Minecraft World/Save (level.dat) NBT Parser and Manager.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use base64::prelude::*;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use crate::CoreError;

/// Serializes i64 as a string so 64-bit seeds survive JavaScript's 2^53 number limit.
mod i64_as_string {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &i64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSummary {
    pub folder_name: String,
    pub name: String,
    #[serde(with = "i64_as_string")]
    pub seed: i64,
    pub game_mode: u8, // 0: Survival, 1: Creative, 2: Adventure, 3: Spectator
    pub is_hardcore: bool,
    pub last_played: i64, // ms timestamp
    pub version_name: String,
    pub icon_base64: Option<String>,
}

#[derive(Deserialize)]
struct LevelDatRoot {
    #[serde(rename = "Data")]
    data: LevelData,
}

#[derive(Deserialize)]
struct LevelData {
    #[serde(rename = "LevelName")]
    level_name: Option<String>,
    #[serde(rename = "RandomSeed")]
    random_seed: Option<i64>,
    #[serde(rename = "GameType")]
    game_type: Option<i32>,
    #[serde(rename = "hardcore")]
    hardcore: Option<u8>,
    #[serde(rename = "LastPlayed")]
    last_played: Option<i64>,
    #[serde(rename = "Version")]
    version: Option<LevelVersion>,
}

#[derive(Deserialize)]
struct LevelVersion {
    #[serde(rename = "Name")]
    name: Option<String>,
}

/// Parses a level.dat file from the specified path.
pub fn parse_level_dat(folder_path: &Path) -> Result<WorldSummary, CoreError> {
    let dat_path = folder_path.join("level.dat");
    if !dat_path.exists() {
        return Err(CoreError::NotFound(format!(
            "level.dat not found at {}",
            dat_path.display()
        )));
    }

    let file_bytes = fs::read(&dat_path)?;

    // Try gzip decompressing first
    let decompressed = {
        let mut decoder = GzDecoder::new(&file_bytes[..]);
        let mut buf = Vec::new();
        if decoder.read_to_end(&mut buf).is_ok() {
            buf
        } else {
            file_bytes.clone()
        }
    };

    let root: LevelDatRoot = fastnbt::from_bytes(&decompressed)
        .map_err(|e| CoreError::InvalidManifest(format!("Failed to parse level.dat NBT: {}", e)))?;

    let folder_name = folder_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let name = root.data.level_name.unwrap_or_else(|| folder_name.clone());
    let seed = root.data.random_seed.unwrap_or(0);
    let game_mode = root.data.game_type.unwrap_or(0).clamp(0, 3) as u8;
    let is_hardcore = root.data.hardcore.unwrap_or(0) != 0;
    let last_played = root.data.last_played.unwrap_or(0);
    let version_name = root
        .data
        .version
        .and_then(|v| v.name)
        .unwrap_or_else(|| "Unknown".to_string());

    // Check for world icon: icon.png
    let icon_path = folder_path.join("icon.png");
    let icon_base64 = if icon_path.exists() {
        if let Ok(icon_data) = fs::read(&icon_path) {
            let b64 = format!("data:image/png;base64,{}", BASE64_STANDARD.encode(&icon_data));
            Some(b64)
        } else {
            None
        }
    } else {
        None
    };

    Ok(WorldSummary {
        folder_name,
        name,
        seed,
        game_mode,
        is_hardcore,
        last_played,
        version_name,
        icon_base64,
    })
}

/// Lists all worlds in an instance's saves folder.
pub fn list_instance_worlds(instance_dir: &Path) -> Result<Vec<WorldSummary>, CoreError> {
    let saves_dir = {
        let p1 = instance_dir.join("minecraft").join("saves");
        if p1.is_dir() {
            p1
        } else {
            instance_dir.join("saves")
        }
    };

    if !saves_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut worlds = Vec::new();
    let entries = fs::read_dir(&saves_dir)?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("level.dat").exists() {
            if let Ok(summary) = parse_level_dat(&path) {
                worlds.push(summary);
            }
        }
    }

    // Sort by last played descending
    worlds.sort_by_key(|w| std::cmp::Reverse(w.last_played));
    Ok(worlds)
}

/// Renames a Minecraft world by safely updating LevelName in level.dat.
pub fn rename_world(instance_dir: &Path, folder_name: &str, new_name: &str) -> Result<(), CoreError> {
    let world_dir = resolve_world_dir(instance_dir, folder_name)?;
    let dat_path = world_dir.join("level.dat");

    let file_bytes = fs::read(&dat_path)?;
    let decompressed = {
        let mut decoder = GzDecoder::new(&file_bytes[..]);
        let mut buf = Vec::new();
        if decoder.read_to_end(&mut buf).is_ok() {
            buf
        } else {
            file_bytes
        }
    };

    // Parse into generic fastnbt::Value
    let mut value: fastnbt::Value = fastnbt::from_bytes(&decompressed)
        .map_err(|e| CoreError::InvalidManifest(format!("NBT parse error: {}", e)))?;

    if let fastnbt::Value::Compound(ref mut map) = value {
        if let Some(fastnbt::Value::Compound(ref mut data_map)) = map.get_mut("Data") {
            data_map.insert("LevelName".to_string(), fastnbt::Value::String(new_name.to_string()));
        }
    }

    // Re-serialize with gzip
    let serialized = fastnbt::to_bytes(&value)
        .map_err(|e| CoreError::InvalidManifest(format!("NBT serialize error: {}", e)))?;

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&serialized)?;
    let compressed = encoder.finish()?;

    // Safe atomic replacement
    let temp_path = world_dir.join("level.dat.tmp");
    fs::write(&temp_path, compressed)?;
    fs::rename(temp_path, dat_path)?;

    Ok(())
}

/// Safely deletes a world directory.
pub fn delete_world(instance_dir: &Path, folder_name: &str) -> Result<(), CoreError> {
    let world_dir = resolve_world_dir(instance_dir, folder_name)?;
    fs::remove_dir_all(world_dir)?;
    Ok(())
}

/// Backs up a world folder into a ZIP archive.
pub fn backup_world(instance_dir: &Path, folder_name: &str, output_zip: &Path) -> Result<(), CoreError> {
    let world_dir = resolve_world_dir(instance_dir, folder_name)?;
    let file = File::create(output_zip)?;
    let mut zip = zip::ZipWriter::new(file);

    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    fn add_dir_to_zip<W: Write + std::io::Seek>(
        zip: &mut zip::ZipWriter<W>,
        base_dir: &Path,
        current_dir: &Path,
        options: zip::write::SimpleFileOptions,
    ) -> Result<(), CoreError> {
        let entries = fs::read_dir(current_dir)?;
        for entry in entries.flatten() {
            let path = entry.path();
            let rel_path = path.strip_prefix(base_dir).unwrap_or(&path);
            let name = rel_path.to_string_lossy().replace('\\', "/");

            if path.is_dir() {
                zip.add_directory(&name, options)
                    .map_err(|e| CoreError::Io(std::io::Error::other(e)))?;
                add_dir_to_zip(zip, base_dir, &path, options)?;
            } else if path.is_file() {
                zip.start_file(&name, options)
                    .map_err(|e| CoreError::Io(std::io::Error::other(e)))?;
                let mut f = File::open(&path)?;
                std::io::copy(&mut f, zip)?;
            }
        }
        Ok(())
    }

    add_dir_to_zip(&mut zip, &world_dir, &world_dir, options)?;
    zip.finish()
        .map_err(|e| CoreError::Io(std::io::Error::other(e)))?;

    Ok(())
}

fn validate_world_folder_name(folder_name: &str) -> Result<(), CoreError> {
    let trimmed = folder_name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains(':')
        || trimmed.starts_with('.')
    {
        return Err(CoreError::InvalidManifest(format!(
            "Invalid world folder name (traversal or reserved characters): '{}'",
            folder_name
        )));
    }
    Ok(())
}

fn resolve_world_dir(instance_dir: &Path, folder_name: &str) -> Result<PathBuf, CoreError> {
    validate_world_folder_name(folder_name)?;

    let saves_dir = {
        let p1 = instance_dir.join("minecraft").join("saves");
        if p1.is_dir() {
            p1
        } else {
            instance_dir.join("saves")
        }
    };

    if !saves_dir.is_dir() {
        return Err(CoreError::NotFound("Saves directory not found".into()));
    }

    let target = saves_dir.join(folder_name);
    if !target.is_dir() {
        return Err(CoreError::NotFound(format!("World directory {} not found", folder_name)));
    }

    let canon_saves = saves_dir
        .canonicalize()
        .map_err(CoreError::Io)?;
    let canon_target = target
        .canonicalize()
        .map_err(CoreError::Io)?;

    if !canon_target.starts_with(&canon_saves) {
        return Err(CoreError::InvalidManifest("Path traversal detected outside of saves".into()));
    }

    Ok(canon_target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_world_folder_name_validation() {
        assert!(validate_world_folder_name("New_World").is_ok());
        assert!(validate_world_folder_name("My Survival (1.20)").is_ok());

        assert!(validate_world_folder_name("../sneaky").is_err());
        assert!(validate_world_folder_name("foo/bar").is_err());
        assert!(validate_world_folder_name("foo\\bar").is_err());
        assert!(validate_world_folder_name("..").is_err());
        assert!(validate_world_folder_name(".hidden").is_err());
        assert!(validate_world_folder_name("C:world").is_err());
        assert!(validate_world_folder_name("   ").is_err());
    }

    #[test]
    fn test_resolve_world_dir_path_traversal() {
        let temp = std::env::temp_dir().join(format!("fc_test_world_{}", uuid::Uuid::new_v4()));
        let saves = temp.join("minecraft").join("saves");
        let valid_world = saves.join("LegitWorld");
        fs::create_dir_all(&valid_world).unwrap();

        // Valid resolve
        let resolved = resolve_world_dir(&temp, "LegitWorld");
        assert!(resolved.is_ok());

        // Traversal attempt
        let traversal = resolve_world_dir(&temp, "../../etc");
        assert!(traversal.is_err());

        let not_found = resolve_world_dir(&temp, "NonExistentWorld");
        assert!(not_found.is_err());

        let _ = fs::remove_dir_all(&temp);
    }
}
