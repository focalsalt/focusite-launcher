//! Content-addressable storage operations.

use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};
use crate::CasError;

pub struct ContentAddressableStorage {
    root_dir: PathBuf,
}

impl ContentAddressableStorage {
    pub fn new<P: AsRef<Path>>(root_dir: P) -> Self {
        Self {
            root_dir: root_dir.as_ref().to_path_buf(),
        }
    }

    /// Resolves the storage path for a given SHA-1 hash.
    /// Format: `root_dir/objects/ab/abcdef...`
    pub fn object_path(&self, sha1_hex: &str) -> PathBuf {
        let prefix = if sha1_hex.len() >= 2 {
            &sha1_hex[0..2]
        } else {
            "xx"
        };
        self.root_dir.join("objects").join(prefix).join(sha1_hex)
    }

    /// Checks if the object exists in CAS.
    pub fn exists(&self, sha1_hex: &str) -> bool {
        self.object_path(sha1_hex).exists()
    }

    /// Stores raw bytes into the CAS and validates SHA-1.
    pub fn store(&self, data: &[u8], expected_sha1: Option<&str>) -> Result<String, CasError> {
        let mut hasher = Sha1::new();
        hasher.update(data);
        let calculated_sha1 = format!("{:x}", hasher.finalize());

        if let Some(exp) = expected_sha1 {
            if !exp.eq_ignore_ascii_case(&calculated_sha1) {
                return Err(CasError::HashMismatch {
                    expected: exp.to_string(),
                    actual: calculated_sha1,
                });
            }
        }

        let target_path = self.object_path(&calculated_sha1);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(target_path, data)?;
        Ok(calculated_sha1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_retrieve_sha1() {
        let temp_dir = std::env::temp_dir().join("focusite_cas_test");
        let cas = ContentAddressableStorage::new(&temp_dir);

        let data = b"hello minecraft";
        let mut hasher = Sha1::new();
        hasher.update(data);
        let expected_sha1 = format!("{:x}", hasher.finalize());

        let saved = cas.store(data, Some(&expected_sha1)).unwrap();
        assert_eq!(saved, expected_sha1);
        assert!(cas.exists(&saved));

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
