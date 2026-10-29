//! Java Runtime environment scanner, registry probing, and Mojang official JRE downloader.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::CoreError;

pub const MOJANG_JAVA_RUNTIME_ALL_URL: &str =
    "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

/// Detected Java Installation metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JavaInstallation {
    pub path: PathBuf,
    pub major_version: u32,
    pub version_string: String,
    pub vendor: String,
    pub is_64_bit: bool,
    pub is_managed: bool,
}

impl JavaInstallation {
    /// Determines whether this Java version satisfies the game requirements.
    pub fn is_compatible_with(&self, required_major: u32) -> bool {
        self.major_version == required_major
    }
}

/// Helper to map Minecraft version string to required Java major version.
pub fn get_recommended_java_version(minecraft_version: &str) -> u32 {
    let parts: Vec<&str> = minecraft_version.split('.').collect();
    if parts.len() >= 2 {
        if let Ok(minor) = parts[1].parse::<u32>() {
            if minor >= 21 {
                return 21;
            }
            if minor >= 18 {
                return 17;
            }
            if minor == 17 {
                return 16;
            }
        }
    }
    8
}

/// Parses a Java version string into its major integer version.
/// Handles legacy "1.8.0_361" -> 8, modern "17.0.10" -> 17, "21.0.3+9-LTS" -> 21, "25.0.2" -> 25.
pub fn parse_java_version(version_str: &str) -> Option<u32> {
    let clean = version_str.trim().trim_matches('"');
    let parts: Vec<&str> = clean.split('.').collect();
    if parts.is_empty() {
        return None;
    }
    if parts[0] == "1" && parts.len() > 1 {
        parts[1].split(['_', '-']).next()?.parse::<u32>().ok()
    } else {
        parts[0].split(['_', '-', '+']).next()?.parse::<u32>().ok()
    }
}

/// Maps required major Java version to Mojang JRE component name.
pub fn get_mojang_component_name(required_major: u32) -> &'static str {
    match required_major {
        0..=8 => "jre-legacy",
        9..=16 => "java-runtime-alpha",
        17 => "java-runtime-gamma",
        18..=21 => "java-runtime-delta",
        _ => "java-runtime-epsilon",
    }
}

/// Executes `path -version` with hidden console window to detect version and bitness.
pub fn inspect_java_binary(path: &Path) -> Option<JavaInstallation> {
    if !path.is_file() {
        return None;
    }

    let mut cmd = std::process::Command::new(path);
    cmd.arg("-version");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{}\n{}", stdout, stderr);

    let mut version_str = String::new();
    let mut major_version = 0;
    for line in combined.lines() {
        if line.contains("version \"") {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    let v = &line[start + 1..start + 1 + end];
                    version_str = v.to_string();
                    if let Some(maj) = parse_java_version(v) {
                        major_version = maj;
                        break;
                    }
                }
            }
        }
    }

    if major_version == 0 {
        return None;
    }

    let is_64_bit = combined.contains("64-Bit")
        || combined.contains("64-bit")
        || combined.contains("x86_64")
        || combined.contains("amd64");

    let vendor = if combined.contains("Adoptium") || combined.contains("Temurin") {
        "Eclipse Adoptium".to_string()
    } else if combined.contains("Microsoft") {
        "Microsoft".to_string()
    } else if combined.contains("Zulu") || combined.contains("Azul") {
        "Azul Systems".to_string()
    } else if combined.contains("Liberica") || combined.contains("BellSoft") {
        "BellSoft".to_string()
    } else if combined.contains("Oracle") || combined.contains("Java(TM)") {
        "Oracle Corporation".to_string()
    } else if combined.contains("OpenJDK") {
        "OpenJDK".to_string()
    } else {
        "Java".to_string()
    };

    let path_str = path.to_string_lossy();
    let is_managed = path_str.contains("focusite_launcher") && path_str.contains("runtime");

    Some(JavaInstallation {
        path: path.to_path_buf(),
        major_version,
        version_string: version_str,
        vendor,
        is_64_bit,
        is_managed,
    })
}

