//! Tauri command implementations for Focusite Launcher.

use std::path::PathBuf;

/// Recursively copies `src` into `dst`. A symlink is skipped with a warning when `skip_links` is set,
/// otherwise it is an error (used when the source is about to be deleted, so nothing is silently lost).
pub fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path, skip_links: bool) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            if skip_links {
                tracing::warn!("略過符號連結 {}", entry.path().display());
                continue;
            }
            return Err(std::io::Error::other(format!(
                "含有符號連結 {}，無法跨磁碟搬移",
                entry.path().display()
            )));
        }
        if kind.is_dir() {
            copy_dir_all(&entry.path(), &to, skip_links)?;
        } else {
            std::fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

pub mod auth;
pub mod friends;
pub mod import_support;
pub mod diagnostic;
pub mod download;
pub mod instance;
pub mod instance_transfer;
pub mod launch;
pub mod launcher_import;
pub mod logs;
pub mod manifest;
pub mod modpack;
pub mod news;
pub mod p2p;
pub mod provisioning;
pub mod server;
pub mod settings;
pub mod share;
pub mod skin;
pub mod theme;
pub mod workshop;
pub mod world;

/// Shared HTTP client: one connection pool, a User-Agent, and timeouts so a stalled server never hangs a
/// command. There is no total time limit, so large but steady downloads still finish.
pub fn http() -> &'static reqwest::Client {
    static CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Focusite-Launcher/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(15))
            .read_timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default()
    });
    &CLIENT
}

/// Runs blocking disk work on a worker thread. Synchronous Tauri commands run on the main thread,
/// so long copies, deletes or image work there would freeze the window.
pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| format!("背景工作執行失敗：{}", e))?
}

/// Builds a `map_err` adapter that prefixes a short Chinese action description to the cause.
pub fn ctx<E: std::fmt::Display>(prefix: &'static str) -> impl Fn(E) -> String {
    move |e| format!("{}：{}", prefix, e)
}

/// Writes `bytes` to a sibling temp file and renames it over `path`, so a crash never leaves a
/// truncated file behind.
pub fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp_name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Resolves the canonical Focusite Launcher storage directory: %APPDATA%/focusite_launcher/
pub fn get_app_data_dir() -> PathBuf {
    let dir = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("focusite_launcher")
    } else if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        PathBuf::from(home).join(".focusite_launcher")
    } else {
        PathBuf::from(".").join(".focusite_launcher")
    };

    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    dir
}
