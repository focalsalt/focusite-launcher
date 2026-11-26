//! Workshop commands for Modrinth browsing, dependency resolution, and stack migration.

use super::ui_language::tr;
use std::path::PathBuf;
use std::time::Duration;
use focusite_cas::CasManager;
use focusite_download::chunked::DownloadTask;
use focusite_download::mirror::{MirrorManager, MirrorProvider};
use focusite_download::Downloader;
use focusite_modpacks::stack_migration::{plan_stack_migration, MigrationPlan};
use focusite_modpacks::workshop::{
    get_project_detail, list_categories, list_project_versions, resolve_install_plan,
    search_projects, InstallPlan, SearchFilters, WorkshopCategory, WorkshopProjectDetail,
    WorkshopProjectSummary, WorkshopVersionItem,
};
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Manager};
use tracing::info;

use super::instance::{
    get_instances_dir, is_instance_busy, read_instance_config, validate_safe_id,
};

/// Validates that a file name has no path traversal and uses safe mod/pack extensions.
pub fn sanitize_safe_package_filename(filename: &str) -> Result<String, String> {
    let trimmed = filename.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.contains(':')
        || trimmed.starts_with('.')
    {
        return Err(format!("E_FILE_NAME_ILLEGAL: {}", filename));
    }

    if !(trimmed.ends_with(".jar") || trimmed.ends_with(".zip") || trimmed.ends_with(".mrpack")) {
        return Err(format!("E_FILE_TYPE_BLOCKED: {}", trimmed));
    }

    Ok(trimmed.to_string())
}

/// Validates that a download URL uses HTTPS from approved reputable CDN domains. Plain HTTP is refused:
/// a file without a published hash could otherwise be swapped in transit.
pub fn validate_download_url(url_str: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url_str).map_err(|e| format!("E_DOWNLOAD_URL_INVALID: {}", e))?;
    if parsed.scheme() != "https" {
        return Err("E_DOWNLOAD_NOT_HTTPS".into());
    }
    let host = parsed.host_str().unwrap_or("");
    let allowed_exact = [
        "cdn.modrinth.com",
        "edge.forgecdn.net",
        "mediafilez.forgecdn.net",
        "bmclapi2.bangbang93.com",
        "piston-data.mojang.com",
        "launcher.mojang.com",
    ];
    let is_allowed = allowed_exact.contains(&host)
        || host.ends_with(".modrinth.com")
        || host.ends_with(".curseforge.com")
        || host.ends_with(".forgecdn.net");

    if !is_allowed {
        return Err(format!("E_DOWNLOAD_UNTRUSTED: {}", host));
    }
    Ok(())
}

/// Computes a safe window label for a specific instance and project type workshop:
/// `workshop-{hash12}-{project_type}`
pub fn get_instance_workshop_window_label(instance_id: &str, project_type: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(instance_id.as_bytes());
    let hash_str = format!("{:x}", hasher.finalize());
    let short_hash = &hash_str[..12];
    let safe_type = project_type
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect::<String>();
    format!("workshop-{}-{}", short_hash, safe_type)
}

#[tauri::command]
pub async fn open_instance_workshop_window(
    app: AppHandle,
    instance_id: String,
    project_type: String, // "mod" | "resourcepack" | "shader"
) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let win_label = get_instance_workshop_window_label(&instance_id, &project_type);

    if let Some(existing) = app.get_webview_window(&win_label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let inst_dir = get_instances_dir().join(&instance_id);
    let inst_name = if let Ok(cfg) = read_instance_config(&inst_dir) {
        cfg.name
    } else {
        instance_id.clone()
    };

    let encoded_id =
        url::form_urlencoded::byte_serialize(instance_id.as_bytes()).collect::<String>();
    let encoded_type =
        url::form_urlencoded::byte_serialize(project_type.as_bytes()).collect::<String>();

    let type_label = match project_type.as_str() {
        "resourcepack" => tr!("材質包工作坊", "Resource Pack Workshop"),
        "shader" => tr!("光影包工作坊", "Shader Workshop"),
        _ => tr!("模組工作坊", "Mod Workshop"),
    };

    let url_str = format!(
        "index.html#/workshop?instanceId={}&type={}",
        encoded_id, encoded_type
    );

    // Open at the main window's current size.
    let (width, height) = app
        .get_webview_window("main")
        .and_then(|m| {
            let sf = m.scale_factor().ok()?;
            let size = m.inner_size().ok()?;
            let (w, h) = (size.width as f64 / sf, size.height as f64 / sf);
            (w >= 760.0 && h >= 500.0).then_some((w, h))
        })
        .unwrap_or((1280.0, 720.0));

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        &win_label,
        tauri::WebviewUrl::App(url_str.into()),
    )
    .title(format!("Focusite {} — {}", type_label, inst_name))
    .inner_size(width, height)
    .min_inner_size(760.0, 500.0)
    .decorations(false)
    .resizable(true)
    // Stay hidden until the page has painted (the frontend calls show), so there is no white flash.
    .visible(false)
    .background_color(tauri::window::Color(10, 15, 29, 255));

    // Must match the main window exactly, otherwise WebView2 fails with HRESULT 0x8007139F.
    #[cfg(windows)]
    let builder = builder.additional_browser_args(crate::get_webview2_browser_arguments());

    builder.build().map_err(super::ctx("E_WORKSHOP_WINDOW_FAILED"))?;
    Ok(())
}

