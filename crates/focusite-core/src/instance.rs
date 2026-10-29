//! Instance metadata, capabilities, and management structures.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Sanitizes a user-provided instance name for use as a valid filesystem directory name.
/// Filters Windows forbidden characters (< > : " / \ | ? *) and reserved names.
pub fn sanitize_folder_name(name: &str) -> String {
    let forbidden_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut cleaned: String = name
        .chars()
        .map(|c| if forbidden_chars.contains(&c) || c.is_control() { '_' } else { c })
        .collect();

    // Trim whitespace and periods from ends
    cleaned = cleaned.trim().trim_matches('.').trim().to_string();

    if cleaned.is_empty() {
        cleaned = "New Instance".to_string();
    }

    // Check Windows reserved device names
    let upper = cleaned.to_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];

    if reserved.contains(&upper.as_str()) {
        cleaned.push('_');
    }

    cleaned
}

/// Modes for the mods management interface based on Minecraft version history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModsTabMode {
    /// Versions older than 1.2.5: No mods tab
    Hidden,
    /// 1.2.5 ~ 1.5.2: Dual navigation for Mods (mods/) and Core Mods (coremods/)
    LegacyDualNav,
    /// 1.6+: Single list managing mods/ directly without sub-navigation
    ModernSingleList,
}

/// Supported pack folder types for resource and texture packs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackFolderKind {
    /// Pre-Alpha v1.2.2: Native pack folder is not supported; tab is hidden
    Hidden,
    /// Alpha v1.2.2 up to 13w23b / 1.5.2: Uses minecraft/texturepacks/
    TexturePacks,
    /// 13w24a / 1.6+ onwards: Uses minecraft/resourcepacks/
    ResourcePacks,
}

/// Historical version capabilities determining UI tabs and folder routing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionCapabilities {
    /// Non-vanilla mod loaders (Forge, Fabric, NeoForge, Quilt) require MC >= 1.2.5
    pub supports_non_vanilla_loaders: bool,
    /// Visibility and layout of the mods tab
    pub mods_tab_mode: ModsTabMode,
    /// Routing for resource/texture packs
    pub pack_folder_kind: PackFolderKind,
    /// Shaderpacks (minecraft/shaderpacks/) introduced from MC 1.4.2 onwards
    pub supports_shaderpacks: bool,
}

