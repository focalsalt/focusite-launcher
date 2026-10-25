//! Filesystem hardlinks creation with graceful copy fallback.

use std::fs;
use std::path::Path;
use tracing::warn;

pub struct HardlinkManager;

impl HardlinkManager {
    /// Attempts to create a hardlink from source to target.
    /// If creation fails (e.g. cross-filesystem boundaries), automatically falls back to copying.
    pub fn link_or_copy<P: AsRef<Path>, Q: AsRef<Path>>(
        src: P,
        dst: Q,
    ) -> Result<bool, std::io::Error> {
        let src = src.as_ref();
        let dst = dst.as_ref();

        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }

        // If destination already exists, remove it first
        if dst.exists() {
            fs::remove_file(dst)?;
        }

        match fs::hard_link(src, dst) {
            Ok(()) => Ok(true), // Hardlinked successfully
            Err(err) => {
                warn!(
                    "Failed to create hardlink from {:?} to {:?}: {}. Falling back to copy.",
                    src, dst, err
                );
                fs::copy(src, dst)?;
                Ok(false) // Copied fallback
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_link_or_copy() {
        let temp_dir = std::env::temp_dir().join("focusite_link_test");
        let _ = fs::create_dir_all(&temp_dir);

        let src = temp_dir.join("source.txt");
        let dst = temp_dir.join("dest.txt");

        fs::write(&src, b"test content").unwrap();
        let res = HardlinkManager::link_or_copy(&src, &dst).unwrap();

        assert!(dst.exists());
        assert_eq!(fs::read(&dst).unwrap(), b"test content");

        // On same filesystem in temp_dir, hard link should succeed
        assert!(res);

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
