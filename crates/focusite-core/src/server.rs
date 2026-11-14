//! Minecraft servers.dat NBT Parser and Editor.

use std::fs;
use std::io::Read;
use std::path::Path;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use crate::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerEntry {
    pub name: String,
    pub ip: String,
    pub icon_base64: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ServersDatRoot {
    #[serde(rename = "servers")]
    servers: Vec<RawServerEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct RawServerEntry {
    #[serde(rename = "name")]
    name: String,
    #[serde(rename = "ip")]
    ip: String,
    #[serde(rename = "icon", skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(rename = "acceptTextures", skip_serializing_if = "Option::is_none")]
    accept_textures: Option<u8>,
    #[serde(rename = "hidden", skip_serializing_if = "Option::is_none")]
    hidden: Option<u8>,
    #[serde(flatten)]
    extra: std::collections::HashMap<String, fastnbt::Value>,
}

/// Reads the servers.dat file from the specified path or instance directory.
pub fn read_servers_dat(file_path: &Path) -> Result<Vec<ServerEntry>, CoreError> {
    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let file_bytes = fs::read(file_path)?;
    if file_bytes.is_empty() {
        return Ok(Vec::new());
    }

    // Try gzip decompressing first; fallback to raw bytes
    let decompressed = {
        let mut decoder = GzDecoder::new(&file_bytes[..]);
        let mut buf = Vec::new();
        if decoder.read_to_end(&mut buf).is_ok() {
            buf
        } else {
            file_bytes
        }
    };

    let root: ServersDatRoot = fastnbt::from_bytes(&decompressed)
        .map_err(|e| CoreError::InvalidManifest(format!("Failed to parse servers.dat NBT: {}", e)))?;

    let entries = root
        .servers
        .into_iter()
        .map(|s| ServerEntry {
            name: s.name,
            ip: s.ip,
            icon_base64: s.icon,
        })
        .collect();

    Ok(entries)
}

/// Writes the servers list back to servers.dat in standard NBT format, preserving metadata.
pub fn write_servers_dat(file_path: &Path, servers: &[ServerEntry]) -> Result<(), CoreError> {
    let existing_raw: Vec<RawServerEntry> = if file_path.is_file() {
        if let Ok(file_bytes) = fs::read(file_path) {
            let decompressed = {
                let mut decoder = GzDecoder::new(&file_bytes[..]);
                let mut buf = Vec::new();
                if decoder.read_to_end(&mut buf).is_ok() {
                    buf
                } else {
                    file_bytes
                }
            };
            fastnbt::from_bytes::<ServersDatRoot>(&decompressed)
                .map(|r| r.servers)
                .unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let mut existing_map: std::collections::HashMap<String, RawServerEntry> = existing_raw
        .into_iter()
        .map(|s| (s.ip.clone(), s))
        .collect();

    let raw_servers: Vec<RawServerEntry> = servers
        .iter()
        .map(|s| {
            if let Some(mut old) = existing_map.remove(&s.ip) {
                old.name = s.name.clone();
                old.icon = s.icon_base64.clone();
                old
            } else {
                RawServerEntry {
                    name: s.name.clone(),
                    ip: s.ip.clone(),
                    icon: s.icon_base64.clone(),
                    accept_textures: Some(1),
                    hidden: None,
                    extra: std::collections::HashMap::new(),
                }
            }
        })
        .collect();

    let root = ServersDatRoot {
        servers: raw_servers,
    };

    let bytes = fastnbt::to_bytes(&root)
        .map_err(|e| CoreError::InvalidManifest(format!("Failed to serialize servers.dat: {}", e)))?;

    let temp_path = file_path.with_extension("dat.tmp");
    fs::write(&temp_path, &bytes)?;
    fs::rename(temp_path, file_path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_servers_dat_roundtrip() {
        let tmp = std::env::temp_dir().join("test_servers.dat");
        let list = vec![
            ServerEntry {
                name: "Hypixel Network".to_string(),
                ip: "mc.hypixel.net".to_string(),
                icon_base64: None,
            },
            ServerEntry {
                name: "Local Test".to_string(),
                ip: "localhost:25565".to_string(),
                icon_base64: Some("data:image/png;base64,1234".to_string()),
            },
        ];

        write_servers_dat(&tmp, &list).unwrap();
        let loaded = read_servers_dat(&tmp).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].name, "Hypixel Network");
        assert_eq!(loaded[1].ip, "localhost:25565");

        let _ = fs::remove_file(tmp);
    }

    #[test]
    fn test_corrupt_servers_dat_returns_error() {
        let tmp = std::env::temp_dir().join(format!("test_corrupt_servers_{}.dat", uuid::Uuid::new_v4()));
        fs::write(&tmp, b"corrupted non-nbt data").unwrap();
        let res = read_servers_dat(&tmp);
        assert!(res.is_err());
        let _ = fs::remove_file(tmp);
    }

    #[test]
    fn test_servers_dat_preserves_hidden_and_extra_fields() {
        let tmp = std::env::temp_dir().join(format!("test_servers_extra_{}.dat", uuid::Uuid::new_v4()));
        let mut extra_map = std::collections::HashMap::new();
        extra_map.insert("customField".to_string(), fastnbt::Value::String("customVal".to_string()));

        let initial_raw = ServersDatRoot {
            servers: vec![RawServerEntry {
                name: "Secret Server".to_string(),
                ip: "secret.example.com".to_string(),
                icon: None,
                accept_textures: Some(0),
                hidden: Some(1),
                extra: extra_map,
            }],
        };
        let raw_bytes = fastnbt::to_bytes(&initial_raw).unwrap();
        fs::write(&tmp, raw_bytes).unwrap();

        // Perform write_servers_dat update
        let updated_list = vec![ServerEntry {
            name: "Secret Server".to_string(),
            ip: "secret.example.com".to_string(),
            icon_base64: None,
        }];
        write_servers_dat(&tmp, &updated_list).unwrap();

        // Read raw NBT back to verify hidden, accept_textures, and extra fields are preserved
        let reloaded_bytes = fs::read(&tmp).unwrap();
        let reloaded_raw: ServersDatRoot = fastnbt::from_bytes(&reloaded_bytes).unwrap();
        assert_eq!(reloaded_raw.servers.len(), 1);
        assert_eq!(reloaded_raw.servers[0].hidden, Some(1));
        assert_eq!(reloaded_raw.servers[0].accept_textures, Some(0));
        assert_eq!(
            reloaded_raw.servers[0].extra.get("customField"),
            Some(&fastnbt::Value::String("customVal".to_string()))
        );

        let _ = fs::remove_file(tmp);
    }
}
