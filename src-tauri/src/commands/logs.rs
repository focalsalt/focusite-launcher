//! Browsing past game logs and crash reports of an instance, and opening its log window.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::AppHandle;
use super::instance::{get_instances_dir, read_instance_config, validate_safe_id};

/// Largest amount of text returned for one file; bigger files are cut to their end.
const MAX_READ_BYTES: usize = 5 * 1024 * 1024;
const MAX_LISTED: usize = 200;

#[derive(Debug, Clone, Serialize)]
pub struct LogFileEntry {
    pub name: String,
    /// `"log"` (logs folder) or `"crash"` (crash-reports folder).
    pub kind: String,
    pub size: u64,
    /// Modification time, Unix epoch milliseconds.
    pub modified: i64,
}

fn kind_dir(instance_dir: &Path, kind: &str) -> Result<PathBuf, String> {
    let mc = instance_dir.join("minecraft");
    match kind {
        "log" => Ok(mc.join("logs")),
        "crash" => Ok(mc.join("crash-reports")),
        _ => Err("未知的記錄類型".into()),
    }
}

fn is_wanted(kind: &str, name: &str) -> bool {
    let lower = name.to_lowercase();
    match kind {
        "log" => lower.ends_with(".log") || lower.ends_with(".log.gz"),
        _ => lower.ends_with(".txt"),
    }
}

fn list_kind(instance_dir: &Path, kind: &str) -> Vec<LogFileEntry> {
    let Ok(dir) = kind_dir(instance_dir, kind) else { return Vec::new() };
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let meta = e.metadata().ok()?;
            if !meta.is_file() || !is_wanted(kind, &name) {
                return None;
            }
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            Some(LogFileEntry { name, kind: kind.to_string(), size: meta.len(), modified })
        })
        .collect()
}

/// Lists log files and crash reports of an instance, newest first.
fn list_files(instance_dir: &Path) -> Vec<LogFileEntry> {
    let mut all = list_kind(instance_dir, "log");
    all.extend(list_kind(instance_dir, "crash"));
    all.sort_by_key(|f| std::cmp::Reverse(f.modified));
    all.truncate(MAX_LISTED);
    all
}

/// Reads one file as text (gzip is unpacked); long files are cut to their last `MAX_READ_BYTES`.
fn read_file(instance_dir: &Path, kind: &str, name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") || name.contains(':') {
        return Err("無效的檔案名稱".into());
    }
    if !is_wanted(kind, name) {
        return Err("不支援的檔案類型".into());
    }
    let path = kind_dir(instance_dir, kind)?.join(name);
    if !path.is_file() {
        return Err("找不到檔案".into());
    }
    let raw = fs::File::open(&path).map_err(|e| format!("無法開啟檔案：{}", e))?;
    let mut bytes = Vec::new();
    // Cap the unpacked size too, so a hostile archive cannot fill memory.
    if name.to_lowercase().ends_with(".gz") {
        flate2::read::GzDecoder::new(raw)
            .take(64 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("無法解壓縮檔案：{}", e))?;
    } else {
        raw.take(64 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("無法讀取檔案：{}", e))?;
    }
    if bytes.len() > MAX_READ_BYTES {
        bytes.drain(..bytes.len() - MAX_READ_BYTES);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub async fn list_instance_log_files(instance_id: String) -> Result<Vec<LogFileEntry>, String> {
    super::blocking(move || {
        validate_safe_id(&instance_id)?;
        let dir = get_instances_dir().join(&instance_id);
        if !dir.is_dir() {
            return Err(format!("找不到實例 '{}'", instance_id));
        }
        Ok(list_files(&dir))
    })
    .await
}

#[tauri::command]
pub async fn read_instance_log_file(instance_id: String, kind: String, name: String) -> Result<String, String> {
    super::blocking(move || {
        validate_safe_id(&instance_id)?;
        let dir = get_instances_dir().join(&instance_id);
        read_file(&dir, &kind, &name)
    })
    .await
}

/// Opens (or focuses) the log window of an instance; it shows live output while the game runs.
#[tauri::command]
pub async fn open_instance_log_window(app: AppHandle, instance_id: String) -> Result<(), String> {
    validate_safe_id(&instance_id)?;
    let dir = get_instances_dir().join(&instance_id);
    let name = read_instance_config(&dir).map(|c| c.name).unwrap_or_else(|_| instance_id.clone());
    super::launch::ensure_or_create_log_window(&app, &instance_id, &name).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn lists_and_reads_logs_and_crash_reports() {
        let root = std::env::temp_dir().join(format!("logs_test_{}", std::process::id()));
        let mc = root.join("minecraft");
        fs::create_dir_all(mc.join("logs")).unwrap();
        fs::create_dir_all(mc.join("crash-reports")).unwrap();
        fs::write(mc.join("logs").join("latest.log"), "hello\nworld").unwrap();
        fs::write(mc.join("logs").join("ignored.png"), "x").unwrap();
        fs::write(mc.join("crash-reports").join("crash-1.txt"), "boom").unwrap();
        let mut gz = flate2::write::GzEncoder::new(
            fs::File::create(mc.join("logs").join("2024-01-01-1.log.gz")).unwrap(),
            flate2::Compression::default(),
        );
        gz.write_all(b"zipped").unwrap();
        gz.finish().unwrap();

        let names: Vec<String> = list_files(&root).into_iter().map(|e| e.name).collect();
        assert_eq!(names.len(), 3);
        assert!(!names.contains(&"ignored.png".to_string()));
        assert_eq!(read_file(&root, "log", "latest.log").unwrap(), "hello\nworld");
        assert_eq!(read_file(&root, "log", "2024-01-01-1.log.gz").unwrap(), "zipped");
        assert_eq!(read_file(&root, "crash", "crash-1.txt").unwrap(), "boom");
        assert!(read_file(&root, "log", "../level.dat").is_err());
        assert!(read_file(&root, "log", "ignored.png").is_err());
        let _ = fs::remove_dir_all(root);
    }
}
