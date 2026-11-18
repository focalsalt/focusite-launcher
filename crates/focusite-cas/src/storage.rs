//! Content-addressable storage operations with strict SHA-1 validation.

use sha1::{Digest, Sha1};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use crate::CasError;

/// Validates that a string is a valid 40-character hexadecimal SHA-1 hash.
pub fn is_valid_sha1(hash: &str) -> bool {
    hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Debug, Clone)]
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
    pub fn object_path(&self, sha1_hex: &str) -> Result<PathBuf, CasError> {
        let normalized = sha1_hex.to_ascii_lowercase();
        if !is_valid_sha1(&normalized) {
            return Err(CasError::InvalidHash(sha1_hex.to_string()));
        }
        let prefix = &normalized[0..2];
        Ok(self.root_dir.join("objects").join(prefix).join(normalized))
    }

    /// Checks if the object exists in CAS.
    pub fn exists(&self, sha1_hex: &str) -> bool {
        match self.object_path(sha1_hex) {
            Ok(p) => p.is_file(),
            Err(_) => false,
        }
    }

    /// Stores raw bytes into the CAS and validates SHA-1.
    pub fn store(&self, data: &[u8], expected_sha1: Option<&str>) -> Result<String, CasError> {
        let mut hasher = Sha1::new();
        hasher.update(data);
        let calculated_sha1 = format!("{:x}", hasher.finalize());

        if let Some(exp) = expected_sha1 {
            let exp_norm = exp.to_ascii_lowercase();
            if !is_valid_sha1(&exp_norm) {
                return Err(CasError::InvalidHash(exp.to_string()));
            }
            if exp_norm != calculated_sha1 {
                return Err(CasError::HashMismatch {
                    expected: exp.to_string(),
                    actual: calculated_sha1,
                });
            }
        }

        self.put(&calculated_sha1, |tmp| fs::write(tmp, data))?;
        Ok(calculated_sha1)
    }

    /// Writes a new object through a temp file and a rename. An object that already exists is left
    /// alone: its content is the same by definition, and it is hard-linked into instances, so rewriting
    /// it in place could truncate those files (or fail while the game holds them open).
    fn put(&self, sha1: &str, write: impl FnOnce(&Path) -> std::io::Result<()>) -> Result<(), CasError> {
        let target_path = self.object_path(sha1)?;
        if target_path.is_file() {
            return Ok(());
        }
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        static NEXT_TMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = NEXT_TMP.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let tmp = target_path.with_extension(format!("{}-{}.tmp", std::process::id(), n));
        let result = write(&tmp).and_then(|_| fs::rename(&tmp, &target_path));
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
            // Another writer may have stored the same object meanwhile; that is a success.
            if target_path.is_file() {
                return Ok(());
            }
        }
        result.map_err(CasError::from)
    }

    /// Stores a file from an existing path into CAS by copying and validating its SHA-1 hash.
    pub fn store_file<P: AsRef<Path>>(
        &self,
        src_path: P,
        expected_sha1: Option<&str>,
    ) -> Result<String, CasError> {
        let file = File::open(src_path.as_ref())?;
        let mut reader = BufReader::new(file);
        let mut hasher = Sha1::new();
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = reader.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let calculated_sha1 = format!("{:x}", hasher.finalize());

        if let Some(exp) = expected_sha1 {
            let exp_norm = exp.to_ascii_lowercase();
            if !is_valid_sha1(&exp_norm) {
                return Err(CasError::InvalidHash(exp.to_string()));
            }
            if exp_norm != calculated_sha1 {
                return Err(CasError::HashMismatch {
                    expected: exp.to_string(),
                    actual: calculated_sha1,
                });
            }
        }

        self.put(&calculated_sha1, |tmp| fs::copy(src_path.as_ref(), tmp).map(|_| ()))?;
        Ok(calculated_sha1)
    }

    /// Verifies that the stored object exists and matches its expected SHA-1 hash.
    pub fn verify_object(&self, sha1_hex: &str) -> Result<bool, CasError> {
        let path = self.object_path(sha1_hex)?;
        if !path.is_file() {
            return Ok(false);
        }

        let file = File::open(&path)?;
        let mut reader = BufReader::new(file);
        let mut hasher = Sha1::new();
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = reader.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let calculated = format!("{:x}", hasher.finalize());
        Ok(calculated.eq_ignore_ascii_case(sha1_hex))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_retrieve_sha1() {
        let temp_dir = std::env::temp_dir().join("focusite_cas_test_store");
        let cas = ContentAddressableStorage::new(&temp_dir);

        let data = b"hello minecraft";
        let mut hasher = Sha1::new();
        hasher.update(data);
        let expected_sha1 = format!("{:x}", hasher.finalize());

        let saved = cas.store(data, Some(&expected_sha1)).unwrap();
        assert_eq!(saved, expected_sha1);
        assert!(cas.exists(&saved));
        assert!(cas.verify_object(&saved).unwrap());

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn existing_object_is_never_rewritten() {
        let temp_dir = std::env::temp_dir().join(format!("fc_cas_keep_{}", std::process::id()));
        let cas = ContentAddressableStorage::new(&temp_dir);
        let hash = cas.store(b"jar bytes", None).unwrap();
        let path = cas.object_path(&hash).unwrap();
        let before = fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert_eq!(cas.store(b"jar bytes", None).unwrap(), hash);
        assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
        let leftovers = fs::read_dir(path.parent().unwrap()).unwrap().count();
        assert_eq!(leftovers, 1, "no temp file is left behind");
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_malformed_sha1_rejection() {
        let temp_dir = std::env::temp_dir().join("focusite_cas_malformed_test");
        let cas = ContentAddressableStorage::new(&temp_dir);

        // Path traversal attempts
        assert!(!cas.exists("../../../etc/passwd"));
        assert!(matches!(
            cas.object_path("../../../etc/passwd"),
            Err(CasError::InvalidHash(_))
        ));

        // Short hash
        assert!(matches!(
            cas.object_path("abcdef"),
            Err(CasError::InvalidHash(_))
        ));

        // Non-hex
        assert!(matches!(
            cas.object_path("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"),
            Err(CasError::InvalidHash(_))
        ));
    }
}
