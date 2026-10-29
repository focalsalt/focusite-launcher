//! Version manifest commands fetching real Mojang metadata.

use focusite_core::manifest::{LoaderKind, LoaderVersionInfo, VersionManifest, VersionManifestV2};
use focusite_download::mirror::{MirrorManager, MirrorProvider};

#[tauri::command]
pub async fn get_version_manifest(mirror: Option<String>) -> Result<VersionManifestV2, String> {
    let settings = super::settings::load_settings_from_disk();
    let base_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let provider = match mirror.as_deref() {
        Some("bmclapi") => MirrorProvider::Bmclapi,
        Some("mcbbs") => MirrorProvider::Mcbbs,
        Some("official") => MirrorProvider::Official,
        _ => {
            if settings.enable_bmclapi_mirror {
                MirrorProvider::Bmclapi
            } else {
                MirrorProvider::Official
            }
        }
    };
    let target_url = MirrorManager::rewrite_url(base_url, provider);

    match VersionManifestV2::fetch_remote(&target_url).await {
        Ok(v2) => Ok(v2),
        Err(e) => Err(format!("Failed to fetch version manifest: {}", e)),
    }
}

#[tauri::command]
pub async fn get_version_detail(
    version_url: String,
    mirror: Option<String>,
) -> Result<VersionManifest, String> {
    let settings = super::settings::load_settings_from_disk();
    let provider = match mirror.as_deref() {
        Some("bmclapi") => MirrorProvider::Bmclapi,
        Some("mcbbs") => MirrorProvider::Mcbbs,
        Some("official") => MirrorProvider::Official,
        _ => {
            if settings.enable_bmclapi_mirror {
                MirrorProvider::Bmclapi
            } else {
                MirrorProvider::Official
            }
        }
    };
    let target_url = MirrorManager::rewrite_url(&version_url, provider);

    match VersionManifest::fetch_remote(&target_url).await {
        Ok(m) => Ok(m),
        Err(e) => Err(format!("Failed to fetch version details: {}", e)),
    }
}

#[tauri::command]
pub async fn get_loader_versions(
    loader: String,
    mc_version: String,
    mirror: Option<String>,
) -> Result<Vec<LoaderVersionInfo>, String> {
    let kind = match LoaderKind::from_str_loose(&loader) {
        Some(k) => k,
        None => return Ok(vec![]),
    };

    let _ = mirror; // for future mirror routing if needed

    LoaderVersionInfo::fetch_remote_loaders(kind, &mc_version)
        .await
        .map_err(|e| format!("Failed to fetch {} versions for MC {}: {}", loader, mc_version, e))
}