/// Scans Windows registry for installed JDK/JRE directories.
#[cfg(windows)]
pub fn scan_registry_javas() -> Vec<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut paths = Vec::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let reg_paths = [
        r"SOFTWARE\JavaSoft\JDK",
        r"SOFTWARE\JavaSoft\Java Development Kit",
        r"SOFTWARE\JavaSoft\Java Runtime Environment",
        r"SOFTWARE\Eclipse Adoptium\JDK",
        r"SOFTWARE\Eclipse Adoptium\JRE",
        r"SOFTWARE\Microsoft\JDK",
        r"SOFTWARE\BellSoft\Liberica JDK",
        r"SOFTWARE\WOW6432Node\JavaSoft\JDK",
        r"SOFTWARE\WOW6432Node\JavaSoft\Java Development Kit",
        r"SOFTWARE\WOW6432Node\JavaSoft\Java Runtime Environment",
    ];

    for reg_path in reg_paths {
        if let Ok(key) = hklm.open_subkey(reg_path) {
            if let Ok(home) = key.get_value::<String, _>("JavaHome") {
                paths.push(PathBuf::from(home));
            }
            for subkey_name in key.enum_keys().filter_map(|r| r.ok()) {
                if let Ok(subkey) = key.open_subkey(&subkey_name) {
                    if let Ok(home) = subkey.get_value::<String, _>("JavaHome") {
                        paths.push(PathBuf::from(home));
                    }
                    if let Ok(home) = subkey.get_value::<String, _>("Path") {
                        paths.push(PathBuf::from(home));
                    }
                }
            }
        }
    }

    paths
}

#[cfg(not(windows))]
pub fn scan_registry_javas() -> Vec<PathBuf> {
    Vec::new()
}

/// Comprehensive scan of system Javas: Registry, JAVA_HOME, PATH, common folders, and managed runtime directory.
pub fn scan_system_javas() -> Vec<JavaInstallation> {
    let mut candidate_binaries: Vec<PathBuf> = Vec::new();
    let mut candidate_homes: Vec<PathBuf> = Vec::new();

    // 1. Windows Registry
    candidate_homes.extend(scan_registry_javas());

    // 2. JAVA_HOME environment variable
    if let Ok(home) = std::env::var("JAVA_HOME") {
        candidate_homes.push(PathBuf::from(home));
    }

    // 3. System PATH environment variable
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let exe = dir.join("javaw.exe");
            if exe.is_file() {
                candidate_binaries.push(exe);
            }
            let exe = dir.join("java.exe");
            if exe.is_file() {
                candidate_binaries.push(exe);
            }
            let bin = dir.join("bin").join("javaw.exe");
            if bin.is_file() {
                candidate_binaries.push(bin);
            }
        }
    }

    // 4. Common install locations on Windows
    #[cfg(windows)]
    {
        let roots = [
            r"C:\Program Files\Java",
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Microsoft",
            r"C:\Program Files\BellSoft",
            r"C:\Program Files (x86)\Java",
        ];
        for root in roots {
            let p = Path::new(root);
            if p.is_dir() {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        candidate_homes.push(entry.path());
                    }
                }
            }
        }
    }

    // 5. Focusite managed runtime directory (%APPDATA%/focusite_launcher/runtime/)
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let runtime_dir = PathBuf::from(app_data).join("focusite_launcher").join("runtime");
        if runtime_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&runtime_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    candidate_homes.push(entry.path());
                }
            }
        }
    }

    // Convert candidate homes to candidate binaries (prefer javaw.exe on Windows, fallback to java.exe)
    for home in candidate_homes {
        let bin_dir = home.join("bin");
        let javaw = bin_dir.join("javaw.exe");
        let java = bin_dir.join("java.exe");
        if javaw.is_file() {
            candidate_binaries.push(javaw);
        } else if java.is_file() {
            candidate_binaries.push(java);
        }
    }

    // Inspect candidates and deduplicate
    let mut results: Vec<JavaInstallation> = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for binary in candidate_binaries {
        let canonical = binary.canonicalize().unwrap_or(binary.clone());
        if seen_paths.insert(canonical) {
            if let Some(installation) = inspect_java_binary(&binary) {
                results.push(installation);
            }
        }
    }

    // Sort by major version descending
    results.sort_by(|a, b| b.major_version.cmp(&a.major_version));
    results
}

/// Finds a compatible Java installation from the local system for a given major version requirement.
pub fn find_compatible_system_java(required_major: u32) -> Option<JavaInstallation> {
    let installed = scan_system_javas();
    // Prefer exact match, else greater version if acceptable
    installed.into_iter().find(|j| j.is_compatible_with(required_major))
}

