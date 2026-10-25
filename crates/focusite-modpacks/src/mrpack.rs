//! Modrinth modpack index (modrinth.index.json) schema specification.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
