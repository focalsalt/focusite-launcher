//! Focusite Diagnostic: Fast offline crash log regex & AST analyzer.

pub mod parser;
pub mod rules;

pub use parser::LogDiagnosticEngine;
pub use rules::{DiagnosticReport, DiagnosticResult, DiagnosticSeverity};

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
        let reports = engine.analyze_log("");
        assert!(reports.is_empty());
    }
}
