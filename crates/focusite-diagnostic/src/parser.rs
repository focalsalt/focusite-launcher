//! Log stream parser and matching engine.

use regex::Regex;
use crate::rules::{DiagnosticReport, DiagnosticRule, DiagnosticSeverity};

pub const DEFAULT_RULES: &[DiagnosticRule] = &[
    DiagnosticRule {
        id: "java_version_mismatch",
        pattern: r"UnsupportedClassVersionError: .* \(class file version (\d+\.\d+)\) .* class file version (\d+\.\d+)",
        title: "Java 版本不相容 (UnsupportedClassVersionError)",
        severity: DiagnosticSeverity::Critical,
        root_cause_template: "遊戲或某個模組需要更新的 Java 版本，但當前啟動使用的 Java 版本過舊。",
        fix_recommendation: "請於實例設定中切換至與當前 Minecraft 版本相符之 Java JRE (如 Java 17 或 21)。",
    },
    DiagnosticRule {
        id: "out_of_memory",
        pattern: r"java\.lang\.OutOfMemoryError: Java heap space",
        title: "記憶體耗盡 (OutOfMemoryError)",
        severity: DiagnosticSeverity::Critical,
        root_cause_template: "Minecraft JVM 分配的堆疊記憶體 (Heap Space) 不足，導致進程崩潰。",
        fix_recommendation: "請前往實例設定調大最大記憶體分配 (建議分配 4096 MB 以上)。",
    },
    DiagnosticRule {
        id: "fabric_missing_api",
        pattern: r"net\.fabricmc\.loader\.impl\.FormattedException: Mod '([^']+)' requires (.+)",
        title: "Fabric 模組缺失依賴",
        severity: DiagnosticSeverity::Critical,
        root_cause_template: "載入模組時缺少必要的前置相依模組 (如 Fabric API)。",
        fix_recommendation: "請透過模組工作坊安裝提示缺失的對應相依模組與版本。",
    },
    DiagnosticRule {
        id: "duplicate_mod",
        pattern: r"Duplicate mod id found: ([a-zA-Z0-9_\-]+)",
        title: "重複的模組識別碼 (Duplicate Mod ID)",
        severity: DiagnosticSeverity::Critical,
        root_cause_template: "mods 資料夾內存在多個相同 ID 的 Mod Jar 檔案。",
        fix_recommendation: "請檢查 mods 資料夾並刪除同一個模組的舊版本 Jar 檔案。",
    },
];

pub struct LogDiagnosticEngine {
    compiled_rules: Vec<(&'static DiagnosticRule, Regex)>,
}

impl LogDiagnosticEngine {
    pub fn new() -> Self {
        let mut compiled = Vec::new();
        for rule in DEFAULT_RULES {
            if let Ok(re) = Regex::new(rule.pattern) {
                compiled.push((rule, re));
            }
        }
        Self { compiled_rules: compiled }
    }

    /// Analyzes the raw log output and returns structured diagnostics if rules match.
    pub fn analyze_log(&self, log_content: &str) -> Vec<DiagnosticReport> {
        let mut reports = Vec::new();

        for (rule, re) in &self.compiled_rules {
            if let Some(captures) = re.captures(log_content) {
                let affected = captures.get(1).map(|m| m.as_str().to_string()).into_iter().collect();

                reports.push(DiagnosticReport {
                    matched_rule: rule.id.to_string(),
                    title: rule.title.to_string(),
                    severity: rule.severity.clone(),
                    root_cause: rule.root_cause_template.to_string(),
                    recommended_fix: rule.fix_recommendation.to_string(),
                    affected_files: affected,
                });
            }
        }

        reports
    }
}

impl Default for LogDiagnosticEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnose_oom() {
        let engine = LogDiagnosticEngine::new();
        let log = "Exception in thread \"main\" java.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.world.World...";
        let reports = engine.analyze_log(log);

        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].matched_rule, "out_of_memory");
        assert_eq!(reports[0].severity, DiagnosticSeverity::Critical);
    }

    #[test]
    fn test_diagnose_duplicate_mod() {
        let engine = LogDiagnosticEngine::new();
        let log = "Fatal error: Duplicate mod id found: sodium, please check your mods folder.";
        let reports = engine.analyze_log(log);

        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].matched_rule, "duplicate_mod");
        assert_eq!(reports[0].affected_files, vec!["sodium"]);
    }
}
