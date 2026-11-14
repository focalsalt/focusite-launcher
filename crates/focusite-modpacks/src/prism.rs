//! Prism Launcher / PolyMC / MultiMC instance configuration models and parsing.

use std::collections::HashMap;
use std::io::Read;
use serde::{Deserialize, Serialize};
use zip::ZipArchive;
use crate::ModpackError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismInstanceCfg {
    pub name: String,
    pub icon_key: Option<String>,
    pub notes: Option<String>,
    pub total_time_played: Option<u64>,
}

impl PrismInstanceCfg {
    /// Parses key=value pairs from MultiMC/Prism instance.cfg format.
    pub fn parse(content: &str) -> Self {
        let mut map = HashMap::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }

        Self {
            name: map.remove("name").unwrap_or_else(|| "Prism Instance".to_string()),
            icon_key: map.remove("iconKey"),
            notes: map.remove("notes"),
            total_time_played: map.remove("totalTimePlayed").and_then(|v| v.parse().ok()),
        }
    }
}

/// Extracts Prism/MultiMC icon or config from zip archive bytes.
pub fn extract_prism_metadata(archive_bytes: &[u8]) -> Result<(PrismInstanceCfg, Option<Vec<u8>>), ModpackError> {
    let mut zip = ZipArchive::new(std::io::Cursor::new(archive_bytes))
        .map_err(|e| ModpackError::InvalidArchive(format!("Failed to open zip archive: {}", e)))?;

    let mut cfg = PrismInstanceCfg {
        name: "Imported Instance".into(),
        icon_key: None,
        notes: None,
        total_time_played: None,
    };
    let mut icon_bytes = None;

    for i in 0..zip.len() {
        if let Ok(mut file) = zip.by_index(i) {
            let name = file.name().replace('\\', "/");
            if name.ends_with("instance.cfg") {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok() {
                    cfg = PrismInstanceCfg::parse(&content);
                }
            } else if (name.ends_with(".png") || name.ends_with(".jpg"))
                && (name.contains("icon") || name.ends_with("/icon.png"))
            {
                let mut buf = Vec::new();
                if file.read_to_end(&mut buf).is_ok() {
                    icon_bytes = Some(buf);
                }
            }
        }
    }

    Ok((cfg, icon_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_prism_instance_cfg() {
        let config_str = r#"
        FormatVersion=1
        name=Fabulously Optimized
        iconKey=fabulously_optimized
        notes=Best optimization pack
        totalTimePlayed=3600
        "#;

        let parsed = PrismInstanceCfg::parse(config_str);
        assert_eq!(parsed.name, "Fabulously Optimized");
        assert_eq!(parsed.icon_key.as_deref(), Some("fabulously_optimized"));
        assert_eq!(parsed.notes.as_deref(), Some("Best optimization pack"));
        assert_eq!(parsed.total_time_played, Some(3600));
    }
}
