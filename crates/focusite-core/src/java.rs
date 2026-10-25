//! Java Runtime environment scanner and version matching.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstallation {
    pub path: PathBuf,
    pub major_version: u32,
    pub vendor: String,
    pub is_64_bit: bool,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_java_version_recommendations() {
        assert_eq!(get_recommended_java_version("1.21.4"), 21);
        assert_eq!(get_recommended_java_version("1.20.4"), 17);
        assert_eq!(get_recommended_java_version("1.18.2"), 17);
        assert_eq!(get_recommended_java_version("1.16.5"), 8);
    }
}
