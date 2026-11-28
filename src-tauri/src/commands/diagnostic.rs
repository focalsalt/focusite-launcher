//! Diagnostic command exposing fast AST crash analysis to frontend.

use super::ui_language::{self, tr};
use focusite_diagnostic::{DiagnosticResult, LogDiagnosticEngine};
use std::sync::LazyLock;

static DIAGNOSTIC_ENGINE: LazyLock<LogDiagnosticEngine> = LazyLock::new(LogDiagnosticEngine::new);

#[tauri::command]
pub fn diagnose_log_content(log_content: String) -> Result<DiagnosticResult, String> {
    Ok(DIAGNOSTIC_ENGINE.diagnose_structured(&log_content, ui_language::is_zh()))
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
            summary: tr!("尚未產生日誌檔案 (latest.log)", "No log file yet (latest.log)"),
            details: vec![],
            suggestion: tr!("啟動實例後若發生異常，智慧診斷模組將在此提供根因分析與修復指引。", "If something goes wrong after launching, the cause and a fix are shown here."),
            execution_time_micros: 0,
        });
    }

    let content = std::fs::read_to_string(&log_file).map_err(super::ctx("E_INSTANCE_LOG_UNREADABLE"))?;
    Ok(DIAGNOSTIC_ENGINE.diagnose_structured(&content, ui_language::is_zh()))
}