impl VersionCapabilities {
    /// Evaluates version capabilities from a Minecraft version ID string.
    pub fn from_mc_version(version: &str) -> Self {
        let v = version.trim();

        // 1. Check for Pre-Alpha (c, rd, in, inf)
        if v.starts_with("c0.") || v.starts_with("rd-") || v.starts_with("in-") || v.starts_with("inf-") {
            return Self {
                supports_non_vanilla_loaders: false,
                mods_tab_mode: ModsTabMode::Hidden,
                pack_folder_kind: PackFolderKind::Hidden,
                supports_shaderpacks: false,
            };
        }

        // 2. Check for Alpha (a1.x)
        if v.starts_with("a1.") || v.starts_with("alpha") {
            // Alpha v1.2.2 is the cutoff where texturepacks/ was introduced
            let is_pre_a122 = if let Some(rest) = v.strip_prefix("a1.") {
                if let Some(first_dot) = rest.find('.') {
                    let minor: u32 = rest[..first_dot].parse().unwrap_or(0);
                    let patch_str: String = rest[first_dot + 1..].chars().take_while(|c| c.is_ascii_digit()).collect();
                    let patch: u32 = patch_str.parse().unwrap_or(0);
                    minor < 2 || (minor == 2 && patch < 2)
                } else {
                    let minor: u32 = rest.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
                    minor < 2
                }
            } else {
                false
            };

            let pack_folder_kind = if is_pre_a122 {
                PackFolderKind::Hidden
            } else {
                PackFolderKind::TexturePacks
            };

            return Self {
                supports_non_vanilla_loaders: false,
                mods_tab_mode: ModsTabMode::Hidden,
                pack_folder_kind,
                supports_shaderpacks: false,
            };
        }

        // 3. Check for Beta (b1.x)
        if v.starts_with("b1.") || v.starts_with("beta") {
            return Self {
                supports_non_vanilla_loaders: false,
                mods_tab_mode: ModsTabMode::Hidden,
                pack_folder_kind: PackFolderKind::TexturePacks,
                supports_shaderpacks: false,
            };
        }

        // 4. Check for Snapshots (e.g. 13w24a, 24w45a)
        if v.len() >= 5 && v.chars().take(2).all(|c| c.is_ascii_digit()) && v.chars().nth(2) == Some('w') {
            let year: u32 = v[0..2].parse().unwrap_or(0);
            let week: u32 = v[3..5].parse().unwrap_or(0);

            let is_post_13w24 = year > 13 || (year == 13 && week >= 24);
            let is_post_142 = year > 12 || (year == 12 && week >= 42);
            let is_post_125 = year > 12 || (year == 12 && week >= 12);

            let pack_folder_kind = if is_post_13w24 {
                PackFolderKind::ResourcePacks
            } else {
                PackFolderKind::TexturePacks
            };

            let mods_tab_mode = if is_post_13w24 {
                ModsTabMode::ModernSingleList
            } else if is_post_125 {
                ModsTabMode::LegacyDualNav
            } else {
                ModsTabMode::Hidden
            };

            return Self {
                supports_non_vanilla_loaders: is_post_125,
                mods_tab_mode,
                pack_folder_kind,
                supports_shaderpacks: is_post_142,
            };
        }

        // 5. Standard Releases (e.g. 1.2.5, 1.4.2, 1.5.2, 1.6.1, 1.21.4)
        if let Some((major, minor, patch)) = parse_semver_numbers(v) {
            if major == 1 {
                let pack_folder_kind = if minor >= 6 {
                    PackFolderKind::ResourcePacks
                } else {
                    PackFolderKind::TexturePacks
                };

                let supports_shaderpacks = minor > 4 || (minor == 4 && patch >= 2);
                let supports_non_vanilla_loaders = minor > 2 || (minor == 2 && patch >= 5);

                let mods_tab_mode = if minor >= 6 {
                    ModsTabMode::ModernSingleList
                } else if supports_non_vanilla_loaders {
                    ModsTabMode::LegacyDualNav
                } else {
                    ModsTabMode::Hidden
                };

                return Self {
                    supports_non_vanilla_loaders,
                    mods_tab_mode,
                    pack_folder_kind,
                    supports_shaderpacks,
                };
            }
        }

        // Modern fallback (e.g. custom or unparsed future release)
        Self {
            supports_non_vanilla_loaders: true,
            mods_tab_mode: ModsTabMode::ModernSingleList,
            pack_folder_kind: PackFolderKind::ResourcePacks,
            supports_shaderpacks: true,
        }
    }
}

fn parse_semver_numbers(v: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.is_empty() {
        return None;
    }
    let major: u32 = parts[0].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok()?;
    let minor: u32 = if parts.len() > 1 {
        parts[1].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)
    } else {
        0
    };
    let patch: u32 = if parts.len() > 2 {
        parts[2].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)
    } else {
        0
    };
    Some((major, minor, patch))
}

