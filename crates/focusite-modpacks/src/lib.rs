//! Focusite Modpacks: Parsers and generators for .mrpack (Modrinth), CurseForge manifest.json, and Prism instance formats.

pub mod curseforge;
pub mod mrpack;
pub mod prism;
pub mod stack_migration;
pub mod workshop;

pub use curseforge::{CurseForgeManifest, MissingModItem, unpack_curseforge_pack, rescan_missing_mods};
pub use mrpack::{ModrinthIndex, unpack_mrpack};
pub use stack_migration::{MigrationPlan, MigrationUpdateItem, plan_stack_migration};
pub use workshop::{SearchFilters, WorkshopCategory, WorkshopProjectDetail, InstallPlan, InstallPlanItem, WorkshopProjectSummary, WorkshopVersionItem};

#[derive(Debug, thiserror::Error)]
pub enum ModpackError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

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
