//! Chunked download task representation, progress notification, and HTTP Range concurrent engine.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use reqwest::header::RANGE;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::mpsc;
use tracing::info;

use crate::DownloadError;

pub const CHUNK_THRESHOLD_BYTES: u64 = 4 * 1024 * 1024; // 4 MiB
pub const DEFAULT_CHUNK_SIZE: u64 = 2 * 1024 * 1024; // 2 MiB
pub const MAX_CONCURRENT_CHUNKS: usize = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub url: String,
    pub destination: String,
    pub expected_sha1: Option<String>,
    pub expected_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub task_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_sec: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct ChunkRange {
    pub index: usize,
    pub start: u64,
    pub end: u64,
}

/// Checks whether the server supports HTTP Range and returns the Content-Length.
pub async fn probe_range_support(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
) -> Result<Option<u64>, DownloadError> {
    let resp = client
        .head(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(DownloadError::Network)?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let accept_ranges = resp
        .headers()
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("bytes"))
        .unwrap_or(false);

    let content_length = resp.content_length();
    if accept_ranges {
        Ok(content_length)
    } else {
        Ok(None)
    }
}

/// Downloads a file concurrently using HTTP Range chunks.
/// If the server does not support partial content (returns 200 OK instead of 206),
/// returns `DownloadError::RangeNotSupported` so the caller can fall back to single stream.
#[allow(clippy::too_many_arguments)]
pub async fn download_file_chunked(
    client: &reqwest::Client,
    url: &str,
    temp_dest: &Path,
    total_size: u64,
    timeout: Duration,
    expected_sha1: Option<&str>,
    progress_tx: Option<&mpsc::Sender<DownloadProgress>>,
    task_id: &str,
) -> Result<(), DownloadError> {
    // 1. Calculate chunk count and boundaries
    let num_chunks = (total_size.div_ceil(DEFAULT_CHUNK_SIZE) as usize)
        .clamp(2, MAX_CONCURRENT_CHUNKS);
    let chunk_span = total_size.div_ceil(num_chunks as u64);

    let mut ranges = Vec::with_capacity(num_chunks);
    for i in 0..num_chunks {
        let start = i as u64 * chunk_span;
        let end = ((i as u64 + 1) * chunk_span - 1).min(total_size - 1);
        if start <= end {
            ranges.push(ChunkRange {
                index: i,
                start,
                end,
            });
        }
    }

    info!(
        "Initiating Range chunked download for {} ({:.2} MB in {} chunks)",
        url,
        total_size as f64 / (1024.0 * 1024.0),
        ranges.len()
    );

    // 2. Pre-allocate target .part file
    {
        let file = tokio::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(temp_dest)
            .await?;
        file.set_len(total_size).await?;
    }

    let shared_downloaded = Arc::new(AtomicU64::new(0));
    let start_time = Instant::now();
    let mut join_set = tokio::task::JoinSet::new();

    for range in ranges {
        let client_c = client.clone();
        let url_c = url.to_string();
        let path_c = temp_dest.to_path_buf();
        let shared_dl = shared_downloaded.clone();
        let p_tx = progress_tx.cloned();
        let tid = task_id.to_string();

        join_set.spawn(async move {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .open(&path_c)
                .await?;
            file.seek(SeekFrom::Start(range.start)).await?;

            let range_header_val = format!("bytes={}-{}", range.start, range.end);
            let resp = client_c
                .get(&url_c)
                .header(RANGE, range_header_val)
                .timeout(timeout)
                .send()
                .await
                .map_err(DownloadError::Network)?;

            let status = resp.status();
            if status == StatusCode::OK {
                // Server ignored Range request and returned full file
                return Err(DownloadError::RangeNotSupported { url: url_c });
            }
            if status != StatusCode::PARTIAL_CONTENT {
                let err_msg = format!("HTTP chunk error: status {}", status);
                return Err(DownloadError::Io(std::io::Error::other(err_msg)));
            }

            let mut stream = resp;
            let mut chunk_written: u64 = 0;
            let expected_len = range.end - range.start + 1;

            while let Some(bytes) = stream.chunk().await.map_err(DownloadError::Network)? {
                let len = bytes.len() as u64;
                if chunk_written + len > expected_len {
                    return Err(DownloadError::Io(std::io::Error::other(format!(
                        "Chunk {} overflow: expected {} bytes, received extra",
                        range.index, expected_len
                    ))));
                }
                file.write_all(&bytes).await?;
                chunk_written += len;
                let cur_total = shared_dl.fetch_add(len, Ordering::Relaxed) + len;

                if let Some(ref tx) = p_tx {
                    let elapsed = start_time.elapsed().as_secs_f64();
                    let speed = if elapsed > 0.0 {
                        (cur_total as f64 / elapsed) as u64
                    } else {
                        0
                    };
                    let _ = tx
                        .send(DownloadProgress {
                            task_id: tid.clone(),
                            downloaded_bytes: cur_total,
                            total_bytes: Some(total_size),
                            speed_bytes_per_sec: speed,
                        })
                        .await;
                }
            }

            file.flush().await?;

            if chunk_written != expected_len {
                return Err(DownloadError::Io(std::io::Error::other(format!(
                    "Chunk {} length mismatch: wrote {}, expected {}",
                    range.index, chunk_written, expected_len
                ))));
            }

            Ok::<(), DownloadError>(())
        });
    }

    // 3. Await all chunks
    while let Some(res) = join_set.join_next().await {
        match res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                join_set.abort_all();
                return Err(e);
            }
            Err(e) => {
                join_set.abort_all();
                return Err(DownloadError::Io(std::io::Error::other(e.to_string())));
            }
        }
    }

    // 4. Validate complete file SHA-1
    let mut file = tokio::fs::File::open(temp_dest).await?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_range_calculation() {
        let total_size: u64 = 10 * 1024 * 1024; // 10 MiB
        let num_chunks = (total_size.div_ceil(DEFAULT_CHUNK_SIZE) as usize)
            .clamp(2, MAX_CONCURRENT_CHUNKS);
        assert_eq!(num_chunks, 5);

        let chunk_span = total_size.div_ceil(num_chunks as u64);
        assert_eq!(chunk_span, 2 * 1024 * 1024);

        let mut covered = 0;
        for i in 0..num_chunks {
            let start = i as u64 * chunk_span;
            let end = ((i as u64 + 1) * chunk_span - 1).min(total_size - 1);
            assert_eq!(start, covered);
            covered = end + 1;
        }
        assert_eq!(covered, total_size);
    }

    #[test]
    fn test_small_chunk_clamping() {
        let total_size: u64 = 5 * 1024 * 1024; // 5 MiB
        let num_chunks = (total_size.div_ceil(DEFAULT_CHUNK_SIZE) as usize)
            .clamp(2, MAX_CONCURRENT_CHUNKS);
        assert_eq!(num_chunks, 3);
    }

    #[tokio::test]
    async fn test_range_not_supported_fallback_detection() {
        // Spin up a mock HTTP server that returns 200 OK instead of 206 Partial Content
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    use tokio::io::AsyncReadExt;
                    let mut buf = [0u8; 1024];
                    let _ = socket.read(&mut buf).await;
                    let response = "HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n0123456789";
                    use tokio::io::AsyncWriteExt;
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });

        let client = reqwest::Client::new();
        let test_nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_file = std::env::temp_dir().join(format!("fc_chunk_test_{}_{}", std::process::id(), test_nonce));
        let url = format!("http://{}/file.bin", addr);

        let res = download_file_chunked(
            &client,
            &url,
            &temp_file,
            10,
            Duration::from_secs(2),
            None,
            None,
            "test_task",
        ).await;

        assert!(matches!(res, Err(DownloadError::RangeNotSupported { .. })));
        let _ = tokio::fs::remove_file(temp_file).await;
    }

    #[tokio::test]
    async fn test_range_206_assembly_and_sha1() {
        // Spin up a mock HTTP server that honors Range headers with 206 Partial Content
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let payload_data: Vec<u8> = (0..30).map(|i| i % 26 + b'a').collect();
        let payload_clone = payload_data.clone();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let data = payload_clone.clone();
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 1024];
                    if let Ok(n) = socket.read(&mut buf).await {
                        let req = String::from_utf8_lossy(&buf[..n]);
                        if let Some(pos) = req.find("bytes=") {
                            let sub = &req[pos + 6..];
                            let end_line = sub.find("\r\n").unwrap_or(sub.len());
                            let r_str = &sub[..end_line];
                            if let Some((s_str, e_str)) = r_str.split_once('-') {
                                let start: usize = s_str.trim().parse().unwrap_or(0);
                                let end: usize = e_str.trim().parse().unwrap_or(data.len() - 1);
                                if start < data.len() && end < data.len() && start <= end {
                                    let slice = &data[start..=end];
                                    let resp = format!(
                                        "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\n\r\n",
                                        start, end, data.len(), slice.len()
                                    );
                                    let _ = socket.write_all(resp.as_bytes()).await;
                                    let _ = socket.write_all(slice).await;
                                }
                            }
                        }
                        // Default fallback
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                            data.len()
                        );
                        let _ = socket.write_all(resp.as_bytes()).await;
                        let _ = socket.write_all(&data).await;
                    }
                });
            }
        });

        let mut hasher = Sha1::new();
        hasher.update(&payload_data);
        let expected_sha1 = format!("{:x}", hasher.finalize());

        let client = reqwest::Client::new();
        let test_nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_file = std::env::temp_dir().join(format!("fc_206_test_{}_{}", std::process::id(), test_nonce));
        let url = format!("http://{}/file.bin", addr);

        let res = download_file_chunked(
            &client,
            &url,
            &temp_file,
            30,
            Duration::from_secs(2),
            Some(&expected_sha1),
            None,
            "test_206_task",
        ).await;

        assert!(res.is_ok(), "206 chunked download should succeed: {:?}", res);
        let written = tokio::fs::read(&temp_file).await.unwrap();
        assert_eq!(written, payload_data);
        let _ = tokio::fs::remove_file(temp_file).await;
    }

    #[tokio::test]
    async fn test_range_sha1_mismatch_failure() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let payload_data: Vec<u8> = b"0123456789abcdefghijklmnopqrstuvwxyz".to_vec();
        let payload_clone = payload_data.clone();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let data = payload_clone.clone();
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 1024];
                    if let Ok(n) = socket.read(&mut buf).await {
                        let req = String::from_utf8_lossy(&buf[..n]);
                        if let Some(pos) = req.find("bytes=") {
                            let sub = &req[pos + 6..];
                            let end_line = sub.find("\r\n").unwrap_or(sub.len());
                            let r_str = &sub[..end_line];
                            if let Some((s_str, e_str)) = r_str.split_once('-') {
                                let start: usize = s_str.trim().parse().unwrap_or(0);
                                let end: usize = e_str.trim().parse().unwrap_or(data.len() - 1);
                                if start < data.len() && end < data.len() && start <= end {
                                    let slice = &data[start..=end];
                                    let resp = format!(
                                        "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\n\r\n",
                                        start, end, data.len(), slice.len()
                                    );
                                    let _ = socket.write_all(resp.as_bytes()).await;
                                    let _ = socket.write_all(slice).await;
                                }
                            }
                        }
                    }
                });
            }
        });

        let client = reqwest::Client::new();
        let test_nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_file = std::env::temp_dir().join(format!("fc_sha_err_{}_{}", std::process::id(), test_nonce));
        let url = format!("http://{}/file.bin", addr);

        let res = download_file_chunked(
            &client,
            &url,
            &temp_file,
            payload_data.len() as u64,
            Duration::from_secs(2),
            Some("0000000000000000000000000000000000000000"), // Deliberately wrong sha1
            None,
            "test_sha_err",
        ).await;

        assert!(matches!(res, Err(DownloadError::ValidationFailed { .. })));
        let _ = tokio::fs::remove_file(temp_file).await;
    }

    #[tokio::test]
    async fn test_range_chunk_overflow_rejection() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 1024];
                    let _ = socket.read(&mut buf).await;
                    // Maliciously return more bytes than range
                    let resp = "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-4/10\r\nContent-Length: 50\r\n\r\n01234567890123456789012345678901234567890123456789";
                    let _ = socket.write_all(resp.as_bytes()).await;
                });
            }
        });

        let client = reqwest::Client::new();
        let test_nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_file = std::env::temp_dir().join(format!("fc_overflow_{}_{}", std::process::id(), test_nonce));
        let url = format!("http://{}/file.bin", addr);

        let res = download_file_chunked(
            &client,
            &url,
            &temp_file,
            10,
            Duration::from_secs(2),
            None,
            None,
            "test_overflow",
        ).await;

        assert!(res.is_err(), "Overflow chunk must fail");
        let _ = tokio::fs::remove_file(temp_file).await;
    }
}
