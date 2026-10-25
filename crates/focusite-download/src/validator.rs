//! Streaming SHA-1 checksum validator.

use sha1::{Digest, Sha1};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use crate::DownloadError;

pub struct ChecksumValidator;

impl ChecksumValidator {
    pub fn verify_file_sha1<P: AsRef<Path>>(
        file_path: P,
        expected_sha1: &str,
    ) -> Result<(), DownloadError> {
        let file = File::open(file_path.as_ref())?;
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
        if expected_sha1.eq_ignore_ascii_case(&calculated) {
            Ok(())
        } else {
            Err(DownloadError::ValidationFailed {
                path: file_path.as_ref().to_string_lossy().to_string(),
                expected: expected_sha1.to_string(),
                actual: calculated,
            })
        }
    }
}
