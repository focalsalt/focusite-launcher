//! Modpack import commands supporting .mrpack (Modrinth) and .zip (CurseForge) formats.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use focusite_cas::CasManager;
use focusite_modpacks::curseforge::{
    rescan_missing_mods as cf_rescan, unpack_curseforge_pack, MissingModItem,
};
use focusite_modpacks::mrpack::unpack_mrpack;
use super::instance::{
    default_jvm_args, default_max_memory, default_min_memory, get_instances_dir,
    validate_safe_filename, validate_safe_id, write_instance_config, InstanceDiskConfig,
};
use super::settings::load_settings_from_disk;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackImportResult {
    pub instance_id: String,
    pub instance_name: String,
    pub version: String,
    pub loader: String,
    pub missing_mods: Vec<MissingModItem>,
    pub is_completed: bool,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFileResponse {
    data: CurseForgeFileData,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFileData {
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "downloadUrl")]
    download_url: Option<String>,
}

#[tauri::command]
pub async fn import_modpack(
    pack_path: String,
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let path = PathBuf::from(&pack_path);
    if !path.is_file() {
        return Err(format!("模組包檔案不存在: {}", pack_path));
    }

    let archive_bytes = std::fs::read(&path)
        .map_err(|e| format!("無法讀取模組包檔案: {}", e))?;

    let is_mrpack = path
        .extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("mrpack"))
        .unwrap_or(false);

    if is_mrpack {
        import_mrpack_internal(&archive_bytes, custom_name).await
    } else {
        import_curseforge_internal(&archive_bytes, custom_name).await
    }
}

async fn import_mrpack_internal(
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let temp_dir = std::env::temp_dir().join(format!("focusite_mrpack_unpack_{}", uuid::Uuid::new_v4()));
    let temp_mc = temp_dir.join("minecraft");
    std::fs::create_dir_all(&temp_mc).map_err(|e| e.to_string())?;

    let (index, _) = unpack_mrpack(archive_bytes, &temp_mc)
        .map_err(|e| format!("解壓 .mrpack 失敗: {}", e))?;

    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_else(|| "1.21.4".into());

    let (loader, loader_version) = if let Some(ver) = index.dependencies.get("fabric-loader") {
        ("Fabric".to_string(), Some(ver.clone()))
    } else if let Some(ver) = index.dependencies.get("neoforge") {
        ("NeoForge".to_string(), Some(ver.clone()))
    } else if let Some(ver) = index.dependencies.get("forge") {
        ("Forge".to_string(), Some(ver.clone()))
    } else if let Some(ver) = index.dependencies.get("quilt-loader") {
        ("Quilt".to_string(), Some(ver.clone()))
    } else {
        ("Vanilla".to_string(), None)
    };

    let name = custom_name.unwrap_or_else(|| index.name.clone());
    let instance_id = name.trim().replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_");
    validate_safe_id(&instance_id)?;

    let inst_dir = get_instances_dir().join(&instance_id);
    let mc_dir = inst_dir.join("minecraft");
    std::fs::create_dir_all(&mc_dir)
        .map_err(|e| format!("無法建立實例目錄: {}", e))?;

    // Move unpacked overrides from temp to inst_dir
    let _ = unpack_mrpack(archive_bytes, &mc_dir);
    let _ = std::fs::remove_dir_all(&temp_dir);

    // Write instance.cfg
    let disk_cfg = InstanceDiskConfig {
        id: instance_id.clone(),
        name: name.clone(),
        version: mc_version.clone(),
        loader: loader.clone(),
        loader_version,
        description: index.summary,
        is_favorite: false,
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        show_log_on_launch: false,
        min_memory_mb: default_min_memory(),
        max_memory_mb: default_max_memory(),
        java_path: None,
        jvm_args: default_jvm_args(),
    };
    write_instance_config(&inst_dir, &disk_cfg)?;

    // Download mrpack files with CAS deduplication and path traversal validation
    let cas_dir = super::get_app_data_dir().join("cas");
    let cas = CasManager::new(&cas_dir);

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    for file in index.files {
        if let Some(ref env) = file.env {
            if env.client.as_deref() == Some("unsupported") {
                continue;
            }
        }
        if file.downloads.is_empty() {
            continue;
        }

        let rel_path_str = file.path.replace('\\', "/");
        if rel_path_str.starts_with('/') || rel_path_str.contains("..") || rel_path_str.contains(':') {
            return Err(format!("偵測到非法 mrpack 檔案路徑: {}", file.path));
        }

        let target_path = mc_dir.join(&rel_path_str);
        if !target_path.starts_with(&mc_dir) {
            return Err(format!("檔案路徑逃逸出實例目錄: {}", file.path));
        }

        if let Some(parent) = target_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if !target_path.exists() {
            if let Ok(resp) = http.get(&file.downloads[0]).send().await {
                if let Ok(bytes) = resp.bytes().await {
                    let expected_sha1 = file.hashes.get("sha1").map(|s| s.as_str());
                    let cas_hash = cas
                        .store_bytes(&bytes, expected_sha1)
                        .map_err(|e| format!("寫入 CAS 失敗: {}", e))?;
                    let _ = cas.link_to_instance(&cas_hash, &target_path);
                }
            }
        }
    }

    Ok(ModpackImportResult {
        instance_id,
        instance_name: name,
        version: mc_version,
        loader,
        missing_mods: Vec::new(),
        is_completed: true,
    })
}

