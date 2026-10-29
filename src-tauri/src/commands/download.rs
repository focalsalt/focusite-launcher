//! Real download commands using Downloader and CAS with live progress events.

use std::time::Duration;
use focusite_cas::CasManager;
use focusite_core::manifest::{VersionManifest, VersionManifestV2};
use focusite_download::mirror::{MirrorManager, MirrorProvider};
use focusite_download::Downloader;
use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct ProgressPayload {
    pub version_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_sec: u64,
}

/// Validates that a version ID contains only safe characters.
pub fn validate_version_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Version ID cannot be empty".into());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Invalid version ID: path traversal characters detected".into());
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("Invalid version ID: illegal characters".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn download_version_client(
    app: tauri::AppHandle,
    version_id: String,
    mirror: Option<String>,
) -> Result<String, String> {
    validate_version_id(&version_id)?;

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

    let manifest_url = MirrorManager::rewrite_url(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
        provider,
    );

    let v2 = VersionManifestV2::fetch_remote(&manifest_url)
        .await
        .map_err(|e| format!("Failed to fetch version manifest root: {}", e))?;

    let version_summary = v2
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| format!("Version {} not found in manifest", version_id))?;

    let detail_url = MirrorManager::rewrite_url(&version_summary.url, provider);
    let detail = VersionManifest::fetch_remote(&detail_url)
        .await
        .map_err(|e| format!("Failed to fetch version details for {}: {}", version_id, e))?;

    let client_download = detail
        .downloads
        .map(|d| d.client)
        .ok_or_else(|| format!("Version {} has no client download artifact", version_id))?;

    let cas_dir = super::get_app_data_dir().join("cas");
    let cas = CasManager::new(&cas_dir);

    // If client jar already in CAS, skip downloading
    if cas.exists(&client_download.sha1) {
        let _ = app.emit(
            "download-progress",
            ProgressPayload {
                version_id: version_id.clone(),
                downloaded_bytes: client_download.size,
                total_bytes: Some(client_download.size),
                speed_bytes_per_sec: 0,
            },
        );
        let _ = app.emit("download-finished", &version_id);
        return Ok(format!("Version {} client already cached in CAS", version_id));
    }

    let temp_download_dir = std::env::temp_dir().join("focusite_downloads");
    let temp_file = temp_download_dir.join(format!("{}.jar", version_id));

    let (tx, mut rx) = tokio::sync::mpsc::channel::<focusite_download::DownloadProgress>(100);
    let app_clone = app.clone();
    let vid_clone = version_id.clone();

    tokio::spawn(async move {
        while let Some(prog) = rx.recv().await {
            let _ = app_clone.emit(
                "download-progress",
                ProgressPayload {
                    version_id: vid_clone.clone(),
                    downloaded_bytes: prog.downloaded_bytes,
                    total_bytes: prog.total_bytes,
                    speed_bytes_per_sec: prog.speed_bytes_per_sec,
                },
            );
        }
    });

    let downloader = Downloader::new_with_provider(
        provider,
        false,
        Duration::from_secs(10),
        Duration::from_secs(15),
        16,
    );
    downloader
        .download_file(
            &client_download.url,
            &temp_file,
            Some(&client_download.sha1),
            Some(tx),
            &version_id,
        )
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    // Store downloaded client jar into CAS
    cas.store_file(&temp_file, Some(&client_download.sha1))
        .map_err(|e| format!("CAS store failed: {}", e))?;

    let _ = tokio::fs::remove_file(&temp_file).await;
    let _ = app.emit("download-finished", &version_id);

    Ok(format!("Successfully downloaded and cached {}", version_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_version_id() {
        assert!(validate_version_id("1.21.4").is_ok());
        assert!(validate_version_id("24w45a").is_ok());
        assert!(validate_version_id("1.20.4-pre1").is_ok());

        assert!(validate_version_id("../1.21.4").is_err());
        assert!(validate_version_id("1.21.4/evil").is_err());
        assert!(validate_version_id("").is_err());
    }
}
