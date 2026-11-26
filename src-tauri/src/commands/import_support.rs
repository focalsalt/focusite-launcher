//! Shared plumbing for long-running import / export jobs: progress events, cancellation,
//! free-disk-space checks and retry rules.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const IMPORT_PROGRESS_EVENT: &str = "modpack-import-progress";
pub const EXPORT_PROGRESS_EVENT: &str = "instance-export-progress";
/// Error code for a user cancel; the UI localises it (`CANCELLED_CODE` in `errorMessage.ts`).
pub const CANCELLED_MESSAGE: &str = "E_CANCELLED";
/// How often a pack file is retried before it is reported as missing.
pub const MAX_RETRIES: u32 = 3;

static CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub job_id: String,
    pub step: String,
    pub message: String,
    pub current: u64,
    pub total: u64,
    pub speed_bytes_per_sec: u64,
    /// Set while a file is being retried: the attempt number.
    pub retry: Option<u32>,
}

/// Unregisters the cancel flag when the last clone of a session is dropped.
struct Registration(String);

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut map) = cancels().lock() {
            map.remove(&self.0);
        }
    }
}

/// Delivers a progress payload to the UI.
pub type EmitFn = Arc<dyn Fn(ProgressPayload) + Send + Sync>;

/// One import / export run: reports progress to the UI and can be cancelled from it.
#[derive(Clone)]
pub struct JobSession {
    emitter: Option<EmitFn>,
    id: String,
    cancel: Arc<AtomicBool>,
    _registration: Arc<Registration>,
}

impl JobSession {
    /// A session that reports through the Tauri event `event`.
    // The emitter is a closure so that code (and tests) that only use `JobSession` never pull in the Tauri
    // runtime types, whose Windows test binaries do not start without an application manifest.
    pub fn for_app(app: AppHandle, event: &'static str, id: Option<String>) -> Self {
        Self::new(Some(Arc::new(move |p| { let _ = app.emit(event, p); })), id)
    }

    pub fn new(emitter: Option<EmitFn>, id: Option<String>) -> Self {
        let id = id.filter(|i| !i.is_empty() && i.len() <= 64).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = cancels().lock() {
            map.insert(id.clone(), cancel.clone());
        }
        Self { emitter, _registration: Arc::new(Registration(id.clone())), id, cancel }
    }

    pub fn emit(&self, step: &str, message: impl Into<String>, current: u64, total: u64) {
        self.emit_full(step, message, current, total, 0, None);
    }

    pub fn emit_full(&self, step: &str, message: impl Into<String>, current: u64, total: u64, speed: u64, retry: Option<u32>) {
        if let Some(emit) = &self.emitter {
            emit(ProgressPayload {
                job_id: self.id.clone(),
                step: step.to_string(),
                message: message.into(),
                current,
                total,
                speed_bytes_per_sec: speed,
                retry,
            });
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// `Err` once the user pressed cancel; call between steps.
    pub fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(CANCELLED_MESSAGE.into())
        } else {
            Ok(())
        }
    }

    /// Resolves when the job is cancelled (for `select!` against a long await).
    pub async fn cancelled(&self) {
        while !self.is_cancelled() {
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }
}

/// Cancels a running import or export by its job id. Unknown ids are ignored (the job already ended).
#[tauri::command]
pub fn cancel_job(job_id: String) {
    if let Ok(map) = cancels().lock() {
        if let Some(flag) = map.get(&job_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Free bytes on the drive that holds `path`; `None` when it cannot be determined.
// shortcut: only implemented on Windows (the launcher's target), elsewhere the check is skipped.
pub fn available_space(path: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        extern "system" {
            fn GetDiskFreeSpaceExW(dir: *const u16, avail: *mut u64, total: *mut u64, free: *mut u64) -> i32;
        }
        // Walk up to an existing directory: the target folder may not exist yet.
        let mut probe = path;
        while !probe.exists() {
            probe = probe.parent()?;
        }
        let wide: Vec<u16> = probe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut avail = 0u64;
        // SAFETY: `wide` is NUL-terminated and outlives the call; the out pointers are valid or null.
        let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut()) };
        (ok != 0).then_some(avail)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

fn format_bytes(n: u64) -> String {
    const MIB: f64 = 1024.0 * 1024.0;
    let v = n as f64 / MIB;
    if v >= 1024.0 { format!("{:.1} GiB", v / 1024.0) } else { format!("{:.0} MiB", v) }
}

/// Errors when the drive holding `dir` has less than `needed` bytes free (a 64 MiB margin is added).
pub fn ensure_free_space(dir: &Path, needed: u64) -> Result<(), String> {
    let needed = needed.saturating_add(64 * 1024 * 1024);
    match available_space(dir) {
        Some(free) if free < needed => Err(format!(
            "E_DISK_FULL: {} / {}",
            format_bytes(needed),
            format_bytes(free)
        )),
        _ => Ok(()),
    }
}

/// Whether a failed pack-file download is worth another attempt: network trouble, server errors and
/// corrupted bodies are; refused hosts, client errors, missing hashes and size violations are not.
pub fn is_retryable(err: &str) -> bool {
    ["E_CONNECTION", "E_DOWNLOAD_INTERRUPTED", "server error", "Hash mismatch", "timed out", "429"]
        .iter()
        .any(|m| err.contains(m))
}

/// Backoff before retry number `attempt` (1-based): 1s, 2s, 4s.
pub fn retry_delay(attempt: u32) -> Duration {
    Duration::from_secs(1u64 << (attempt.saturating_sub(1)).min(4))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_rules() {
        assert!(is_retryable("E_CONNECTION：error sending request"));
        assert!(is_retryable("E_SERVER_RESPONSE：HTTP status server error (503 Service Unavailable)"));
        assert!(is_retryable("E_FILE_STORE_FAILED：Hash mismatch: expected a, actual b"));
        assert!(!is_retryable("E_SERVER_RESPONSE：HTTP status client error (404 Not Found)"));
        assert!(!is_retryable("E_DOWNLOAD_UNTRUSTED: evil.example"));
        assert!(!is_retryable("E_PACK_NO_HASH"));
        assert!(!is_retryable("E_PACK_SIZE_MISMATCH"));
        assert_eq!(retry_delay(1), Duration::from_secs(1));
        assert_eq!(retry_delay(3), Duration::from_secs(4));
    }

    #[test]
    fn cancel_flag_flows_through_registry() {
        let s = JobSession::new(None, Some("job-x".into()));
        assert!(s.check().is_ok());
        cancel_job("job-x".into());
        assert_eq!(s.check().unwrap_err(), CANCELLED_MESSAGE);
        drop(s);
        assert!(cancels().lock().unwrap().get("job-x").is_none());
    }

    #[test]
    fn free_space_is_reported_for_existing_drive() {
        if cfg!(windows) {
            assert!(available_space(&std::env::temp_dir()).is_some());
            assert!(ensure_free_space(&std::env::temp_dir(), u64::MAX / 2).is_err());
        }
    }
}
