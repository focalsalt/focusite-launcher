//! Focusite Diagnostic: Fast offline crash log regex & AST analyzer.

pub mod parser;
pub mod rules;

pub use parser::LogDiagnosticEngine;
pub use rules::{DiagnosticReport, DiagnosticResult, DiagnosticSeverity};

/// Formats the zh-TW or the en-US template, for text the backend writes itself.
#[macro_export]
macro_rules! localized {
    ($is_zh:expr, $zh:literal, $en:literal $(, $arg:expr)*) => {
        if $is_zh { format!($zh $(, $arg)*) } else { format!($en $(, $arg)*) }
    };
}

#[derive(Debug, thiserror::Error)]
pub enum DiagnosticError {
    #[error("Regex error: {0}")]
    Regex(#[from] regex::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnostic_engine_empty_log() {
        let engine = parser::LogDiagnosticEngine::new();
        let reports = engine.analyze_log("", false);
        assert!(reports.is_empty());
    }
}
