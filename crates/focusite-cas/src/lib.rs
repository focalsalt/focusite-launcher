//! Focusite CAS: Content-Addressable Storage with filesystem hardlinks deduplication.

pub mod hardlink;
pub mod storage;

use std::path::{Path, PathBuf};
pub use hardlink::HardlinkManager;
pub use storage::ContentAddressableStorage;

#[derive(Debug, thiserror::Error)]
pub enum CasError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Hash mismatch: expected {expected}, actual {actual}")]
    HashMismatch { expected: String, actual: String },

    #[error("Object not found in CAS: {0}")]
    NotFound(String),

    #[error("Invalid SHA-1 hash format: {0}")]
    InvalidHash(String),
}

/// High-level CAS Manager coordinating global deduplication and instance virtualization.
#[derive(Debug, Clone)]
pub struct CasManager {
    cas: ContentAddressableStorage,
}

impl CasManager {
    pub fn new<P: AsRef<Path>>(root_dir: P) -> Self {
        Self {
            cas: ContentAddressableStorage::new(root_dir),
        }
    }

    /// Stores raw byte data into CAS.
    pub fn store_bytes(&self, data: &[u8], expected_hash: Option<&str>) -> Result<String, CasError> {
        self.cas.store(data, expected_hash)
    }

    /// Stores an existing file into CAS.
    pub fn store_file<P: AsRef<Path>>(&self, source: P, expected_hash: Option<&str>) -> Result<String, CasError> {
        self.cas.store_file(source, expected_hash)
    }

    /// Hardlinks (or copies on cross-volume) an object from CAS to an instance path.
    pub fn link_to_instance<P: AsRef<Path>>(&self, hash: &str, target_path: P) -> Result<bool, CasError> {
        if !self.cas.exists(hash) {
            return Err(CasError::NotFound(hash.to_string()));
        }
        let src = self.cas.object_path(hash)?;
        let is_hardlinked = HardlinkManager::link_or_copy(src, target_path)?;
        Ok(is_hardlinked)
    }

    /// Checks if a given SHA-1 hash is stored in CAS.
    pub fn exists(&self, hash: &str) -> bool {
        self.cas.exists(hash)
    }

    /// Resolves the absolute path to an object in CAS.
    pub fn object_path(&self, hash: &str) -> Result<PathBuf, CasError> {
        self.cas.object_path(hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_cas_error_display() {
        let err = CasError::NotFound("obj_12345".into());
        assert_eq!(err.to_string(), "Object not found in CAS: obj_12345");

        let mismatch = CasError::HashMismatch {
            expected: "aaa".into(),
            actual: "bbb".into(),
        };
        assert_eq!(mismatch.to_string(), "Hash mismatch: expected aaa, actual bbb");
    }

    #[test]
    fn test_cas_manager_virtualization() {
        let temp_dir = std::env::temp_dir().join("focusite_cas_mgr_test");
        let _ = fs::create_dir_all(&temp_dir);

        let mgr = CasManager::new(temp_dir.join("global_cas"));
        let hash = mgr.store_bytes(b"virtualized asset", None).unwrap();
        assert!(mgr.exists(&hash));

        let instance_dst = temp_dir.join("instances").join("test_inst").join("assets.txt");
        let linked = mgr.link_to_instance(&hash, &instance_dst).unwrap();
        assert!(linked);
        assert_eq!(fs::read(&instance_dst).unwrap(), b"virtualized asset");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
