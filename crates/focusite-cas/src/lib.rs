//! Focusite CAS: Content-Addressable Storage with filesystem hardlinks deduplication.

pub mod hardlink;
pub mod storage;

#[derive(Debug, thiserror::Error)]
pub enum CasError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Hash mismatch: expected {expected}, actual {actual}")]
    HashMismatch { expected: String, actual: String },

    #[error("Object not found in CAS: {0}")]
    NotFound(String),
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
