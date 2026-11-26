//! Multi-session P2P virtual tunnel registry and lifecycle management.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tracing::info;
use crate::lan_broadcast::LanBroadcaster;
use crate::tunnel::Tunnel;
use crate::webrtc::StunTurnConfig;
use crate::P2pError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum P2pRole {
    Host,
    Client,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct P2pHandshakeResult {
    pub session_id: String,
    pub success: bool,
    pub latency_ms: u32,
    pub motd: String,
    pub server_version: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct P2pSessionInfo {
    pub session_id: String,
    pub role: P2pRole,
    pub alias: String,
    pub instance_id: Option<String>,
    pub local_port: u16,
    pub target_port: Option<u16>,
    pub status: String,
    pub latency_ms: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub created_at: i64,
}

pub struct P2pSessionHandle {
    pub info: P2pSessionInfo,
    pub broadcaster: Option<LanBroadcaster>,
    /// Present for WebRTC sessions; supplies the live status, latency and byte counters.
    pub tunnel: Option<Tunnel>,
}

impl P2pSessionHandle {
    fn snapshot(&self) -> P2pSessionInfo {
        let mut info = self.info.clone();
        if let Some(tunnel) = &self.tunnel {
            let stats = tunnel.stats();
            info.status = stats.status;
            info.latency_ms = stats.latency_ms;
            info.bytes_sent = stats.bytes_sent;
            info.bytes_received = stats.bytes_received;
        }
        info
    }
}

#[derive(Clone, Default)]
pub struct P2pSessionRegistry {
    sessions: Arc<RwLock<HashMap<String, P2pSessionHandle>>>,
}

impl P2pSessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Starts a P2P host session for an active instance.
    pub async fn start_host(
        &self,
        instance_id: String,
        host_port: u16,
        alias: String,
    ) -> Result<P2pSessionInfo, P2pError> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();

        let display_alias = if alias.trim().is_empty() {
            "Player".to_string()
        } else {
            alias.trim().to_string()
        };

        let motd = format!("[Focusite · {}] {}", display_alias, instance_id);
        let broadcaster = LanBroadcaster::start(motd, host_port).await.ok();

        let info = P2pSessionInfo {
            session_id: session_id.clone(),
            role: P2pRole::Host,
            alias: display_alias,
            instance_id: Some(instance_id),
            local_port: host_port,
            target_port: Some(host_port),
            status: "broadcasting".to_string(),
            latency_ms: 0,
            bytes_sent: 0,
            bytes_received: 0,
            created_at: now,
        };

        let handle = P2pSessionHandle {
            info: info.clone(),
            broadcaster,
            tunnel: None,
        };

        let mut lock = self.sessions.write().await;
        lock.insert(session_id, handle);

        info!("P2P Host session started on port {}", host_port);
        Ok(info)
    }

    /// Host: opens a WebRTC tunnel to the local game port and returns the offer code for a friend.
    pub async fn create_tunnel_offer(
        &self,
        instance_id: Option<String>,
        game_port: u16,
        alias: String,
        stun: &StunTurnConfig,
    ) -> Result<(P2pSessionInfo, String), P2pError> {
        let display_alias = clean_alias(&alias, "Player");
        let offer = Tunnel::create_host_offer(game_port, display_alias.clone(), stun).await?;
        let info = P2pSessionInfo {
            session_id: uuid::Uuid::new_v4().to_string(),
            role: P2pRole::Host,
            alias: display_alias,
            instance_id,
            local_port: game_port,
            target_port: Some(game_port),
            status: "connecting".to_string(),
            latency_ms: 0,
            bytes_sent: 0,
            bytes_received: 0,
            created_at: chrono::Utc::now().timestamp(),
        };
        let handle = P2pSessionHandle { info: info.clone(), broadcaster: None, tunnel: Some(offer.tunnel) };
        self.sessions.write().await.insert(info.session_id.clone(), handle);
        Ok((info, offer.offer_code))
    }

    /// Host: applies the friend's answer code.
    pub async fn apply_tunnel_answer(
        &self,
        session_id: &str,
        answer_code: &str,
    ) -> Result<P2pSessionInfo, P2pError> {
        let lock = self.sessions.read().await;
        let handle = lock
            .get(session_id)
            .ok_or_else(|| P2pError::SignalingFailed(format!("E_ROOM_SESSION_NOT_FOUND: {}", session_id)))?;
        let tunnel = handle
            .tunnel
            .as_ref()
            .ok_or_else(|| P2pError::SignalingFailed("E_ROOM_NOT_WEBRTC".into()))?;
        tunnel.apply_answer(answer_code).await?;
        Ok(handle.snapshot())
    }

    /// Guest: takes the host's offer code, listens on a loopback port and announces it as a LAN world.
    pub async fn join_tunnel(
        &self,
        offer_code: &str,
        local_port: u16,
        stun: &StunTurnConfig,
    ) -> Result<(P2pSessionInfo, String), P2pError> {
        let guest = Tunnel::accept_offer(offer_code, local_port, stun).await?;
        let tunnel = guest.tunnel;
        let port = tunnel.local_port.unwrap_or(local_port);
        let host_alias = clean_alias(tunnel.peer_alias.as_deref().unwrap_or(""), "Host");

        let motd = format!("[Focusite · {}]", host_alias);
        let broadcaster = LanBroadcaster::start(motd, port).await.ok();

        let info = P2pSessionInfo {
            session_id: uuid::Uuid::new_v4().to_string(),
            role: P2pRole::Client,
            alias: host_alias,
            instance_id: None,
            local_port: port,
            target_port: tunnel.peer_game_port,
            status: "connecting".to_string(),
            latency_ms: 0,
            bytes_sent: 0,
            bytes_received: 0,
            created_at: chrono::Utc::now().timestamp(),
        };
        let handle = P2pSessionHandle { info: info.clone(), broadcaster, tunnel: Some(tunnel) };
        self.sessions.write().await.insert(info.session_id.clone(), handle);
        Ok((info, guest.answer_code))
    }

    /// Sets the files this session's peer may fetch (sha1 hex -> path).
    pub async fn serve_files(&self, session_id: &str, whitelist: HashMap<String, std::path::PathBuf>) -> Result<(), P2pError> {
        let lock = self.sessions.read().await;
        lock.get(session_id)
            .and_then(|h| h.tunnel.as_ref())
            .ok_or_else(|| P2pError::SignalingFailed(format!("E_ROOM_SESSION_NOT_FOUND: {}", session_id)))?
            .serve_files(whitelist);
        Ok(())
    }

    /// Downloads a file from the session's peer; the registry lock is released before the transfer starts.
    pub async fn fetch_file(&self, session_id: &str, sha1: &str, size: u64, dest: &std::path::Path) -> Result<(), P2pError> {
        let fetcher = {
            let lock = self.sessions.read().await;
            lock.get(session_id)
                .and_then(|h| h.tunnel.as_ref())
                .ok_or_else(|| P2pError::SignalingFailed(format!("E_ROOM_SESSION_NOT_FOUND: {}", session_id)))?
                .fetcher()
        };
        fetcher.fetch(sha1, size, dest).await
    }

    /// Stops and removes an active session.
    pub async fn stop_session(&self, session_id: &str) -> Result<(), P2pError> {
        let handle_opt = self.sessions.write().await.remove(session_id);
        if let Some(mut handle) = handle_opt {
            if let Some(mut broadcaster) = handle.broadcaster.take() {
                broadcaster.stop().await;
            }
            if let Some(mut tunnel) = handle.tunnel.take() {
                tunnel.close().await;
            }
            info!("P2P Session {} stopped", session_id);
        }
        Ok(())
    }

    /// Lists all active sessions with live tunnel numbers. Dead tunnels are removed first.
    pub async fn list_sessions(&self) -> Vec<P2pSessionInfo> {
        self.reap_dead().await;
        self.sessions.read().await.values().map(|h| h.snapshot()).collect()
    }

    /// Stops tunnels that failed, closed, or never connected, so their LAN announcement,
    /// listener and ping task do not linger.
    async fn reap_dead(&self) {
        let now = chrono::Utc::now().timestamp();
        let dead: Vec<String> = self
            .sessions
            .read()
            .await
            .iter()
            .filter(|(_, h)| {
                h.tunnel.is_some() && is_dead(&h.snapshot().status, now - h.info.created_at)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in dead {
            let _ = self.stop_session(&id).await;
        }
    }

    /// Retrieves an active session by ID.
    pub async fn get_session(&self, session_id: &str) -> Option<P2pSessionInfo> {
        self.sessions.read().await.get(session_id).map(|h| h.snapshot())
    }

    /// Verifies Minecraft status handshake against the session's local port and measures latency.
    pub async fn verify_handshake(
        &self,
        session_id: &str,
    ) -> Result<P2pHandshakeResult, P2pError> {
        let local_port = {
            let lock = self.sessions.read().await;
            let handle = lock
                .get(session_id)
                .ok_or_else(|| P2pError::SignalingFailed(format!("E_ROOM_SESSION_NOT_FOUND: {}", session_id)))?;
            handle.info.local_port
        };

        let start = std::time::Instant::now();
        let target_addr = format!("127.0.0.1:{}", local_port);

        let connect_fut = TcpStream::connect(&target_addr);
        let mut stream = match tokio::time::timeout(std::time::Duration::from_secs(2), connect_fut).await {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => {
                return Ok(P2pHandshakeResult {
                    session_id: session_id.to_string(),
                    success: false,
                    latency_ms: 0,
                    motd: format!("E_PING_CONNECT_FAILED: {}: {}", target_addr, e),
                    server_version: String::new(),
                });
            }
            Err(_) => {
                return Ok(P2pHandshakeResult {
                    session_id: session_id.to_string(),
                    success: false,
                    latency_ms: 0,
                    motd: format!("E_PING_CONNECT_TIMEOUT: {}", target_addr),
                    server_version: String::new(),
                });
            }
        };

        let handshake_pkt = crate::mc_protocol::create_handshake_packet(765, "127.0.0.1", local_port, 1);
        let status_req_pkt = crate::mc_protocol::create_status_request_packet();

        if let Err(e) = stream.write_all(&handshake_pkt).await {
            return Ok(P2pHandshakeResult {
                session_id: session_id.to_string(),
                success: false,
                latency_ms: 0,
                motd: format!("E_PING_SEND_FAILED: {}", e),
                server_version: String::new(),
            });
        }

        if let Err(e) = stream.write_all(&status_req_pkt).await {
            return Ok(P2pHandshakeResult {
                session_id: session_id.to_string(),
                success: false,
                latency_ms: 0,
                motd: format!("E_PING_SEND_FAILED: {}", e),
                server_version: String::new(),
            });
        }

        let mut buf = vec![0u8; 4096];
        let read_fut = stream.read(&mut buf);
        let n = match tokio::time::timeout(std::time::Duration::from_secs(2), read_fut).await {
            Ok(Ok(n)) if n > 0 => n,
            Ok(Ok(_)) => {
                return Ok(P2pHandshakeResult {
                    session_id: session_id.to_string(),
                    success: false,
                    latency_ms: 0,
                    motd: "E_PING_NO_DATA".to_string(),
                    server_version: String::new(),
                });
            }
            Ok(Err(e)) => {
                return Ok(P2pHandshakeResult {
                    session_id: session_id.to_string(),
                    success: false,
                    latency_ms: 0,
                    motd: format!("E_PING_READ_FAILED: {}", e),
                    server_version: String::new(),
                });
            }
            Err(_) => {
                return Ok(P2pHandshakeResult {
                    session_id: session_id.to_string(),
                    success: false,
                    latency_ms: 0,
                    motd: "E_PING_TIMEOUT".to_string(),
                    server_version: String::new(),
                });
            }
        };

        let latency_ms = start.elapsed().as_millis().max(1) as u32;

        match crate::mc_protocol::parse_status_response_packet(&buf[..n]) {
            Ok(resp) => {
                let mut lock = self.sessions.write().await;
                if let Some(handle) = lock.get_mut(session_id) {
                    handle.info.latency_ms = latency_ms;
                }

                Ok(P2pHandshakeResult {
                    session_id: session_id.to_string(),
                    success: true,
                    latency_ms,
                    motd: resp.description.text,
                    server_version: resp.version.name,
                })
            }
            Err(e) => Ok(P2pHandshakeResult {
                session_id: session_id.to_string(),
                success: false,
                latency_ms,
                motd: format!("E_PING_BAD_RESPONSE: {}", e),
                server_version: String::new(),
            }),
        }
    }
}

/// A tunnel is dead once it failed or closed, or when it has still not connected after the grace period.
fn is_dead(status: &str, age_secs: i64) -> bool {
    const SETUP_GRACE_SECS: i64 = 120;
    matches!(status, "failed" | "closed") || (status == "connecting" && age_secs > SETUP_GRACE_SECS)
}

fn clean_alias(alias: &str, fallback: &str) -> String {
    let trimmed = alias.trim();
    if trimmed.is_empty() { fallback.to_string() } else { trimmed.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_host_broadcast_lifecycle() {
        let registry = P2pSessionRegistry::new();
        let host = registry.start_host("my-instance".into(), 25565, "HostPlayer".into()).await.unwrap();
        assert_eq!(host.role, P2pRole::Host);
        assert_eq!(host.status, "broadcasting");
        assert_eq!(registry.list_sessions().await.len(), 1);
        registry.stop_session(&host.session_id).await.unwrap();
        assert!(registry.list_sessions().await.is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_tunnel_sessions_connect_and_report_live_stats() {
        let registry = P2pSessionRegistry::new();
        let no_stun = StunTurnConfig { stun_servers: Vec::new(), turn_servers: Vec::new() };

        let (host, offer) = registry
            .create_tunnel_offer(Some("inst".into()), 25565, "Host".into(), &no_stun)
            .await
            .unwrap();
        assert!(offer.starts_with("focusite://p2p/"));
        let (guest, answer) = registry.join_tunnel(&offer, 0, &no_stun).await.unwrap();
        assert_eq!(guest.role, P2pRole::Client);
        assert_eq!(guest.target_port, Some(25565));
        assert!(guest.local_port > 0);
        registry.apply_tunnel_answer(&host.session_id, &answer).await.unwrap();

        let mut status = String::new();
        for _ in 0..100 {
            status = registry.get_session(&host.session_id).await.unwrap().status;
            if status == "connected" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert_eq!(status, "connected");

        registry.stop_session(&guest.session_id).await.unwrap();
        registry.stop_session(&host.session_id).await.unwrap();
    }

    #[test]
    fn test_dead_tunnel_rules() {
        assert!(is_dead("failed", 0));
        assert!(is_dead("closed", 0));
        assert!(is_dead("connecting", 121));
        assert!(!is_dead("connecting", 60));
        assert!(!is_dead("connected", 10_000));
        assert!(!is_dead("disconnected", 10_000)); // may still recover
    }

    #[tokio::test]
    async fn test_apply_answer_to_unknown_session_fails() {
        let registry = P2pSessionRegistry::new();
        assert!(registry.apply_tunnel_answer("nope", "x").await.is_err());
    }
}