async fn import_curseforge_internal(
    archive_bytes: &[u8],
    custom_name: Option<String>,
) -> Result<ModpackImportResult, String> {
    let temp_dir = std::env::temp_dir().join(format!("focusite_cf_unpack_{}", uuid::Uuid::new_v4()));
    let temp_mc = temp_dir.join("minecraft");
    std::fs::create_dir_all(&temp_mc).map_err(|e| e.to_string())?;

    let (manifest, modlist_map, _) = unpack_curseforge_pack(archive_bytes, &temp_mc)
        .map_err(|e| format!("解壓 CurseForge 模組包失敗: {}", e))?;
    let _ = std::fs::remove_dir_all(&temp_dir);

    let mc_version = manifest.minecraft.version.clone();
    let (loader, loader_version) = if let Some(primary) = manifest
        .minecraft
        .mod_loaders
        .iter()
        .find(|l| l.primary)
        .or_else(|| manifest.minecraft.mod_loaders.first())
    {
        let id_lower = primary.id.to_lowercase();
        if id_lower.starts_with("forge-") {
            ("Forge".to_string(), Some(primary.id.replace("forge-", "")))
        } else if id_lower.starts_with("neoforge-") {
            ("NeoForge".to_string(), Some(primary.id.replace("neoforge-", "")))
        } else if id_lower.starts_with("fabric-") {
            ("Fabric".to_string(), Some(primary.id.replace("fabric-", "")))
        } else if id_lower.starts_with("quilt-") {
            ("Quilt".to_string(), Some(primary.id.replace("quilt-", "")))
        } else {
            ("Vanilla".to_string(), None)
        }
    } else {
        ("Vanilla".to_string(), None)
    };

    let name = custom_name.unwrap_or_else(|| manifest.name.clone());
    let instance_id = name.trim().replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_");
    validate_safe_id(&instance_id)?;

    let inst_dir = get_instances_dir().join(&instance_id);
    let mc_dir = inst_dir.join("minecraft");
    let mods_dir = mc_dir.join("mods");
    std::fs::create_dir_all(&mods_dir)
        .map_err(|e| format!("無法建立實例 mods 目錄: {}", e))?;

    // Unpack overrides into instance
    let _ = unpack_curseforge_pack(archive_bytes, &mc_dir);

    // Write instance.cfg
    let disk_cfg = InstanceDiskConfig {
        id: instance_id.clone(),
        name: name.clone(),
        version: mc_version.clone(),
        loader: loader.clone(),
        loader_version,
        description: Some(format!("由 CurseForge 模組包「{}」導入", manifest.name)),
        is_favorite: false,
        created_at: chrono::Utc::now().timestamp_millis(),
        last_played_at: None,
        show_log_on_launch: false,
        min_memory_mb: default_min_memory(),
        max_memory_mb: default_max_memory(),
        java_path: None,
        jvm_args: default_jvm_args(),
    };
    write_instance_config(&inst_dir, &disk_cfg)?;

    let cas_dir = super::get_app_data_dir().join("cas");
    let cas = CasManager::new(&cas_dir);

    // Resolve mods with CurseForge API or build MissingModItem list
    let settings = load_settings_from_disk();
    let api_key = settings.curseforge_api_key.as_deref();

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut missing_mods: Vec<MissingModItem> = Vec::new();

    for file_ref in manifest.files {
        let mut downloaded = false;

        if let Some(key) = api_key {
            let api_url = format!(
                "https://api.curseforge.com/v1/mods/{}/files/{}",
                file_ref.project_id, file_ref.file_id
            );
            if let Ok(resp) = http.get(&api_url).header("x-api-key", key).send().await {
                if let Ok(file_info) = resp.json::<CurseForgeFileResponse>().await {
                    let raw_fname = Path::new(&file_info.data.file_name)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("mod.jar");

                    if validate_safe_filename(raw_fname).is_ok() {
                        if let Some(dl_url) = file_info.data.download_url {
                            let target_file = mods_dir.join(raw_fname);
                            if let Ok(dl_resp) = http.get(&dl_url).send().await {
                                if let Ok(bytes) = dl_resp.bytes().await {
                                    if let Ok(cas_hash) = cas.store_bytes(&bytes, None) {
                                        if cas.link_to_instance(&cas_hash, &target_file).is_ok() {
                                            downloaded = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if !downloaded {
            let (matched_name, web_url) = if let Some((url, name)) = modlist_map
                .iter()
                .find(|(url, _)| {
                    url.contains(&format!("/{}", file_ref.project_id))
                        || url.contains(&format!("projects/{}", file_ref.project_id))
                }) {
                    (name.clone(), url.clone())
                } else {
                    (
                        format!("Mod #{}", file_ref.project_id),
                        format!("https://www.curseforge.com/projects/{}", file_ref.project_id),
                    )
                };

            let safe_mod_name = matched_name.replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_");
            missing_mods.push(MissingModItem {
                project_id: file_ref.project_id,
                file_id: file_ref.file_id,
                name: matched_name,
                file_name: format!("{}-{}.jar", safe_mod_name.replace(' ', "-"), file_ref.file_id),
                web_url,
            });
        }
    }

    let is_completed = missing_mods.is_empty();

    Ok(ModpackImportResult {
        instance_id,
        instance_name: name,
        version: mc_version,
        loader,
        missing_mods,
        is_completed,
    })
}

#[tauri::command]
pub fn rescan_instance_missing_mods(
    instance_id: String,
    missing_mods: Vec<MissingModItem>,
) -> Result<Vec<MissingModItem>, String> {
    validate_safe_id(&instance_id)?;
    let mc_dir = get_instances_dir().join(&instance_id).join("minecraft");
    let remaining = cf_rescan(&mc_dir, &missing_mods);

    // Ingest all present mods into CAS for global deduplication
    let mods_dir = mc_dir.join("mods");
    if mods_dir.is_dir() {
        let cas_dir = super::get_app_data_dir().join("cas");
        let cas = CasManager::new(&cas_dir);
        if let Ok(entries) = std::fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = cas.store_file(&path, None);
                }
            }
        }
    }

    Ok(remaining)
}

#[tauri::command]
pub fn open_external_urls(urls: Vec<String>) -> Result<(), String> {
    for url in urls {
        let trimmed = url.trim();
        if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
            return Err(format!("拒絕開啟非 HTTP/HTTPS 協議之外部 URL: {}", trimmed));
        }

        #[cfg(windows)]
        {
            let _ = std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", trimmed])
                .spawn();
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("xdg-open").arg(trimmed).spawn();
        }
    }
    Ok(())
}