#[tauri::command]
pub async fn workshop_search_projects(
    query: String,
    project_type: String,
    game_version: Option<String>,
    loader: Option<String>,
    filters: Option<SearchFilters>,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<WorkshopProjectSummary>, String> {
    let client = super::http().clone();
    search_projects(
        &client,
        &query,
        &project_type,
        game_version.as_deref(),
        loader.as_deref(),
        &filters.unwrap_or_default(),
        offset.unwrap_or(0),
        limit.unwrap_or(20),
    )
    .await
    .map_err(super::ctx("E_WORKSHOP_SEARCH_FAILED"))
}

#[tauri::command]
pub async fn workshop_list_categories(project_type: String) -> Result<Vec<WorkshopCategory>, String> {
    list_categories(super::http(), &project_type)
        .await
        .map_err(super::ctx("E_WORKSHOP_CATEGORIES_FAILED"))
}

#[tauri::command]
pub async fn workshop_get_project(project_id: String) -> Result<WorkshopProjectDetail, String> {
    get_project_detail(super::http(), &project_id)
        .await
        .map_err(super::ctx("E_WORKSHOP_PROJECT_FAILED"))
}

#[tauri::command]
pub async fn workshop_list_versions(
    project_id: String,
    game_version: Option<String>,
    loader: Option<String>,
) -> Result<Vec<WorkshopVersionItem>, String> {
    list_project_versions(
        super::http(),
        &project_id,
        game_version.as_deref(),
        loader.as_deref(),
    )
    .await
    .map_err(super::ctx("E_WORKSHOP_VERSIONS_FAILED"))
}

#[tauri::command]
pub async fn workshop_resolve_install_plan(
    instance_id: String,
    selected_items: Vec<(String, String)>, // Vec<(project_id, version_id)>
) -> Result<InstallPlan, String> {
    validate_safe_id(&instance_id)?;
    let inst_dir = get_instances_dir().join(&instance_id);
    let cfg = read_instance_config(&inst_dir).map_err(super::ctx("E_INSTANCE_CONFIG_UNREADABLE"))?;
    let mods_dir = inst_dir.join("minecraft").join("mods");

    let client = super::http().clone();
    resolve_install_plan(
        &client,
        &selected_items,
        &mods_dir,
        &cfg.version,
        &cfg.loader,
    )
    .await
    .map_err(super::ctx("E_DEPENDENCIES_FAILED"))
}

#[tauri::command]
pub async fn workshop_execute_install_plan(
    instance_id: String,
    project_type: String,
    items_to_download: Vec<focusite_modpacks::workshop::InstallPlanItem>,
) -> Result<usize, String> {
    validate_safe_id(&instance_id)?;
    if is_instance_busy(&instance_id) {
        return Err("E_INSTANCE_BUSY".into());
    }
    let inst_dir = get_instances_dir().join(&instance_id);
    let mc_dir = inst_dir.join("minecraft");

    let target_dir = match project_type.as_str() {
        "resourcepack" => mc_dir.join("resourcepacks"),
        "shader" => mc_dir.join("shaderpacks"),
        _ => mc_dir.join("mods"),
    };
    std::fs::create_dir_all(&target_dir).map_err(super::ctx("E_TARGET_FOLDER_CREATE_FAILED"))?;

    // Verify target directory has no traversal
    let canon_target = target_dir.canonicalize().map_err(super::ctx("E_TARGET_FOLDER_INVALID"))?;
    let canon_mc = mc_dir.canonicalize().map_err(super::ctx("E_GAME_FOLDER_INVALID"))?;
    if !canon_target.starts_with(&canon_mc) {
        return Err("E_TARGET_FOLDER_OUTSIDE".into());
    }

    let app_data = super::get_app_data_dir();
    let cas_dir = app_data.join("cas");
    let cas = CasManager::new(&cas_dir);

    let mirror_enabled = super::settings::is_bmclapi_mirror_enabled();
    let provider = if mirror_enabled {
        MirrorProvider::Bmclapi
    } else {
        MirrorProvider::Official
    };

    let downloader = Downloader::new_with_provider(
        provider,
        false,
        Duration::from_secs(10),
        Duration::from_secs(15),
        8,
    );

    let mut download_tasks = Vec::new();
    let temp_cache_dir = std::env::temp_dir().join(format!("fc_ws_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_cache_dir).map_err(super::ctx("E_TEMP_FOLDER_CREATE_FAILED"))?;

    // Sanitize all items before taking action
    for item in &items_to_download {
        let safe_filename = sanitize_safe_package_filename(&item.filename)?;
        validate_download_url(&item.download_url)?;

        let dest_file = target_dir.join(&safe_filename);

        // Check CAS
        if !item.sha1.is_empty() && cas.exists(&item.sha1) {
            let _ = cas.link_to_instance(&item.sha1, &dest_file);
            continue;
        }

        let temp_download = temp_cache_dir.join(&safe_filename);
        let rewritten_url = MirrorManager::rewrite_url(&item.download_url, provider);

        download_tasks.push(DownloadTask {
            url: rewritten_url,
            destination: temp_download.to_string_lossy().to_string(),
            expected_sha1: if item.sha1.is_empty() {
                None
            } else {
                Some(item.sha1.clone())
            },
            expected_size: Some(item.size),
        });
    }

    if !download_tasks.is_empty() {
        if let Err(e) = downloader.download_batch(download_tasks, None).await {
            let _ = std::fs::remove_dir_all(&temp_cache_dir);
            return Err(format!("E_MOD_DOWNLOAD_FAILED: {}", e));
        }
    }

    // Move downloaded files to target dir and register to CAS
    let mut installed_count = 0;
    for item in items_to_download {
        let safe_filename = match sanitize_safe_package_filename(&item.filename) {
            Ok(n) => n,
            Err(_) => continue,
        };
        let temp_download = temp_cache_dir.join(&safe_filename);
        let dest_file = target_dir.join(&safe_filename);

        if temp_download.is_file() {
            let sha1_opt = if item.sha1.is_empty() {
                None
            } else {
                Some(item.sha1.as_str())
            };
            let placed = if let Ok(hash) = cas.store_file(&temp_download, sha1_opt) {
                cas.link_to_instance(&hash, &dest_file).is_ok()
            } else {
                std::fs::copy(&temp_download, &dest_file).is_ok()
            };
            if placed {
                let _ = std::fs::remove_file(&temp_download);
                installed_count += 1;
            } else {
                let _ = std::fs::remove_dir_all(&temp_cache_dir);
                return Err(format!("E_MOD_PLACE_FAILED: {}", safe_filename));
            }
        } else if dest_file.is_file() {
            // Already placed or linked via CAS
            installed_count += 1;
        }
    }

    let _ = std::fs::remove_dir_all(&temp_cache_dir);
    info!("Workshop install completed for instance {}, count: {}", instance_id, installed_count);
    Ok(installed_count)
}

/// Validates migration targets that later become path components and URL segments.
fn validate_migration_target(
    target_version: &str,
    target_loader: &str,
    target_loader_version: Option<&str>,
) -> Result<(), String> {
    super::download::validate_version_id(target_version)?;
    match target_loader.to_ascii_lowercase().as_str() {
        "vanilla" => {}
        "custom" => {
            // The "loader version" of a custom loader is the jar file name in `custom_jar/`.
            super::instance::validate_custom_jar_name(target_loader_version.map(str::trim).unwrap_or(""))?;
        }
        "fabric" | "quilt" => {
            let v = target_loader_version.map(str::trim).unwrap_or("");
            if v.is_empty() {
                return Err("E_LOADER_VERSION_REQUIRED".into());
            }
            super::download::validate_version_id(v)?;
        }
        other => {
            return Err(format!("E_MIGRATE_LOADER_UNSUPPORTED: {}", other));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn instance_plan_stack_migration(
    instance_id: String,
    target_version: String,
    target_loader: String,
) -> Result<MigrationPlan, String> {
    validate_safe_id(&instance_id)?;
    if is_instance_busy(&instance_id) {
        return Err("E_INSTANCE_BUSY".into());
    }
    super::download::validate_version_id(&target_version)?;
    let inst_dir = get_instances_dir().join(&instance_id);
    let cfg = read_instance_config(&inst_dir).map_err(super::ctx("E_INSTANCE_CONFIG_UNREADABLE"))?;
    let mods_dir = inst_dir.join("minecraft").join("mods");

    if target_loader.eq_ignore_ascii_case("custom") {
        return Ok(no_mod_changes(&cfg.version, &cfg.loader, &target_version, &target_loader));
    }

    let client = super::http().clone();
    plan_stack_migration(
        &client,
        &mods_dir,
        &cfg.version,
        &cfg.loader,
        &target_version,
        &target_loader,
    )
    .await
    .map_err(super::ctx("E_COMPATIBILITY_FAILED"))
}

/// A custom loader has no Modrinth metadata, so mods are left exactly as they are.
fn no_mod_changes(cur_ver: &str, cur_loader: &str, target_ver: &str, target_loader: &str) -> MigrationPlan {
    MigrationPlan {
        current_version: cur_ver.to_string(),
        current_loader: cur_loader.to_string(),
        target_version: target_ver.to_string(),
        target_loader: target_loader.to_string(),
        upgradable: Vec::new(),
        incompatible: Vec::new(),
        compatible_unchanged: Vec::new(),
    }
}

#[tauri::command]
pub async fn instance_execute_stack_migration(
    instance_id: String,
    target_version: String,
    target_loader: String,
    target_loader_version: Option<String>,
    _untrusted_plan: MigrationPlan,
) -> Result<super::instance::InstanceSummaryDto, String> {
    validate_safe_id(&instance_id)?;
    if is_instance_busy(&instance_id) {
        return Err("E_INSTANCE_BUSY".into());
    }
    validate_migration_target(&target_version, &target_loader, target_loader_version.as_deref())?;
    let inst_dir = get_instances_dir().join(&instance_id);
    let cfg = read_instance_config(&inst_dir).map_err(super::ctx("E_INSTANCE_CONFIG_UNREADABLE"))?;
    let mods_dir = inst_dir.join("minecraft").join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(super::ctx("E_MODS_FOLDER_CREATE_FAILED"))?;

    // Authoritatively re-generate migration plan on backend to prevent client-side tampering
    let client = super::http().clone();
    let is_custom = target_loader.eq_ignore_ascii_case("custom");
    if is_custom {
        let jar = target_loader_version.as_deref().map(str::trim).unwrap_or("");
        if !inst_dir.join(super::instance::CUSTOM_JAR_DIR).join(jar).is_file() {
            return Err(format!("E_JAR_NOT_FOUND: {}: {}", super::instance::CUSTOM_JAR_DIR, jar));
        }
    }
    let verified_plan = if is_custom {
        no_mod_changes(&cfg.version, &cfg.loader, &target_version, &target_loader)
    } else {
        plan_stack_migration(
            &client,
            &mods_dir,
            &cfg.version,
            &cfg.loader,
            &target_version,
            &target_loader,
        )
        .await
        .map_err(|e| format!("E_MIGRATION_PLAN_FAILED: {}", e))?
    };

    // Atomic preparation: pre-download all upgradable files into temp directory first
    let temp_stage_dir = std::env::temp_dir().join(format!("fc_migr_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_stage_dir).map_err(super::ctx("E_TEMP_FOLDER_CREATE_FAILED"))?;

    let downloader = Downloader::default();
    let mut staged_downloads = Vec::new();

    for up in &verified_plan.upgradable {
        let safe_new_name = sanitize_safe_package_filename(&up.new_filename)?;
        let safe_orig_name = sanitize_safe_package_filename(&up.original_filename)?;
        validate_download_url(&up.download_url)?;

        let stage_dest = temp_stage_dir.join(&safe_new_name);
        if let Err(e) = downloader
            .download_file(
                &up.download_url,
                &stage_dest,
                Some(&up.sha1),
                None,
                &up.mod_name,
            )
            .await
        {
            let _ = std::fs::remove_dir_all(&temp_stage_dir);
            return Err(format!("E_MIGRATION_DOWNLOAD_FAILED: {}: {}", up.mod_name, e));
        }

        staged_downloads.push((safe_orig_name, safe_new_name, stage_dest));
    }

    // Now commit file changes atomically using a rollback journal
    enum JournalEntry {
        Renamed { from: PathBuf, to: PathBuf },
        Copied { dest: PathBuf },
    }
    let mut journal: Vec<JournalEntry> = Vec::new();

    let mut commit_ops = || -> Result<(), std::io::Error> {
        // 1. Rename incompatible mods to .incompatible.backup
        for incomp in &verified_plan.incompatible {
            if let Ok(safe_incomp) = sanitize_safe_package_filename(incomp) {
                let orig = mods_dir.join(&safe_incomp);
                if orig.is_file() {
                    let backup = mods_dir.join(format!("{}.incompatible.backup", safe_incomp));
                    std::fs::rename(&orig, &backup)?;
                    journal.push(JournalEntry::Renamed { from: orig, to: backup });
                }
            }
        }

        // 2. Backup old upgradable and copy staged files
        for (safe_orig, safe_new, stage_file) in &staged_downloads {
            let orig = mods_dir.join(safe_orig);
            if orig.is_file() {
                let backup = mods_dir.join(format!("{}.old.backup", safe_orig));
                std::fs::rename(&orig, &backup)?;
                journal.push(JournalEntry::Renamed { from: orig, to: backup });
            }
            let dest = mods_dir.join(safe_new);
            std::fs::copy(stage_file, &dest)?;
            journal.push(JournalEntry::Copied { dest });
        }
        Ok(())
    };

    if let Err(e) = commit_ops() {
        // Rollback all file changes in reverse order
        for op in journal.into_iter().rev() {
            match op {
                JournalEntry::Renamed { from, to } => {
                    let _ = std::fs::rename(to, from);
                }
                JournalEntry::Copied { dest } => {
                    let _ = std::fs::remove_file(dest);
                }
            }
        }
        let _ = std::fs::remove_dir_all(&temp_stage_dir);
        return Err(format!("E_MIGRATION_COMMIT_FAILED: {}", e));
    }

    let _ = std::fs::remove_dir_all(&temp_stage_dir);

    // 3. Update instance config: re-read under the lock, so edits made during the long migration are kept.
    let updated = super::instance::update_instance_config(&inst_dir, |c| {
        c.version = target_version;
        c.loader = target_loader;
        c.loader_version = target_loader_version;
        c.clone()
    });
    let cfg = match updated {
        Ok(cfg) => cfg,
        Err(e) => {
            // Rollback on config failure
            for op in journal.into_iter().rev() {
                match op {
                    JournalEntry::Renamed { from, to } => {
                        let _ = std::fs::rename(to, from);
                    }
                    JournalEntry::Copied { dest } => {
                        let _ = std::fs::remove_file(dest);
                    }
                }
            }
            return Err(format!("E_MIGRATION_CONFIG_FAILED: {}", e));
        }
    };

    let summary = super::instance::convert_disk_config_to_summary(&inst_dir, cfg);
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_package_filename_sanitization() {
        assert_eq!(
            sanitize_safe_package_filename("sodium-fabric-0.5.8.jar").unwrap(),
            "sodium-fabric-0.5.8.jar"
        );
        assert_eq!(
            sanitize_safe_package_filename("Faithful32x.zip").unwrap(),
            "Faithful32x.zip"
        );

        // Path traversal attempts
        assert!(sanitize_safe_package_filename("../malicious.jar").is_err());
        assert!(sanitize_safe_package_filename("C:\\Windows\\system32.jar").is_err());
        assert!(sanitize_safe_package_filename("/etc/passwd.jar").is_err());
        assert!(sanitize_safe_package_filename("bad.exe").is_err());
        assert!(sanitize_safe_package_filename(".hidden.jar").is_err());
    }

    #[test]
    fn test_download_url_validation() {
        assert!(validate_download_url("https://cdn.modrinth.com/data/A/versions/B/mod.jar").is_ok());
        assert!(validate_download_url("https://edge.forgecdn.net/files/123/mod.jar").is_ok());

        // Block untrusted domains, typosquatting domains, and unauthorized platforms
        assert!(validate_download_url("https://evilmodrinth.com/x.jar").is_err());
        assert!(validate_download_url("https://modrinth.com.evil.io/x.jar").is_err());
        assert!(validate_download_url("https://raw.githubusercontent.com/evil/repo/x.jar").is_err());
        assert!(validate_download_url("https://github.com/evil/repo/releases/download/v1/x.jar").is_err());
        assert!(validate_download_url("https://evil-attacker.com/mod.jar").is_err());
        assert!(validate_download_url("file:///C:/secret.txt").is_err());
        assert!(validate_download_url("http://cdn.modrinth.com/data/A/versions/B/mod.jar").is_err());
        assert!(validate_download_url("javascript:alert(1)").is_err());
    }
}
