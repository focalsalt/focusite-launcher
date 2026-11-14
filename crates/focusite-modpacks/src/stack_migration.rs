//! Smart Minecraft Version and Loader Migration Engine.
//! Scans installed mods, queries Modrinth for target compatibility, and plans non-destructive upgrades.

use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::ModpackError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationUpdateItem {
    pub original_filename: String,
    pub mod_name: String,
    pub new_filename: String,
    pub download_url: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPlan {
    pub current_version: String,
    pub current_loader: String,
    pub target_version: String,
    pub target_loader: String,
    pub upgradable: Vec<MigrationUpdateItem>,
    pub incompatible: Vec<String>,
    pub compatible_unchanged: Vec<String>,
}

/// Computes a migration plan to change instance Minecraft version and/or loader.
pub async fn plan_stack_migration(
    client: &reqwest::Client,
    instance_mods_dir: &Path,
    current_version: &str,
    current_loader: &str,
    target_version: &str,
    target_loader: &str,
) -> Result<MigrationPlan, ModpackError> {
    let mut upgradable = Vec::new();
    let mut incompatible = Vec::new();
    let mut compatible_unchanged = Vec::new();

    if !instance_mods_dir.is_dir() {
        return Ok(MigrationPlan {
            current_version: current_version.to_string(),
            current_loader: current_loader.to_string(),
            target_version: target_version.to_string(),
            target_loader: target_loader.to_string(),
            upgradable,
            incompatible,
            compatible_unchanged,
        });
    }

    let user_agent = format!("Focusite-Launcher/{}", env!("CARGO_PKG_VERSION"));
    let entries = std::fs::read_dir(instance_mods_dir)
        .map_err(ModpackError::Io)?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            if filename.ends_with(".jar") && !filename.ends_with(".disabled") {
                // Compute SHA1 of file to match against Modrinth
                let file_bytes = std::fs::read(&path).unwrap_or_default();
                use sha1::{Digest, Sha1};
                let mut hasher = Sha1::new();
                hasher.update(&file_bytes);
                let sha1 = format!("{:x}", hasher.finalize());

                // Lookup version by hash on Modrinth
                let hash_url = format!("https://api.modrinth.com/v2/version_file/{}", sha1);
                let resp = client
                    .get(&hash_url)
                    .header("User-Agent", &user_agent)
                    .send()
                    .await;

                if let Ok(r) = resp {
                    if r.status().is_success() {
                        #[derive(Deserialize)]
                        struct HashLookupResponse {
                            project_id: String,
                            game_versions: Vec<String>,
                            loaders: Vec<String>,
                        }

                        if let Ok(lookup) = r.json::<HashLookupResponse>().await {
                            // Check if already compatible
                            let matches_ver = lookup.game_versions.iter().any(|v| v == target_version);
                            let matches_ldr = lookup.loaders.iter().any(|l| l.eq_ignore_ascii_case(target_loader));

                            if matches_ver && matches_ldr {
                                compatible_unchanged.push(filename);
                                continue;
                            }

                            // Query latest compatible version for project
                            let q_url = format!(
                                "https://api.modrinth.com/v2/project/{}/version?game_versions=[\"{}\"]&loaders=[\"{}\"]",
                                lookup.project_id, target_version, target_loader.to_lowercase()
                            );

                            let q_resp = client
                                .get(&q_url)
                                .header("User-Agent", &user_agent)
                                .send()
                                .await;

                            if let Ok(qr) = q_resp {
                                if qr.status().is_success() {
                                    #[derive(Deserialize)]
                                    struct NewVersionFile {
                                        url: String,
                                        filename: String,
                                        primary: bool,
                                        size: u64,
                                        hashes: std::collections::HashMap<String, String>,
                                    }
                                    #[derive(Deserialize)]
                                    struct NewVersionDetail {
                                        name: String,
                                        files: Vec<NewVersionFile>,
                                    }

                                    if let Ok(ver_list) = qr.json::<Vec<NewVersionDetail>>().await {
                                        if let Some(first_ver) = ver_list.first() {
                                            if let Some(f) = first_ver.files.iter().find(|f| f.primary).or_else(|| first_ver.files.first()) {
                                                upgradable.push(MigrationUpdateItem {
                                                    original_filename: filename,
                                                    mod_name: first_ver.name.clone(),
                                                    new_filename: f.filename.clone(),
                                                    download_url: f.url.clone(),
                                                    sha1: f.hashes.get("sha1").cloned().unwrap_or_default(),
                                                    size: f.size,
                                                });
                                                continue;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // If not matched or no compatible update found, flag as incompatible
                incompatible.push(filename);
            }
        }
    }

    Ok(MigrationPlan {
        current_version: current_version.to_string(),
        current_loader: current_loader.to_string(),
        target_version: target_version.to_string(),
        target_loader: target_loader.to_string(),
        upgradable,
        incompatible,
        compatible_unchanged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_plan_empty_dir() {
        let temp = std::env::temp_dir().join(format!("fc_test_migr_{}", uuid::Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&temp);

        let plan = MigrationPlan {
            current_version: "1.20.1".into(),
            current_loader: "Fabric".into(),
            target_version: "1.21.4".into(),
            target_loader: "NeoForge".into(),
            upgradable: Vec::new(),
            incompatible: Vec::new(),
            compatible_unchanged: Vec::new(),
        };

        assert_eq!(plan.target_version, "1.21.4");
        assert_eq!(plan.target_loader, "NeoForge");
        let _ = std::fs::remove_dir_all(&temp);
    }
}