/// Minecraft Instance Specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub game_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub loader: Option<ModLoaderSpec>,
    pub java_path: Option<String>,
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    pub jvm_args: Vec<String>,
    pub created_at: i64,
    pub last_played_at: Option<i64>,
    #[serde(default)]
    pub show_log_on_launch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModLoaderSpec {
    pub loader_type: ModLoaderType,
    pub loader_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModLoaderType {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
    Quilt,
    Custom,
}

impl InstanceConfig {
    pub fn new(id: String, name: String, game_version: String) -> Self {
        Self {
            id,
            name,
            game_version,
            description: None,
            loader: None,
            java_path: None,
            min_memory_mb: 1024,
            max_memory_mb: 4096,
            jvm_args: vec![
                "-XX:+UseG1GC".into(),
                "-XX:+ParallelRefProcEnabled".into(),
                "-XX:MaxGCPauseMillis=200".into(),
            ],
            created_at: chrono::Utc::now().timestamp_millis(),
            last_played_at: None,
            show_log_on_launch: false,
        }
    }

    /// Resolves the internal Minecraft game root directory: `<instances_dir>/<id>/minecraft/`
    pub fn get_game_dir<P: AsRef<Path>>(&self, base_instances_dir: P) -> PathBuf {
        base_instances_dir.as_ref().join(&self.id).join("minecraft")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_instance_creation() {
        let inst = InstanceConfig::new("Survival 1.20.4".into(), "Survival 1.20.4".into(), "1.20.4".into());
        assert_eq!(inst.id, "Survival 1.20.4");
        assert_eq!(inst.max_memory_mb, 4096);
        let path = inst.get_game_dir("C:/focusite/instances");
        assert_eq!(path, PathBuf::from("C:/focusite/instances/Survival 1.20.4/minecraft"));
    }

    #[test]
    fn test_sanitize_folder_name() {
        assert_eq!(sanitize_folder_name("My:World?*"), "My_World__");
        assert_eq!(sanitize_folder_name("  Test...  "), "Test");
        assert_eq!(sanitize_folder_name("CON"), "CON_");
        assert_eq!(sanitize_folder_name(""), "New Instance");
    }

    #[test]
    fn test_version_capabilities_matrix() {
        // Pre-Alpha & Alpha < a1.2.2
        let c030 = VersionCapabilities::from_mc_version("c0.30_01c");
        assert_eq!(c030.pack_folder_kind, PackFolderKind::Hidden);
        assert_eq!(c030.mods_tab_mode, ModsTabMode::Hidden);
        assert!(!c030.supports_shaderpacks);
        assert!(!c030.supports_non_vanilla_loaders);

        let a104 = VersionCapabilities::from_mc_version("a1.0.4");
        assert_eq!(a104.pack_folder_kind, PackFolderKind::Hidden);

        let a121 = VersionCapabilities::from_mc_version("a1.2.1");
        assert_eq!(a121.pack_folder_kind, PackFolderKind::Hidden);

        // Alpha >= a1.2.2, Beta & Releases < 1.2.5
        let a122 = VersionCapabilities::from_mc_version("a1.2.2");
        assert_eq!(a122.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(a122.mods_tab_mode, ModsTabMode::Hidden);
        assert!(!a122.supports_shaderpacks);
        assert!(!a122.supports_non_vanilla_loaders);

        let b173 = VersionCapabilities::from_mc_version("b1.7.3");
        assert_eq!(b173.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(b173.mods_tab_mode, ModsTabMode::Hidden);

        let r11 = VersionCapabilities::from_mc_version("1.1");
        assert_eq!(r11.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(r11.mods_tab_mode, ModsTabMode::Hidden);
        assert!(!r11.supports_non_vanilla_loaders);

        // 1.2.5 ~ 1.4.1 (Non-vanilla loaders enabled, LegacyDualNav, no shaderpacks)
        let r125 = VersionCapabilities::from_mc_version("1.2.5");
        assert_eq!(r125.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(r125.mods_tab_mode, ModsTabMode::LegacyDualNav);
        assert!(r125.supports_non_vanilla_loaders);
        assert!(!r125.supports_shaderpacks);

        // 1.4.2 ~ 1.5.2 (Shaderpacks enabled, texturepacks, LegacyDualNav)
        let r142 = VersionCapabilities::from_mc_version("1.4.2");
        assert_eq!(r142.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(r142.mods_tab_mode, ModsTabMode::LegacyDualNav);
        assert!(r142.supports_shaderpacks);

        let r152 = VersionCapabilities::from_mc_version("1.5.2");
        assert_eq!(r152.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(r152.mods_tab_mode, ModsTabMode::LegacyDualNav);
        assert!(r152.supports_shaderpacks);

        // Snapshot boundary: 13w23b vs 13w24a
        let s13w23b = VersionCapabilities::from_mc_version("13w23b");
        assert_eq!(s13w23b.pack_folder_kind, PackFolderKind::TexturePacks);
        assert_eq!(s13w23b.mods_tab_mode, ModsTabMode::LegacyDualNav);

        let s13w24a = VersionCapabilities::from_mc_version("13w24a");
        assert_eq!(s13w24a.pack_folder_kind, PackFolderKind::ResourcePacks);
        assert_eq!(s13w24a.mods_tab_mode, ModsTabMode::ModernSingleList);
        assert!(s13w24a.supports_shaderpacks);

        // Modern 1.6+ and 1.21.4
        let r161 = VersionCapabilities::from_mc_version("1.6.1");
        assert_eq!(r161.pack_folder_kind, PackFolderKind::ResourcePacks);
        assert_eq!(r161.mods_tab_mode, ModsTabMode::ModernSingleList);
        assert!(r161.supports_shaderpacks);

        let r1214 = VersionCapabilities::from_mc_version("1.21.4");
        assert_eq!(r1214.pack_folder_kind, PackFolderKind::ResourcePacks);
        assert_eq!(r1214.mods_tab_mode, ModsTabMode::ModernSingleList);
        assert!(r1214.supports_shaderpacks);
    }
}
