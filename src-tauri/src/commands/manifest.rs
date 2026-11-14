//! Version manifest commands fetching real Mojang metadata.

use focusite_core::manifest::{LoaderKind, LoaderVersionInfo, VersionManifest, VersionManifestV2};
use focusite_download::mirror::{MirrorManager, MirrorProvider};

#[tauri::command]
pub async fn get_version_manifest(mirror: Option<String>) -> Result<VersionManifestV2, String> {
    let mirror_enabled = super::settings::is_bmclapi_mirror_enabled();
    let base_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let provider = match mirror.as_deref() {
        Some("bmclapi") => MirrorProvider::Bmclapi,
        Some("mcbbs") => MirrorProvider::Mcbbs,
        Some("official") => MirrorProvider::Official,
        _ => {
            if mirror_enabled {
                MirrorProvider::Bmclapi
            } else {
                MirrorProvider::Official
            }
        }
    };
    let target_url = MirrorManager::rewrite_url(base_url, provider);

    match VersionManifestV2::fetch_remote(&target_url).await {
        Ok(v2) => Ok(v2),
        Err(e) => Err(format!("無法取得版本清單：{}", e)),
    }
}

#[tauri::command]
pub async fn get_version_detail(
    version_url: String,
    mirror: Option<String>,
) -> Result<VersionManifest, String> {
    let mirror_enabled = super::settings::is_bmclapi_mirror_enabled();
    let provider = match mirror.as_deref() {
        Some("bmclapi") => MirrorProvider::Bmclapi,
        Some("mcbbs") => MirrorProvider::Mcbbs,
        Some("official") => MirrorProvider::Official,
        _ => {
            if mirror_enabled {
                MirrorProvider::Bmclapi
            } else {
                MirrorProvider::Official
            }
        }
    };
    let target_url = MirrorManager::rewrite_url(&version_url, provider);

    match VersionManifest::fetch_remote(&target_url).await {
        Ok(m) => Ok(m),
        Err(e) => Err(format!("無法取得版本詳細資料：{}", e)),
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
        .map_err(|e| format!("無法取得 Minecraft {1} 的 {0} 版本清單：{2}", loader, mc_version, e))
}
