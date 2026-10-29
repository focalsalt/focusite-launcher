//! Diagnostic command exposing fast AST crash analysis to frontend.

use focusite_diagnostic::{DiagnosticResult, LogDiagnosticEngine};
use std::sync::LazyLock;

static DIAGNOSTIC_ENGINE: LazyLock<LogDiagnosticEngine> = LazyLock::new(LogDiagnosticEngine::new);

#[tauri::command]
pub fn diagnose_log_content(log_content: String) -> Result<DiagnosticResult, String> {
    Ok(DIAGNOSTIC_ENGINE.diagnose_structured(&log_content))
}

#[tauri::command]
pub fn diagnose_instance_log(instance_id: String) -> Result<DiagnosticResult, String> {
    crate::commands::instance::validate_safe_id(&instance_id)?;
    let log_file = crate::commands::instance::get_instances_dir()
        .join(&instance_id)
        .join("minecraft")
        .join("logs")
        .join("latest.log");

    if !log_file.is_file() {
        return Ok(DiagnosticResult {
            has_crash: false,
            root_cause_type: "NONE".into(),
            summary: "尚未產生日誌檔案 (latest.log)".into(),
            details: vec![],
            suggestion: "啟動實例後若發生異常，智慧診斷模組將在此提供根因分析與修復指引。".into(),
            execution_time_micros: 0,
        });
    }

    let content = std::fs::read_to_string(&log_file).map_err(|e| format!("讀取實例日誌失敗: {e}"))?;
    Ok(DIAGNOSTIC_ENGINE.diagnose_structured(&content))
}
