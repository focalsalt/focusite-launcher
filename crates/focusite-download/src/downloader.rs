//! Parallel chunked downloader with automatic mirror fallback and streaming checksum verification.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use sha1::{Digest, Sha1};
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;
use tokio::sync::{mpsc, Semaphore};
use tracing::{info, warn};

use crate::chunked::{DownloadProgress, DownloadTask};
use crate::mirror::{MirrorManager, MirrorProvider};
use crate::DownloadError;

#[derive(Debug, Clone)]
pub struct Downloader {
    client: reqwest::Client,
    pub mirror_provider: MirrorProvider,
    pub allow_fallback: bool,
    official_timeout: Duration,
    fallback_timeout: Duration,
    concurrency_limit: usize,
}

impl Default for Downloader {
    fn default() -> Self {
        Self::new(Duration::from_secs(3), Duration::from_secs(15), 16)
    }
}

impl Downloader {
    pub fn new(official_timeout: Duration, fallback_timeout: Duration, concurrency_limit: usize) -> Self {
        Self::new_with_provider(
            MirrorProvider::Official,
            false,
            official_timeout,
            fallback_timeout,
            concurrency_limit,
        )
    }

    pub fn new_with_provider(
        mirror_provider: MirrorProvider,
        allow_fallback: bool,
        official_timeout: Duration,
        fallback_timeout: Duration,
        concurrency_limit: usize,
    ) -> Self {
        let client = reqwest::Client::builder()
            .pool_max_idle_per_host(32)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            mirror_provider,
            allow_fallback,
            official_timeout,
            fallback_timeout,
            concurrency_limit: concurrency_limit.max(1),
        }
    }

    /// Generates candidate URLs ordered by priority.
    /// Strictly respects the configured mirror provider without unauthorized cross-provider fallback.
    pub fn get_candidate_urls(&self, initial_url: &str) -> Vec<(String, Duration)> {
        let rewritten = MirrorManager::rewrite_url(initial_url, self.mirror_provider);
        let mut candidates = vec![(rewritten, self.official_timeout)];

        // Only append fallback mirrors if explicitly enabled by configuration
        if self.allow_fallback && self.mirror_provider == MirrorProvider::Official {
            let bmclapi = MirrorManager::rewrite_url(initial_url, MirrorProvider::Bmclapi);
            if bmclapi != candidates[0].0 {
                candidates.push((bmclapi, self.fallback_timeout));
            }

            let mcbbs = MirrorManager::rewrite_url(initial_url, MirrorProvider::Mcbbs);
            if mcbbs != candidates[0].0 && !candidates.iter().any(|(u, _)| u == &mcbbs) {
                candidates.push((mcbbs, self.fallback_timeout));
            }
        }

        candidates
    }

    /// Downloads a single file with automatic fallback and streaming SHA-1 verification.
    pub async fn download_file<P: AsRef<Path>>(
        &self,
        url: &str,
        destination: P,
        expected_sha1: Option<&str>,
        progress_tx: Option<mpsc::Sender<DownloadProgress>>,
        task_id: &str,
    ) -> Result<(), DownloadError> {
        let dest = destination.as_ref();
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).await?;
        }

        let temp_dest = PathBuf::from(format!("{}.download", dest.to_string_lossy()));
        let candidates = self.get_candidate_urls(url);
        let mut last_error = None;

        for (candidate_url, timeout) in candidates {
            info!("Attempting download from {}", candidate_url);
            match self
                .stream_download(
                    &candidate_url,
                    &temp_dest,
                    timeout,
                    expected_sha1,
                    progress_tx.as_ref(),
                    task_id,
                )
                .await
            {
                Ok(()) => {
                    // Download and validation succeeded; atomically replace destination
                    if dest.exists() {
                        let _ = fs::remove_file(dest).await;
                    }
                    fs::rename(&temp_dest, dest).await?;
                    info!("Successfully downloaded to {:?}", dest);
                    return Ok(());
                }
                Err(err) => {
                    warn!(
                        "Download attempt failed for {}: {}. Trying next fallback candidate if available.",
                        candidate_url, err
                    );
                    if temp_dest.exists() {
                        let _ = fs::remove_file(&temp_dest).await;
                    }
                    last_error = Some(err);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| DownloadError::AllSourcesFailed {
            url: url.to_string(),
        }))
    }

    async fn stream_download(
        &self,
        url: &str,
        temp_dest: &Path,
        timeout: Duration,
        expected_sha1: Option<&str>,
        progress_tx: Option<&mpsc::Sender<DownloadProgress>>,
        task_id: &str,
    ) -> Result<(), DownloadError> {
        let resp = self
            .client
            .get(url)
            .timeout(timeout)
            .send()
            .await?
            .error_for_status()?;

        let total_bytes = resp.content_length();
        let mut file = File::create(temp_dest).await?;
        let mut hasher = Sha1::new();
        let mut downloaded_bytes: u64 = 0;
        let start_time = Instant::now();

        let mut stream_resp = resp;
        while let Some(chunk) = stream_resp.chunk().await? {
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
            downloaded_bytes += chunk.len() as u64;

            if let Some(tx) = progress_tx {
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 {
                    (downloaded_bytes as f64 / elapsed) as u64
                } else {
                    0
                };
                let _ = tx
                    .send(DownloadProgress {
                        task_id: task_id.to_string(),
                        downloaded_bytes,
                        total_bytes,
                        speed_bytes_per_sec: speed,
                    })
                    .await;
            }
        }

        file.flush().await?;

        let calculated_sha1 = format!("{:x}", hasher.finalize());
        if let Some(exp) = expected_sha1 {
            if !exp.eq_ignore_ascii_case(&calculated_sha1) {
                return Err(DownloadError::ValidationFailed {
                    path: temp_dest.to_string_lossy().to_string(),
                    expected: exp.to_string(),
                    actual: calculated_sha1,
                });
            }
        }

        Ok(())
    }

    /// Parallel batch download with concurrency semaphore.
    pub async fn download_batch(
        &self,
        tasks: Vec<DownloadTask>,
        progress_tx: Option<mpsc::Sender<DownloadProgress>>,
    ) -> Result<usize, DownloadError> {
        let total = tasks.len();
        let semaphore = Arc::new(Semaphore::new(self.concurrency_limit));
        let mut join_set = tokio::task::JoinSet::new();

        for (i, task) in tasks.into_iter().enumerate() {
            let sem = semaphore.clone();
            let downloader = self.clone();
            let p_tx = progress_tx.clone();
            let task_id = format!("task-{}", i);

            join_set.spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                downloader
                    .download_file(
                        &task.url,
                        PathBuf::from(task.destination),
                        task.expected_sha1.as_deref(),
                        p_tx,
                        &task_id,
                    )
                    .await
            });
        }

        let mut completed = 0;
        while let Some(res) = join_set.join_next().await {
            match res {
                Ok(Ok(())) => completed += 1,
                Ok(Err(e)) => return Err(e),
                Err(e) => return Err(DownloadError::Io(std::io::Error::other(e.to_string()))),
            }
        }

        info!("Batch download finished: {}/{} tasks succeeded.", completed, total);
        Ok(completed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_official_strict_isolation_no_fallback() {
        let dl = Downloader::new(Duration::from_secs(3), Duration::from_secs(10), 4);
        let candidates = dl.get_candidate_urls("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");

        // Strict isolation: only 1 candidate, strictly Official Mojang
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].0, "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
        assert_eq!(candidates[0].1, Duration::from_secs(3));
    }

    #[test]
    fn test_bmclapi_mirror_candidate() {
        let dl = Downloader::new_with_provider(
            MirrorProvider::Bmclapi,
            false,
            Duration::from_secs(5),
            Duration::from_secs(10),
            4,
        );
        let candidates = dl.get_candidate_urls("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].0, "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json");
        assert_eq!(candidates[0].1, Duration::from_secs(5));
    }

    #[test]
    fn test_candidate_generation_with_explicit_fallback() {
        let dl = Downloader::new_with_provider(
            MirrorProvider::Official,
            true,
            Duration::from_secs(3),
            Duration::from_secs(10),
            4,
        );
        let candidates = dl.get_candidate_urls("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");

        assert_eq!(candidates.len(), 3);
        assert_eq!(candidates[0].0, "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
        assert_eq!(candidates[0].1, Duration::from_secs(3));
        assert_eq!(candidates[1].0, "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json");
        assert_eq!(candidates[1].1, Duration::from_secs(10));
    }
}
