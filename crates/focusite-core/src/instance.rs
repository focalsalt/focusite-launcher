//! Instance metadata and management structures.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Minecraft Instance Specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub game_version: String,
    pub loader: Option<ModLoaderSpec>,
    pub java_path: Option<String>,
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    pub jvm_args: Vec<String>,
    pub created_at: i64,
    pub last_played_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModLoaderSpec {
    pub loader_type: ModLoaderType,
    pub loader_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModLoaderType {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
    Quilt,
}

impl InstanceConfig {
    pub fn new(id: String, name: String, game_version: String) -> Self {
        Self {
            id,
            name,
            game_version,
            loader: None,
            java_path: None,
            min_memory_mb: 1024,
            max_memory_mb: 4096,
            jvm_args: vec![
                "-XX:+UseG1GC".into(),
                "-XX:+ParallelRefProcEnabled".into(),
                "-XX:MaxGCPauseMillis=200".into(),
            ],
            created_at: chrono::Utc::now().timestamp_millis(),
            last_played_at: None,
        }
    }

    pub fn get_game_dir<P: AsRef<Path>>(&self, base_instances_dir: P) -> PathBuf {
        base_instances_dir.as_ref().join(&self.id).join(".minecraft")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_instance_creation() {
        let inst = InstanceConfig::new("inst-1".into(), "Fabric Survival".into(), "1.20.4".into());
        assert_eq!(inst.id, "inst-1");
        assert_eq!(inst.max_memory_mb, 4096);
        let path = inst.get_game_dir("C:/focusite/instances");
        assert_eq!(path, PathBuf::from("C:/focusite/instances/inst-1/.minecraft"));
    }
}
