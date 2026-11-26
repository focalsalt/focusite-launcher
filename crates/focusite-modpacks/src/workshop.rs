//! In-app mod, resource pack, and shader workshop engine (Modrinth v2 API integration).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::ModpackError;

pub const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";

fn get_user_agent() -> String {
    format!("Focusite-Launcher/{}", env!("CARGO_PKG_VERSION"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopProjectSummary {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub author: String,
    pub downloads: u64,
    pub follows: u64,
    pub project_type: String,
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopVersionItem {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub filename: String,
    pub download_url: String,
    pub size: u64,
    pub sha1: String,
    pub dependencies: Vec<WorkshopDependencyRef>,
    pub version_type: String, // "release" | "beta" | "alpha"
    pub date_published: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopProjectDetail {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    /// Markdown body of the project page.
    pub body: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub follows: u64,
    pub categories: Vec<String>,
    pub client_side: String,
    pub server_side: String,
    pub license: Option<String>,
    pub updated: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopCategory {
    pub name: String,
    pub header: String,
}

/// Extra Modrinth search filters mirroring the website's sidebar.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchFilters {
    #[serde(default)]
    pub categories: Vec<String>,
    /// "client" | "server"
    pub environment: Option<String>,
    /// "relevance" | "downloads" | "follows" | "newest" | "updated"
    pub sort: Option<String>,
}

fn is_safe_token(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkshopDependencyRef {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub dependency_type: String, // "required" | "optional" | "incompatible"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallPlanItem {
    pub project_id: String,
    pub version_id: String,
    pub name: String,
    pub filename: String,
    pub download_url: String,
    pub sha1: String,
    pub size: u64,
    pub is_primary: bool,
    pub is_required_dep: bool,
    pub is_optional_dep: bool,
    pub already_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallPlan {
    pub primary_items: Vec<InstallPlanItem>,
    pub required_dependencies: Vec<InstallPlanItem>,
    pub optional_dependencies: Vec<InstallPlanItem>,
    pub conflict_warnings: Vec<String>,
    pub total_download_size: u64,
}

/// Builds the Modrinth `facets` query value. Every user-supplied token is checked so it cannot
/// break out of its JSON string.
fn build_facets(
    project_type: &str,
    game_version: Option<&str>,
    loader: Option<&str>,
    filters: &SearchFilters,
) -> Result<String, ModpackError> {
    let bad = |what: &str| ModpackError::InvalidArchive(format!("invalid {}", what));
    if !is_safe_token(project_type) {
        return Err(bad("project type"));
    }
    let mut facets = vec![format!("[\"project_type:{}\"]", project_type)];

    if let Some(gv) = game_version.map(str::trim).filter(|v| !v.is_empty()) {
        if !is_safe_token(gv) {
            return Err(bad("game version"));
        }
        facets.push(format!("[\"versions:{}\"]", gv));
    }

    // Each selected category is its own facet group, i.e. AND semantics like the website.
    for cat in &filters.categories {
        if !is_safe_token(cat) {
            return Err(bad("category"));
        }
        facets.push(format!("[\"categories:{}\"]", cat));
    }

    match filters.environment.as_deref() {
        Some("client") => facets.push("[\"client_side:required\",\"client_side:optional\"]".into()),
        Some("server") => facets.push("[\"server_side:required\",\"server_side:optional\"]".into()),
        _ => {}
    }

    if let Some(ld) = loader {
        let clean_ld = ld.trim().to_lowercase();
        if clean_ld != "vanilla" && clean_ld != "custom" && is_safe_token(&clean_ld) {
            facets.push(format!("[\"categories:{}\"]", clean_ld));
        }
    }

    Ok(format!("[{}]", facets.join(",")))
}

/// Searches projects on Modrinth v2 API.
#[allow(clippy::too_many_arguments)]
pub async fn search_projects(
    client: &reqwest::Client,
    query: &str,
    project_type: &str, // "mod" | "resourcepack" | "shader"
    game_version: Option<&str>,
    loader: Option<&str>,
    filters: &SearchFilters,
    offset: usize,
    limit: usize,
) -> Result<Vec<WorkshopProjectSummary>, ModpackError> {
    let facets_param = build_facets(project_type, game_version, loader, filters)?;
    let index = filters
        .sort
        .as_deref()
        .filter(|v| matches!(*v, "downloads" | "follows" | "newest" | "updated"))
        .unwrap_or("relevance");
    let url = format!("{}/search", MODRINTH_API_BASE);

    let req = client
        .get(&url)
        .header("User-Agent", get_user_agent())
        .query(&[
            ("query", query),
            ("facets", &facets_param),
            ("index", index),
            ("offset", &offset.to_string()),
            ("limit", &limit.to_string()),
        ]);

    let resp = req.send().await.map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(ModpackError::InvalidArchive(format!(
            "Modrinth search API error: HTTP {}",
            resp.status()
        )));
    }

    #[derive(Deserialize)]
    struct ModrinthSearchResponse {
        hits: Vec<ModrinthSearchHit>,
    }

    #[derive(Deserialize)]
    struct ModrinthSearchHit {
        project_id: String,
        slug: String,
        title: String,
        description: String,
        icon_url: Option<String>,
        author: String,
        downloads: u64,
        follows: u64,
        project_type: String,
        categories: Option<Vec<String>>,
    }

    let raw: ModrinthSearchResponse = resp.json().await?;
    let summaries = raw
        .hits
        .into_iter()
        .map(|h| WorkshopProjectSummary {
            id: h.project_id,
            slug: h.slug,
            title: h.title,
            description: h.description,
            icon_url: h.icon_url,
            author: h.author,
            downloads: h.downloads,
            follows: h.follows,
            project_type: h.project_type,
            categories: h.categories.unwrap_or_default(),
        })
        .collect();

    Ok(summaries)
}

fn http_err(e: reqwest::Error) -> ModpackError {
    ModpackError::InvalidArchive(e.to_string())
}

async fn get_json<T: serde::de::DeserializeOwned>(
    req: reqwest::RequestBuilder,
) -> Result<T, ModpackError> {
    let resp = req.header("User-Agent", get_user_agent()).send().await.map_err(http_err)?;
    if !resp.status().is_success() {
        return Err(ModpackError::InvalidArchive(format!("Modrinth API error: HTTP {}", resp.status())));
    }
    resp.json::<T>().await.map_err(http_err)
}

/// Lists the filter categories Modrinth offers for one project type.
pub async fn list_categories(
    client: &reqwest::Client,
    project_type: &str,
) -> Result<Vec<WorkshopCategory>, ModpackError> {
    #[derive(Deserialize)]
    struct Raw {
        name: String,
        project_type: String,
        header: String,
    }
    let raw: Vec<Raw> = get_json(client.get(format!("{}/tag/category", MODRINTH_API_BASE))).await?;
    Ok(raw
        .into_iter()
        .filter(|c| c.project_type == project_type)
        .map(|c| WorkshopCategory { name: c.name, header: c.header })
        .collect())
}

/// Fetches the project page data (including the markdown body).
pub async fn get_project_detail(
    client: &reqwest::Client,
    project_id: &str,
) -> Result<WorkshopProjectDetail, ModpackError> {
    if !is_safe_token(project_id) {
        return Err(ModpackError::InvalidArchive("invalid project id".into()));
    }
    #[derive(Deserialize)]
    struct Lic {
        name: Option<String>,
    }
    #[derive(Deserialize)]
    struct Raw {
        id: String,
        slug: String,
        title: String,
        description: String,
        body: String,
        icon_url: Option<String>,
        downloads: u64,
        followers: u64,
        #[serde(default)]
        categories: Vec<String>,
        client_side: String,
        server_side: String,
        license: Option<Lic>,
        updated: String,
    }
    let r: Raw = get_json(client.get(format!("{}/project/{}", MODRINTH_API_BASE, project_id))).await?;
    Ok(WorkshopProjectDetail {
        id: r.id,
        slug: r.slug,
        title: r.title,
        description: r.description,
        body: r.body,
        icon_url: r.icon_url,
        downloads: r.downloads,
        follows: r.followers,
        categories: r.categories,
        client_side: r.client_side,
        server_side: r.server_side,
        license: r.license.and_then(|l| l.name),
        updated: r.updated,
    })
}

/// Lists a project's versions (newest first), optionally narrowed to a game version and loader.
pub async fn list_project_versions(
    client: &reqwest::Client,
    project_id: &str,
    game_version: Option<&str>,
    loader: Option<&str>,
) -> Result<Vec<WorkshopVersionItem>, ModpackError> {
    if !is_safe_token(project_id) {
        return Err(ModpackError::InvalidArchive("invalid project id".into()));
    }
    #[derive(Deserialize)]
    struct Raw {
        id: String,
        project_id: String,
        name: String,
        version_number: String,
        #[serde(default)]
        game_versions: Vec<String>,
        #[serde(default)]
        loaders: Vec<String>,
        files: Vec<RawFileItem>,
        dependencies: Option<Vec<RawDepItem>>,
        version_type: String,
        date_published: String,
    }
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(gv) = game_version.map(str::trim).filter(|v| is_safe_token(v)) {
        query.push(("game_versions", serde_json::to_string(&[gv]).unwrap_or_default()));
    }
    if let Some(ld) = loader
        .map(|l| l.trim().to_lowercase())
        .filter(|l| is_safe_token(l) && l != "vanilla" && l != "custom")
    {
        query.push(("loaders", serde_json::to_string(&[ld]).unwrap_or_default()));
    }
    let raw: Vec<Raw> = get_json(
        client
            .get(format!("{}/project/{}/version", MODRINTH_API_BASE, project_id))
            .query(&query),
    )
    .await?;
    Ok(raw
        .into_iter()
        .filter_map(|v| {
            let f = v.files.iter().find(|f| f.primary).or_else(|| v.files.first())?.clone();
            Some(WorkshopVersionItem {
                id: v.id,
                project_id: v.project_id,
                name: v.name,
                version_number: v.version_number,
                game_versions: v.game_versions,
                loaders: v.loaders,
                filename: f.filename,
                download_url: f.url,
                size: f.size,
                sha1: f.hashes.get("sha1").cloned().unwrap_or_default(),
                dependencies: v
                    .dependencies
                    .unwrap_or_default()
                    .into_iter()
                    .map(|d| WorkshopDependencyRef {
                        project_id: d.project_id,
                        version_id: d.version_id,
                        dependency_type: d.dependency_type,
                    })
                    .collect(),
                version_type: v.version_type,
                date_published: v.date_published,
            })
        })
        .collect())
}

/// Resolves a full installation plan for selected (project_id, version_id) items,
/// expanding recursive required dependencies and identifying already installed files.
pub async fn resolve_install_plan(
    client: &reqwest::Client,
    selected_items: &[(String, String)], // Vec<(project_id, version_id)>
    instance_mods_dir: &Path,
    game_version: &str,
    loader: &str,
) -> Result<InstallPlan, ModpackError> {
    // 1. Scan currently installed files
    let mut installed_filenames = HashSet::new();
    if let Ok(entries) = std::fs::read_dir(instance_mods_dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                installed_filenames.insert(
                    entry
                        .file_name()
                        .to_string_lossy()
                        .to_lowercase()
                        .to_string(),
                );
            }
        }
    }

    let mut primary_items = Vec::new();
    let mut required_dependencies = Vec::new();
    let mut optional_dependencies = Vec::new();
    let mut conflict_warnings = Vec::new();
    let mut visited_projects = HashSet::new();
    let mut total_download_size: u64 = 0;

    for (proj_id, ver_id) in selected_items {
        visited_projects.insert(proj_id.clone());

        // Fetch version detail from Modrinth
        let ver_url = format!("{}/version/{}", MODRINTH_API_BASE, ver_id);
        let resp = client
            .get(&ver_url)
            .header("User-Agent", get_user_agent())
            .send()
            .await
            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;

        if !resp.status().is_success() {
            continue;
        }

        let detail: RawVerItem = resp.json().await?;
        let file = detail
            .files
            .iter()
            .find(|f| f.primary)
            .or_else(|| detail.files.first());

        if let Some(f) = file {
            let sha1 = f.hashes.get("sha1").cloned().unwrap_or_default();
            let already = installed_filenames.contains(&f.filename.to_lowercase());
            if !already {
                total_download_size += f.size;
            }

            primary_items.push(InstallPlanItem {
                project_id: detail.project_id.clone(),
                version_id: detail.id.clone(),
                name: detail.name.clone(),
                filename: f.filename.clone(),
                download_url: f.url.clone(),
                sha1,
                size: f.size,
                is_primary: true,
                is_required_dep: false,
                is_optional_dep: false,
                already_installed: already,
            });

            // Parse dependencies with BFS queue
            let mut dep_queue: std::collections::VecDeque<(RawDepItem, usize)> = detail
                .dependencies
                .unwrap_or_default()
                .into_iter()
                .map(|d| (d, 1))
                .collect();

            while let Some((dep, depth)) = dep_queue.pop_front() {
                if depth > 4 {
                    if let Some(ref pid) = dep.project_id {
                        conflict_warnings.push(format!(
                            "E_DEPENDENCY_TOO_DEEP: {}",
                            pid
                        ));
                    }
                    continue;
                }
                if dep.dependency_type == "incompatible" {
                    conflict_warnings.push(format!(
                        "E_DEPENDENCY_INCOMPATIBLE: {}: {:?}",
                        detail.name, dep.project_id
                    ));
                } else if dep.dependency_type == "required" {
                    if let Some(ref dep_proj_id) = dep.project_id {
                        if !visited_projects.contains(dep_proj_id) {
                            visited_projects.insert(dep_proj_id.clone());
                            match resolve_dependency_item(
                                client,
                                dep_proj_id,
                                dep.version_id.as_deref(),
                                game_version,
                                loader,
                                &installed_filenames,
                                false,
                            )
                            .await
                            {
                                Ok((dep_item, sub_deps)) => {
                                    if !dep_item.already_installed {
                                        total_download_size += dep_item.size;
                                    }
                                    required_dependencies.push(dep_item);
                                    for sub in sub_deps {
                                        dep_queue.push_back((sub, depth + 1));
                                    }
                                }
                                Err(e) => {
                                    conflict_warnings.push(format!(
                                        "E_DEPENDENCY_UNRESOLVED: {}: {}: {}",
                                        detail.name, dep_proj_id, e
                                    ));
                                }
                            }
                        }
                    }
                } else if dep.dependency_type == "optional" {
                    if let Some(ref dep_proj_id) = dep.project_id {
                        if !visited_projects.contains(dep_proj_id) {
                            visited_projects.insert(dep_proj_id.clone());
                            if let Ok((dep_item, _)) = resolve_dependency_item(
                                client,
                                dep_proj_id,
                                dep.version_id.as_deref(),
                                game_version,
                                loader,
                                &installed_filenames,
                                true,
                            )
                            .await
                            {
                                optional_dependencies.push(dep_item);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(InstallPlan {
        primary_items,
        required_dependencies,
        optional_dependencies,
        conflict_warnings,
        total_download_size,
    })
}

#[derive(Deserialize, Clone)]
struct RawFileItem {
    url: String,
    filename: String,
    primary: bool,
    size: u64,
    hashes: HashMap<String, String>,
}

#[derive(Deserialize, Clone)]
struct RawDepItem {
    version_id: Option<String>,
    project_id: Option<String>,
    dependency_type: String,
}

#[derive(Deserialize, Clone)]
struct RawVerItem {
    id: String,
    project_id: String,
    name: String,
    files: Vec<RawFileItem>,
    dependencies: Option<Vec<RawDepItem>>,
}

async fn resolve_dependency_item(
    client: &reqwest::Client,
    project_id: &str,
    target_version_id: Option<&str>,
    game_version: &str,
    loader: &str,
    installed_filenames: &HashSet<String>,
    is_optional: bool,
) -> Result<(InstallPlanItem, Vec<RawDepItem>), ModpackError> {
    let req = if let Some(vid) = target_version_id {
        let mut u = reqwest::Url::parse(MODRINTH_API_BASE)
            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
        u.path_segments_mut()
            .map_err(|_| ModpackError::InvalidArchive("Invalid URL base".into()))?
            .extend(&["version", vid]);
        client.get(u)
    } else {
        let mut u = reqwest::Url::parse(MODRINTH_API_BASE)
            .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;
        u.path_segments_mut()
            .map_err(|_| ModpackError::InvalidArchive("Invalid URL base".into()))?
            .extend(&["project", project_id, "version"]);
        let gv_json = serde_json::to_string(&[game_version]).unwrap_or_default();
        let loader_json = serde_json::to_string(&[loader.to_lowercase()]).unwrap_or_default();
        client
            .get(u)
            .query(&[("game_versions", gv_json), ("loaders", loader_json)])
    };

    let resp = req
        .header("User-Agent", get_user_agent())
        .send()
        .await
        .map_err(|e| ModpackError::InvalidArchive(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(ModpackError::InvalidArchive(format!(
            "Modrinth version API error: HTTP {}",
            resp.status()
        )));
    }

    let detail = if target_version_id.is_some() {
        resp.json::<RawVerItem>().await?
    } else {
        let list = resp.json::<Vec<RawVerItem>>().await?;
        list.into_iter()
            .next()
            .ok_or_else(|| ModpackError::InvalidArchive("No compatible dependency version found".into()))?
    };

    let file = detail
        .files
        .iter()
        .find(|f| f.primary)
        .or_else(|| detail.files.first())
        .ok_or_else(|| ModpackError::InvalidArchive("Dependency version has no files".into()))?;

    let already = installed_filenames.contains(&file.filename.to_lowercase());
    let sub_deps = detail.dependencies.unwrap_or_default();

    let plan_item = InstallPlanItem {
        project_id: detail.project_id,
        version_id: detail.id,
        name: detail.name,
        filename: file.filename.clone(),
        download_url: file.url.clone(),
        sha1: file.hashes.get("sha1").cloned().unwrap_or_default(),
        size: file.size,
        is_primary: false,
        is_required_dep: !is_optional,
        is_optional_dep: is_optional,
        already_installed: already,
    };

    Ok((plan_item, sub_deps))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filters_with(categories: &[&str], env: Option<&str>) -> SearchFilters {
        SearchFilters {
            categories: categories.iter().map(|c| c.to_string()).collect(),
            environment: env.map(String::from),
            sort: None,
        }
    }

    #[test]
    fn test_is_safe_token() {
        assert!(is_safe_token("1.20.1"));
        assert!(is_safe_token("worldgen-biomes"));
        assert!(!is_safe_token(""));
        assert!(!is_safe_token("a\"],[\"b"));
        assert!(!is_safe_token("a,b"));
        assert!(!is_safe_token("a b"));
    }

    #[test]
    fn test_build_facets_rejects_injection() {
        let ok = build_facets("mod", Some("1.20.1"), Some("Fabric"), &filters_with(&["adventure"], Some("client"))).unwrap();
        assert!(ok.contains("\"versions:1.20.1\""));
        assert!(ok.contains("\"categories:adventure\""));
        assert!(ok.contains("\"categories:fabric\""));
        assert!(ok.contains("client_side:required"));

        let none = SearchFilters::default();
        assert!(build_facets("mod", None, None, &filters_with(&["a\"],[\"b"], None)).is_err());
        assert!(build_facets("mod", Some("1.20\"]"), None, &none).is_err());
        assert!(build_facets("mo d", None, None, &none).is_err());
    }

    #[test]
    fn test_build_facets_skips_vanilla_loader() {
        let out = build_facets("mod", None, Some("Vanilla"), &SearchFilters::default()).unwrap();
        assert_eq!(out, "[[\"project_type:mod\"]]");
    }

    #[test]
    fn test_workshop_project_summary_serde() {
        let summary = WorkshopProjectSummary {
            id: "sodium".into(),
            slug: "sodium".into(),
            title: "Sodium".into(),
            description: "Modern rendering engine".into(),
            icon_url: None,
            author: "jellysquid".into(),
            downloads: 1000000,
            follows: 50000,
            project_type: "mod".into(),
            categories: vec!["fabric".into()],
        };

        let json = serde_json::to_string(&summary).unwrap();
        let restored: WorkshopProjectSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.slug, "sodium");
    }
}
