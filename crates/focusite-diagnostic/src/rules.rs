//! Rule definitions and diagnostics data models.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub matched_rule: String,
    pub title: String,
    pub severity: DiagnosticSeverity,
    pub root_cause: String,
    pub recommended_fix: String,
    pub affected_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Critical,
    Warning,
    Info,
}

pub struct DiagnosticRule {
    pub id: &'static str,
    pub pattern: &'static str,
    pub title: &'static str,
    pub severity: DiagnosticSeverity,
    pub root_cause_template: &'static str,
    pub fix_recommendation: &'static str,
}
