//! Loader installers for Fabric, Quilt, NeoForge, and Forge.

use std::path::Path;
use serde::{Deserialize, Serialize};
use tracing::info;
use crate::manifest::VersionManifest;
use crate::CoreError;

pub const FABRIC_META_URL: &str = "https://meta.fabricmc.net/v2/versions/loader";
pub const QUILT_META_URL: &str = "https://meta.quiltmc.org/v3/versions/loader";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderInstallResult {
    pub version_id: String,
    pub profile_manifest: VersionManifest,
}

/// Fetches the Fabric loader version manifest profile JSON for the specified MC and Loader versions.
pub async fn fetch_fabric_profile(
    game_version: &str,
    loader_version: &str,
) -> Result<VersionManifest, CoreError> {
    let url = format!("{}/{}/{}/profile/json", FABRIC_META_URL, game_version, loader_version);
    info!("Fetching Fabric profile from {}", url);
    VersionManifest::fetch_remote(&url).await
}

/// Fetches the Quilt loader version manifest profile JSON for the specified MC and Loader versions.
pub async fn fetch_quilt_profile(
    game_version: &str,
    loader_version: &str,
) -> Result<VersionManifest, CoreError> {
    let url = format!("{}/{}/{}/profile/json", QUILT_META_URL, game_version, loader_version);
    info!("Fetching Quilt profile from {}", url);
    VersionManifest::fetch_remote(&url).await
}

/// Installs Fabric or Quilt loader profile, merging with parent vanilla manifest.
pub async fn install_meta_loader(
    loader_type: &str,
    game_version: &str,
    loader_version: &str,
    vanilla_manifest: &VersionManifest,
    versions_dir: &Path,
) -> Result<VersionManifest, CoreError> {
    // Both strings come from the instance config (a modpack can set them) and end up in a URL and a folder name.
    for part in [game_version, loader_version] {
        if part.is_empty() || !part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+')) || part.contains("..") {
            return Err(CoreError::InvalidManifest(format!("Unsafe version string: {}", part)));
        }
    }

    let profile = if loader_type.eq_ignore_ascii_case("quilt") {
        fetch_quilt_profile(game_version, loader_version).await?
    } else {
        fetch_fabric_profile(game_version, loader_version).await?
    };

    let merged = profile.merge_parent(vanilla_manifest);

    let profile_id = format!("{}-{}-{}", game_version, loader_type.to_lowercase(), loader_version);
    let out_dir = versions_dir.join(&profile_id);
    let _ = std::fs::create_dir_all(&out_dir);

    let out_file = out_dir.join(format!("{}.json", profile_id));
    let content = serde_json::to_string_pretty(&merged)?;
    std::fs::write(&out_file, content)?;

    info!("Installed {} loader profile to {:?}", loader_type, out_file);
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsafe_loader_version_is_rejected_before_any_request() {
        let vanilla: VersionManifest = serde_json::from_str(r#"{"id":"1.20.4","type":"release","mainClass":"m","libraries":[]}"#).unwrap();
        let dir = std::env::temp_dir();
        let run = |game: &str, loader: &str| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(install_meta_loader("fabric", game, loader, &vanilla, &dir))
        };
        assert!(matches!(run("1.20.4", "../../x"), Err(CoreError::InvalidManifest(_))));
        assert!(matches!(run("1.20.4", "a/b"), Err(CoreError::InvalidManifest(_))));
        assert!(matches!(run("..", "0.15.7"), Err(CoreError::InvalidManifest(_))));
    }

    #[test]
    fn test_fabric_and_quilt_url_format() {
        let fabric_url = format!("{}/{}/{}/profile/json", FABRIC_META_URL, "1.21.4", "0.16.9");
        assert_eq!(
            fabric_url,
            "https://meta.fabricmc.net/v2/versions/loader/1.21.4/0.16.9/profile/json"
        );

        let quilt_url = format!("{}/{}/{}/profile/json", QUILT_META_URL, "1.20.1", "0.26.0");
        assert_eq!(
            quilt_url,
            "https://meta.quiltmc.org/v3/versions/loader/1.20.1/0.26.0/profile/json"
        );
    }
}
