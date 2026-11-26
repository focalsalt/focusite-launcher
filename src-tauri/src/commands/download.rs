//! Version ID validation shared by instance and workshop commands.

/// Validates that a version ID contains only safe characters.
pub fn validate_version_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("E_VERSION_ID_EMPTY".into());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("E_VERSION_ID_TRAVERSAL".into());
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err("E_VERSION_ID_INVALID".into());
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_version_id() {
        assert!(validate_version_id("1.21.4").is_ok());
        assert!(validate_version_id("24w45a").is_ok());
        assert!(validate_version_id("1.20.4-pre1").is_ok());

        assert!(validate_version_id("../1.21.4").is_err());
        assert!(validate_version_id("1.21.4/evil").is_err());
        assert!(validate_version_id("").is_err());
    }
}
