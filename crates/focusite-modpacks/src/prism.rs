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
    /// Instance-level settings; each is only set when the instance overrides the launcher-wide value.
    pub jvm_args: Option<String>,
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    pub java_path: Option<String>,
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
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

        // A setting only counts when its `Override*` switch is on.
        let on = |map: &HashMap<String, String>, key: &str| map.get(key).is_some_and(|v| v.eq_ignore_ascii_case("true"));
        let override_java_args = on(&map, "OverrideJavaArgs");
        let override_memory = on(&map, "OverrideMemory");
        let override_java = on(&map, "OverrideJavaLocation");
        let override_window = on(&map, "OverrideWindow");
        let num = |map: &mut HashMap<String, String>, key: &str| map.remove(key).and_then(|v| v.parse::<u32>().ok());

        Self {
            name: map.remove("name").unwrap_or_else(|| "Prism Instance".to_string()),
            icon_key: map.remove("iconKey"),
            notes: map.remove("notes"),
            total_time_played: map.remove("totalTimePlayed").and_then(|v| v.parse().ok()),
            jvm_args: map.remove("JvmArgs").filter(|v| override_java_args && !v.is_empty()),
            min_memory_mb: num(&mut map, "MinMemAlloc").filter(|_| override_memory),
            max_memory_mb: num(&mut map, "MaxMemAlloc").filter(|_| override_memory),
            java_path: map.remove("JavaPath").filter(|v| override_java && !v.is_empty()),
            window_width: num(&mut map, "MinecraftWinWidth").filter(|_| override_window),
            window_height: num(&mut map, "MinecraftWinHeight").filter(|_| override_window),
        }
    }
}

/// Extracts Prism/MultiMC icon or config from zip archive bytes.
/// Size cap for the config and icon read from an untrusted archive.
const MAX_SMALL_FILE: u64 = 8 * 1024 * 1024;

pub fn extract_prism_metadata(archive_bytes: &[u8]) -> Result<(PrismInstanceCfg, Option<Vec<u8>>), ModpackError> {
    let mut zip = ZipArchive::new(std::io::Cursor::new(archive_bytes))
        .map_err(|e| ModpackError::InvalidArchive(format!("Failed to open zip archive: {}", e)))?;

    let mut cfg = PrismInstanceCfg {
        name: "Imported Instance".into(),
        icon_key: None,
        notes: None,
        total_time_played: None,
        jvm_args: None,
        min_memory_mb: None,
        max_memory_mb: None,
        java_path: None,
        window_width: None,
        window_height: None,
    };
    let mut icon_bytes = None;

    for i in 0..zip.len() {
        if let Ok(mut file) = zip.by_index(i) {
            let name = file.name().replace('\\', "/");
            if name.ends_with("instance.cfg") {
                let mut content = String::new();
                if (&mut file).take(MAX_SMALL_FILE).read_to_string(&mut content).is_ok() {
                    cfg = PrismInstanceCfg::parse(&content);
                }
            } else if (name.ends_with(".png") || name.ends_with(".jpg"))
                && (name.contains("icon") || name.ends_with("/icon.png"))
            {
                let mut buf = Vec::new();
                if (&mut file).take(MAX_SMALL_FILE).read_to_end(&mut buf).is_ok() {
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
        assert_eq!(parsed.jvm_args, None);
    }

    #[test]
    fn overrides_only_count_when_switched_on() {
        let cfg = PrismInstanceCfg::parse(
            r"OverrideJavaArgs=true
JvmArgs=-Xss4m -Dfoo=bar
OverrideMemory=false
MaxMemAlloc=8192
OverrideWindow=true
MinecraftWinWidth=1280
MinecraftWinHeight=720
OverrideJavaLocation=true
JavaPath=C:/java/javaw.exe
",
        );
        assert_eq!(cfg.jvm_args.as_deref(), Some("-Xss4m -Dfoo=bar"));
        assert_eq!(cfg.max_memory_mb, None);
        assert_eq!((cfg.window_width, cfg.window_height), (Some(1280), Some(720)));
        assert_eq!(cfg.java_path.as_deref(), Some("C:/java/javaw.exe"));
    }
}
