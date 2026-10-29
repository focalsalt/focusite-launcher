//! Focusite Modpacks: Parsers and generators for .mrpack (Modrinth), CurseForge manifest.json, and Prism instance formats.

pub mod curseforge;
pub mod mrpack;
pub mod prism;

pub use curseforge::{CurseForgeManifest, MissingModItem, unpack_curseforge_pack, rescan_missing_mods};
pub use mrpack::{ModrinthIndex, unpack_mrpack};

#[derive(Debug, thiserror::Error)]
pub enum ModpackError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid modpack archive: {0}")]
    InvalidArchive(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_modpack_error_display() {
        let err = ModpackError::InvalidArchive("missing index.json".into());
        assert_eq!(err.to_string(), "Invalid modpack archive: missing index.json");
    }
}
