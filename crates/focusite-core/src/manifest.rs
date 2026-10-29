//! Manifest data structures and rule evaluators for Mojang Minecraft versions.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::CoreError;

/// Mojang Version Manifest V2 Root (version_manifest_v2.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifestV2 {
    pub latest: LatestVersion,
    pub versions: Vec<VersionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersion {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
    pub sha1: String,
    #[serde(rename = "complianceLevel")]
    pub compliance_level: Option<u32>,
}

/// Detailed Minecraft Version Manifest (e.g., 1.21.4.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(rename = "javaVersion")]
    pub java_version: Option<JavaVersionRequirement>,
    pub arguments: Option<LaunchArguments>,
    #[serde(rename = "minecraftArguments")]
    pub legacy_arguments: Option<String>,
    pub libraries: Vec<LibraryEntry>,
    pub downloads: Option<VersionDownloads>,
    #[serde(rename = "assetIndex")]
    pub asset_index: Option<AssetIndexReference>,
    pub assets: Option<String>,
    #[serde(rename = "inheritsFrom", default, skip_serializing_if = "Option::is_none")]
    pub inherits_from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDownloads {
    pub client: DownloadArtifact,
    #[serde(rename = "client_mappings")]
    pub client_mappings: Option<DownloadArtifact>,
    pub server: Option<DownloadArtifact>,
    #[serde(rename = "server_mappings")]
    pub server_mappings: Option<DownloadArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaVersionRequirement {
    pub component: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchArguments {
    #[serde(default)]
    pub game: Vec<ArgumentEntry>,
    #[serde(default)]
    pub jvm: Vec<ArgumentEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArgumentEntry {
    Simple(String),
    Conditional {
        rules: Vec<Rule>,
        value: ArgumentValue,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArgumentValue {
    Single(String),
    Multiple(Vec<String>),
}

impl ArgumentValue {
    pub fn as_vec(&self) -> Vec<String> {
        match self {
            ArgumentValue::Single(s) => vec![s.clone()],
            ArgumentValue::Multiple(v) => v.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub action: String, // "allow" or "disallow"
    pub os: Option<OsRule>,
    pub features: Option<HashMap<String, bool>>,
}

impl Rule {
    /// Evaluates if this rule matches the specified target OS and architecture.
    pub fn matches(&self, os_name: &str, os_arch: &str) -> bool {
        if let Some(ref os) = self.os {
            if let Some(ref name) = os.name {
                if !name.eq_ignore_ascii_case(os_name) {
                    return false;
                }
            }
            if let Some(ref arch) = os.arch {
                if !arch.eq_ignore_ascii_case(os_arch) {
                    return false;
                }
            }
        }
        // Features are launcher-dependent; by default we do not enable custom demo/quickplay flags
        if let Some(ref features) = self.features {
            if features.values().any(|&v| v) {
                return false;
            }
        }
        true
    }
}

/// Evaluates a list of Mojang rules according to specification.
/// - If rules is empty, action is implicitly allowed.
/// - If rules is non-empty, default status starts at disallowed (false).
/// - Rules are evaluated sequentially: if rule matches, action overrides status.
pub fn eval_rules(rules: &[Rule], os_name: &str, os_arch: &str) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        if rule.matches(os_name, os_arch) {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsRule {
    pub name: Option<String>,
    pub version: Option<String>,
    pub arch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryEntry {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<HashMap<String, String>>,
}

impl LibraryEntry {
    /// Determines whether this library is allowed under given OS and architecture.
    pub fn is_allowed(&self, os_name: &str, os_arch: &str) -> bool {
        match &self.rules {
            Some(rules) => eval_rules(rules, os_name, os_arch),
            None => true,
        }
    }

    /// Gets the relative filesystem path of the library artifact.
    /// If downloads.artifact.path is present, uses it; otherwise converts Maven coordinate name.
    pub fn get_relative_path(&self) -> String {
        if let Some(ref downloads) = self.downloads {
            if let Some(ref art) = downloads.artifact {
                if let Some(ref path) = art.path {
                    return path.clone();
                }
            }
        }
        maven_to_path(&self.name).unwrap_or_else(|| format!("{}.jar", self.name))
    }
}

/// Converts a Maven coordinate (`group:artifact:version[:classifier][@ext]`) to a relative path.
pub fn maven_to_path(coordinate: &str) -> Option<String> {
    let parts: Vec<&str> = coordinate.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version_raw = parts[2];

    let (version, ext) = if let Some(idx) = version_raw.find('@') {
        (&version_raw[..idx], &version_raw[idx + 1..])
    } else {
        (version_raw, "jar")
    };

    let filename = if parts.len() >= 4 {
        let classifier_raw = parts[3];
        let (classifier, final_ext) = if let Some(idx) = classifier_raw.find('@') {
            (&classifier_raw[..idx], &classifier_raw[idx + 1..])
        } else {
            (classifier_raw, ext)
        };
        format!("{}-{}-{}.{}", artifact, version, classifier, final_ext)
    } else {
        format!("{}-{}.{}", artifact, version, ext)
    };

    Some(format!("{}/{}/{}/{}", group, artifact, version, filename))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<DownloadArtifact>,
    pub classifiers: Option<HashMap<String, DownloadArtifact>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadArtifact {
    pub path: Option<String>,
    pub url: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndexReference {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
    pub url: String,
}

/// Returns the current operating system identifier used by Mojang manifests.
pub fn get_current_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

/// Returns the current CPU architecture identifier used by Mojang manifests.
pub fn get_current_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "unknown"
    }
}

impl VersionManifest {
    /// Merges this child manifest (e.g. Forge/Fabric) with a parent base manifest (e.g. Vanilla).
    /// Child overrides main_class, inherits_from is resolved, libraries are combined (child first, deduplicated by maven group+artifact),
    /// arguments (game and jvm) are concatenated (parent args then child args).
    pub fn merge_parent(&self, parent: &VersionManifest) -> VersionManifest {
        let mut merged = parent.clone();
        merged.id = self.id.clone();
        if !self.version_type.is_empty() {
            merged.version_type = self.version_type.clone();
        }
        if !self.main_class.is_empty() {
            merged.main_class = self.main_class.clone();
        }
        if self.java_version.is_some() {
            merged.java_version = self.java_version.clone();
        }

        // Combine libraries: child libraries should take precedence and be prepended or deduplicated
        let mut combined_libs = self.libraries.clone();
        for p_lib in &parent.libraries {
            let p_name = &p_lib.name;
            let p_prefix = p_name.split(':').take(2).collect::<Vec<_>>().join(":");
            let exists_in_child = combined_libs.iter().any(|c_lib| {
                let c_prefix = c_lib.name.split(':').take(2).collect::<Vec<_>>().join(":");
                c_prefix == p_prefix
            });
            if !exists_in_child {
                combined_libs.push(p_lib.clone());
            }
        }
        merged.libraries = combined_libs;

        // Merge arguments
        if let Some(ref child_args) = self.arguments {
            if let Some(ref mut parent_args) = merged.arguments {
                parent_args.game.extend(child_args.game.clone());
                parent_args.jvm.extend(child_args.jvm.clone());
            } else {
                merged.arguments = Some(child_args.clone());
            }
        }

        if let Some(ref child_legacy) = self.legacy_arguments {
            merged.legacy_arguments = Some(child_legacy.clone());
        }

        if self.downloads.is_some() {
            merged.downloads = self.downloads.clone();
        }
        if self.asset_index.is_some() {
            merged.asset_index = self.asset_index.clone();
        }
        if self.assets.is_some() {
            merged.assets = self.assets.clone();
        }
        merged.inherits_from = None;
        merged
    }

    /// Returns the libraries filtered for the host platform.
    pub fn allowed_libraries(&self, os_name: &str, os_arch: &str) -> Vec<&LibraryEntry> {
        self.libraries
            .iter()
            .filter(|lib| lib.is_allowed(os_name, os_arch))
            .collect()
    }

    /// Fetches a detailed VersionManifest from a remote URL.
    pub async fn fetch_remote(url: &str) -> Result<Self, CoreError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        let resp = client.get(url).send().await?.error_for_status()?;
        let manifest: VersionManifest = resp.json().await?;
        Ok(manifest)
    }
}

impl VersionManifestV2 {
    /// Fetches the VersionManifestV2 root metadata from a remote URL.
    pub async fn fetch_remote(url: &str) -> Result<Self, CoreError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        let resp = client.get(url).send().await?.error_for_status()?;
        let manifest: VersionManifestV2 = resp.json().await?;
        Ok(manifest)
    }
}

/// Information about an available loader version.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoaderVersionInfo {
    pub version: String,
    pub is_recommended: bool,
}

/// Supported mod loader types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoaderKind {
    Fabric,
    Forge,
    NeoForge,
    Quilt,
}

impl LoaderKind {
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "fabric" => Some(Self::Fabric),
            "forge" => Some(Self::Forge),
            "neoforge" | "neo_forge" => Some(Self::NeoForge),
            "quilt" => Some(Self::Quilt),
            _ => None,
        }
    }
}

pub fn extract_xml_tags(xml: &str, tag: &str) -> Vec<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    let mut results = Vec::new();
    let mut rest = xml;
    while let Some(start_idx) = rest.find(&open_tag) {
        let content_start = start_idx + open_tag.len();
        rest = &rest[content_start..];
        if let Some(end_idx) = rest.find(&close_tag) {
            let val = &rest[..end_idx];
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                results.push(trimmed.to_string());
            }
            rest = &rest[end_idx + close_tag.len()..];
        } else {
            break;
        }
    }
    results
}

impl LoaderVersionInfo {
    /// Parses Fabric meta response JSON into a list of loader versions.
    pub fn parse_fabric_json(json_str: &str) -> Result<Vec<Self>, CoreError> {
        #[derive(Deserialize)]
        struct FabricItem {
            loader: FabricDetail,
        }
        #[derive(Deserialize)]
        struct FabricDetail {
            version: String,
            #[serde(default)]
            stable: bool,
        }

        let items: Vec<FabricItem> = serde_json::from_str(json_str)?;
        let mut results = Vec::new();
        let mut found_recommended = false;

        for item in &items {
            let is_rec = !found_recommended && item.loader.stable;
            if is_rec {
                found_recommended = true;
            }
            results.push(Self {
                version: item.loader.version.clone(),
                is_recommended: is_rec,
            });
        }

        // If none were marked stable, mark the first one as recommended
        if !found_recommended && !results.is_empty() {
            results[0].is_recommended = true;
        }

        Ok(results)
    }

    /// Parses Quilt meta response JSON into a list of loader versions.
    pub fn parse_quilt_json(json_str: &str) -> Result<Vec<Self>, CoreError> {
        #[derive(Deserialize)]
        struct QuiltItem {
            loader: QuiltDetail,
        }
        #[derive(Deserialize)]
        struct QuiltDetail {
            version: String,
        }

        let items: Vec<QuiltItem> = serde_json::from_str(json_str)?;
        let mut results = Vec::new();
        for (idx, item) in items.iter().enumerate() {
            results.push(Self {
                version: item.loader.version.clone(),
                is_recommended: idx == 0,
            });
        }

        Ok(results)
    }

    /// Parses NeoForge maven-metadata.xml for a given Minecraft version.
    pub fn parse_neoforge_xml(xml_str: &str, mc_version: &str) -> Vec<Self> {
        let parts: Vec<&str> = mc_version.split('.').collect();
        let prefix = if parts.len() >= 2 && parts[0] == "1" {
            let minor = parts[1];
            let patch = parts.get(2).copied().unwrap_or("0");
            format!("{}.{}.", minor, patch)
        } else {
            format!("{}.", mc_version)
        };

        let raw_versions = extract_xml_tags(xml_str, "version");
        let mut matched: Vec<String> = raw_versions
            .into_iter()
            .filter(|v| v.starts_with(&prefix))
            .collect();

        // Newest versions are at the end of maven metadata; reverse so latest is first
        matched.reverse();

        matched
            .into_iter()
            .enumerate()
            .map(|(idx, ver)| Self {
                version: ver,
                is_recommended: idx == 0,
            })
            .collect()
    }

    /// Parses Forge promotions JSON and optional Maven XML for a given Minecraft version.
    pub fn parse_forge(
        promos_json: &str,
        maven_xml: Option<&str>,
        mc_version: &str,
    ) -> Result<Vec<Self>, CoreError> {
        #[derive(Deserialize)]
        struct Promotions {
            promos: HashMap<String, String>,
        }

        let rec_key = format!("{}-recommended", mc_version);
        let lat_key = format!("{}-latest", mc_version);

        let promos: Option<Promotions> = serde_json::from_str(promos_json).ok();
        let rec_ver = promos.as_ref().and_then(|p| p.promos.get(&rec_key).cloned());
        let lat_ver = promos.as_ref().and_then(|p| p.promos.get(&lat_key).cloned());

        let mut results = Vec::new();
        let prefix = format!("{}-", mc_version);

        if let Some(xml) = maven_xml {
            let raw_versions = extract_xml_tags(xml, "version");
            let mut matched: Vec<String> = raw_versions
                .into_iter()
                .filter(|v| v.starts_with(&prefix))
                .map(|v| v[prefix.len()..].to_string())
                .collect();

            matched.reverse();

            if !matched.is_empty() {
                let target_rec = rec_ver.as_ref().or(lat_ver.as_ref());
                let mut found_rec = false;

                for ver in matched {
                    let is_rec = if let Some(target) = target_rec {
                        if !found_rec && &ver == target {
                            found_rec = true;
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    };

                    results.push(Self {
                        version: ver,
                        is_recommended: is_rec,
                    });
                }

                if !found_rec && !results.is_empty() {
                    results[0].is_recommended = true;
                }

                return Ok(results);
            }
        }

        // Fallback to promotions_slim directly if maven has no match
        if let Some(rec) = rec_ver {
            results.push(Self {
                version: rec.clone(),
                is_recommended: true,
            });
            if let Some(lat) = lat_ver {
                if lat != rec {
                    results.push(Self {
                        version: lat,
                        is_recommended: false,
                    });
                }
            }
        } else if let Some(lat) = lat_ver {
            results.push(Self {
                version: lat,
                is_recommended: true,
            });
        }

        Ok(results)
    }

    /// Remote fetch entry point querying official endpoints with timeout.
    pub async fn fetch_remote_loaders(
        loader: LoaderKind,
        mc_version: &str,
    ) -> Result<Vec<Self>, CoreError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()?;

        match loader {
            LoaderKind::Fabric => {
                let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);
                let resp = client.get(&url).send().await?.error_for_status()?;
                let text = resp.text().await?;
                Self::parse_fabric_json(&text)
            }
            LoaderKind::Quilt => {
                let url = format!("https://meta.quiltmc.org/v3/versions/loader/{}", mc_version);
                let resp = client.get(&url).send().await?.error_for_status()?;
                let text = resp.text().await?;
                Self::parse_quilt_json(&text)
            }
            LoaderKind::NeoForge => {
                let url = "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
                let resp = client.get(url).send().await?.error_for_status()?;
                let xml = resp.text().await?;
                Ok(Self::parse_neoforge_xml(&xml, mc_version))
            }
            LoaderKind::Forge => {
                let promo_url = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
                let promo_resp = client.get(promo_url).send().await?.error_for_status()?;
                let promo_text = promo_resp.text().await?;

                let maven_url = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
                let maven_text = match client.get(maven_url).send().await {
                    Ok(resp) => resp.text().await.ok(),
                    Err(_) => None,
                };

                Self::parse_forge(&promo_text, maven_text.as_deref(), mc_version)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_manifest() {
        let json = r#"{
            "id": "1.20.4",
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "javaVersion": { "component": "java-runtime-gamma", "majorVersion": 17 },
            "libraries": []
        }"#;

        let manifest: VersionManifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.id, "1.20.4");
        assert_eq!(manifest.java_version.unwrap().major_version, 17);
    }

    #[test]
    fn test_maven_to_path() {
        assert_eq!(
            maven_to_path("org.lwjgl:lwjgl:3.3.3").unwrap(),
            "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar"
        );
        assert_eq!(
            maven_to_path("org.lwjgl:lwjgl:3.3.3:natives-windows").unwrap(),
            "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar"
        );
    }

    #[test]
    fn test_rule_evaluation() {
        let rules_windows_only = vec![
            Rule {
                action: "allow".into(),
                os: Some(OsRule {
                    name: Some("windows".into()),
                    version: None,
                    arch: None,
                }),
                features: None,
            },
        ];

        assert!(eval_rules(&rules_windows_only, "windows", "x86_64"));
        assert!(!eval_rules(&rules_windows_only, "osx", "x86_64"));
        assert!(!eval_rules(&rules_windows_only, "linux", "x86_64"));

        // Rules with disallow
        let rules_disallow_osx = vec![
            Rule {
                action: "allow".into(),
                os: None,
                features: None,
            },
            Rule {
                action: "disallow".into(),
                os: Some(OsRule {
                    name: Some("osx".into()),
                    version: None,
                    arch: None,
                }),
                features: None,
            },
        ];

        assert!(eval_rules(&rules_disallow_osx, "windows", "x86_64"));
        assert!(!eval_rules(&rules_disallow_osx, "osx", "x86_64"));
    }

    #[test]
    fn test_version_manifest_v2_parsing() {
        let json = r#"{
            "latest": {
                "release": "1.21.4",
                "snapshot": "24w45a"
            },
            "versions": [
                {
                    "id": "1.21.4",
                    "type": "release",
                    "url": "https://piston-meta.mojang.com/v1/packages/1.21.4.json",
                    "time": "2024-12-03T10:00:00+00:00",
                    "releaseTime": "2024-12-03T10:00:00+00:00",
                    "sha1": "abcdef1234567890",
                    "complianceLevel": 1
                }
            ]
        }"#;

        let v2: VersionManifestV2 = serde_json::from_str(json).unwrap();
        assert_eq!(v2.latest.release, "1.21.4");
        assert_eq!(v2.versions.len(), 1);
        assert_eq!(v2.versions[0].id, "1.21.4");
    }

    #[test]
    fn test_extract_xml_tags() {
        let xml = "<metadata><versioning><versions><version>1.0</version><version> 2.0 </version></versions></versioning></metadata>";
        let versions = extract_xml_tags(xml, "version");
        assert_eq!(versions, vec!["1.0", "2.0"]);
    }

    #[test]
    fn test_parse_fabric_json() {
        let json = r#"[
            { "loader": { "version": "0.16.10", "stable": false } },
            { "loader": { "version": "0.16.9", "stable": true } },
            { "loader": { "version": "0.16.8", "stable": false } }
        ]"#;
        let list = LoaderVersionInfo::parse_fabric_json(json).unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].version, "0.16.10");
        assert!(!list[0].is_recommended);
        assert_eq!(list[1].version, "0.16.9");
        assert!(list[1].is_recommended);
    }

    #[test]
    fn test_parse_quilt_json() {
        let json = r#"[
            { "loader": { "version": "0.27.1" } },
            { "loader": { "version": "0.27.0" } }
        ]"#;
        let list = LoaderVersionInfo::parse_quilt_json(json).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].version, "0.27.1");
        assert!(list[0].is_recommended);
        assert!(!list[1].is_recommended);
    }

    #[test]
    fn test_parse_neoforge_xml() {
        let xml = r#"<metadata><versioning><versions>
            <version>20.4.1</version>
            <version>21.1.10</version>
            <version>21.1.20</version>
        </versions></versioning></metadata>"#;
        let list = LoaderVersionInfo::parse_neoforge_xml(xml, "1.21.1");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].version, "21.1.20");
        assert!(list[0].is_recommended);
        assert_eq!(list[1].version, "21.1.10");
        assert!(!list[1].is_recommended);
    }

    #[test]
    fn test_parse_forge_promotions_and_maven() {
        let promos = r#"{
            "promos": {
                "1.20.1-recommended": "47.4.28",
                "1.20.1-latest": "47.4.30"
            }
        }"#;
        let maven = r#"<metadata><versioning><versions>
            <version>1.20.1-47.4.20</version>
            <version>1.20.1-47.4.28</version>
            <version>1.20.1-47.4.30</version>
        </versions></versioning></metadata>"#;

        let list = LoaderVersionInfo::parse_forge(promos, Some(maven), "1.20.1").unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].version, "47.4.30");
        assert!(!list[0].is_recommended);
        assert_eq!(list[1].version, "47.4.28");
        assert!(list[1].is_recommended);
    }

    #[test]
    fn test_version_manifest_merge_parent() {
        let parent_json = r#"{
            "id": "1.20.1",
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "arguments": {
                "game": ["--username", "${auth_player_name}"],
                "jvm": ["-cp", "${classpath}"]
            },
            "libraries": [
                { "name": "org.lwjgl:lwjgl:3.3.1" },
                { "name": "com.mojang:authlib:4.0.43" }
            ]
        }"#;

        let child_json = r#"{
            "id": "1.20.1-forge-47.2.0",
            "inheritsFrom": "1.20.1",
            "type": "release",
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "arguments": {
                "game": ["--tweakClass", "${tweak_class}"],
                "jvm": ["-Dforge.logging.console.level=debug"]
            },
            "libraries": [
                { "name": "net.minecraftforge:forge:1.20.1-47.2.0" },
                { "name": "org.lwjgl:lwjgl:3.3.2" }
            ]
        }"#;

        let parent: VersionManifest = serde_json::from_str(parent_json).unwrap();
        let child: VersionManifest = serde_json::from_str(child_json).unwrap();

        let merged = child.merge_parent(&parent);
        assert_eq!(merged.id, "1.20.1-forge-47.2.0");
        assert_eq!(merged.main_class, "cpw.mods.bootstraplauncher.BootstrapLauncher");
        assert!(merged.inherits_from.is_none());

        // Child library takes precedence over parent library
        assert_eq!(merged.libraries[0].name, "net.minecraftforge:forge:1.20.1-47.2.0");
        assert_eq!(merged.libraries[1].name, "org.lwjgl:lwjgl:3.3.2");
        assert_eq!(merged.libraries[2].name, "com.mojang:authlib:4.0.43");
        assert_eq!(merged.libraries.len(), 3);

        // Arguments concatenated
        let args = merged.arguments.unwrap();
        assert_eq!(args.game.len(), 4); // 2 from parent, 2 from child
        assert_eq!(args.jvm.len(), 3);
    }
}