// Data structures for Mojang JRE manifests
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangAllManifest {
    #[serde(flatten)]
    platforms: HashMap<String, HashMap<String, Vec<MojangComponentEntry>>>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangComponentEntry {
    manifest: MojangManifestRef,
    version: MojangVersionRef,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangManifestRef {
    sha1: String,
    size: u64,
    url: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangVersionRef {
    name: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangPackageManifest {
    files: HashMap<String, MojangFileEntry>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangFileEntry {
    #[serde(rename = "type")]
    entry_type: String,
    downloads: Option<MojangFileDownloads>,
    executable: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangFileDownloads {
    raw: Option<MojangDownloadItem>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MojangDownloadItem {
    sha1: String,
    size: u64,
    url: String,
}

/// File item to download for JRE provisioning: (relative_path, url, sha1, is_executable)
pub type JreDownloadItem = (String, String, Option<String>, bool);

/// Fetches the file download list for a specific Mojang JRE component.
pub async fn fetch_mojang_runtime_download_list(
    component: &str,
    platform: &str,
) -> Result<Vec<JreDownloadItem>, CoreError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(CoreError::Network)?;

    let all_resp = client
        .get(MOJANG_JAVA_RUNTIME_ALL_URL)
        .send()
        .await
        .map_err(CoreError::Network)?
        .json::<MojangAllManifest>()
        .await
        .map_err(CoreError::Network)?;

    let platform_components = all_resp
        .platforms
        .get(platform)
        .ok_or_else(|| CoreError::JavaNotFound(format!("Platform {} not in JRE manifest", platform)))?;

    let entries = platform_components
        .get(component)
        .ok_or_else(|| CoreError::JavaNotFound(format!("Component {} not found for {}", component, platform)))?;

    let latest_entry = entries
        .first()
        .ok_or_else(|| CoreError::JavaNotFound(format!("Empty entries for component {}", component)))?;

    let pkg_resp = client
        .get(&latest_entry.manifest.url)
        .send()
        .await
        .map_err(CoreError::Network)?
        .json::<MojangPackageManifest>()
        .await
        .map_err(CoreError::Network)?;

    let mut download_items = Vec::new();
    for (rel_path, entry) in pkg_resp.files {
        if entry.entry_type == "file" {
            if let Some(downloads) = entry.downloads {
                if let Some(raw) = downloads.raw {
                    let is_exe = entry.executable.unwrap_or(false);
                    download_items.push((rel_path, raw.url, Some(raw.sha1), is_exe));
                }
            }
        }
    }

    Ok(download_items)
}

/// Ensures a compatible Java runtime exists.
/// 1. Scans system PATH and registry for installed Java.
/// 2. If not found, checks `%APPDATA%/focusite_launcher/runtime/<component>/`.
/// 3. Returns the executable path (`javaw.exe` or `java.exe`).
pub fn resolve_or_locate_java(required_major: u32, custom_override: Option<&str>) -> Result<PathBuf, CoreError> {
    // 1. If user specified a custom Java path in instance settings, verify it
    if let Some(custom) = custom_override {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Ok(p);
        }
        let with_bin = p.join("bin").join("javaw.exe");
        if with_bin.is_file() {
            return Ok(with_bin);
        }
    }

    // 2. Scan system for compatible version
    if let Some(installed) = find_compatible_system_java(required_major) {
        return Ok(installed.path);
    }

    // 3. Check Focusite runtime directory
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let component = get_mojang_component_name(required_major);
        let runtime_path = PathBuf::from(app_data)
            .join("focusite_launcher")
            .join("runtime")
            .join(component);

        let javaw = runtime_path.join("bin").join("javaw.exe");
        if javaw.is_file() {
            return Ok(javaw);
        }
        let java = runtime_path.join("bin").join("java.exe");
        if java.is_file() {
            return Ok(java);
        }
    }

    Err(CoreError::JavaNotFound(format!(
        "No compatible Java {} runtime found on system or in runtime cache",
        required_major
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_java_version_recommendations() {
        assert_eq!(get_recommended_java_version("1.21.4"), 21);
        assert_eq!(get_recommended_java_version("1.20.4"), 17);
        assert_eq!(get_recommended_java_version("1.18.2"), 17);
        assert_eq!(get_recommended_java_version("1.17.1"), 16);
        assert_eq!(get_recommended_java_version("1.16.5"), 8);
    }

    #[test]
    fn test_parse_java_version() {
        assert_eq!(parse_java_version("25.0.2"), Some(25));
        assert_eq!(parse_java_version("21.0.3+9-LTS"), Some(21));
        assert_eq!(parse_java_version("17.0.10"), Some(17));
        assert_eq!(parse_java_version("1.8.0_361"), Some(8));
        assert_eq!(parse_java_version("11.0.22"), Some(11));
        assert_eq!(parse_java_version("invalid"), None);
    }

    #[test]
    fn test_component_mapping() {
        assert_eq!(get_mojang_component_name(8), "jre-legacy");
        assert_eq!(get_mojang_component_name(16), "java-runtime-alpha");
        assert_eq!(get_mojang_component_name(17), "java-runtime-gamma");
        assert_eq!(get_mojang_component_name(21), "java-runtime-delta");
        assert_eq!(get_mojang_component_name(25), "java-runtime-epsilon");
    }

    #[test]
    fn test_scan_system_javas_finds_local_java() {
        let javas = scan_system_javas();
        // Since the current environment has Java installed, scan should discover at least 1 Java installation
        assert!(!javas.is_empty(), "Expected at least one Java installation to be detected");
        assert!(javas[0].major_version > 0);
    }
}
