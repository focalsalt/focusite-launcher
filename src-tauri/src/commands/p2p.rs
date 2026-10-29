//! P2P multiplayer commands for user-space WebRTC tunnel.

use focusite_p2p::{P2pHandshakeResult, P2pRole, P2pSessionInfo, P2pSessionRegistry};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

static P2P_REGISTRY: LazyLock<P2pSessionRegistry> = LazyLock::new(P2pSessionRegistry::new);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pSessionDto {
    pub session_id: String,
    pub room_code: String,
    pub role: String, // "host" or "client"
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

impl From<P2pSessionInfo> for P2pSessionDto {
    fn from(info: P2pSessionInfo) -> Self {
        Self {
            session_id: info.session_id,
            room_code: info.room_code,
            role: match info.role {
                P2pRole::Host => "host".to_string(),
                P2pRole::Client => "client".to_string(),
            },
            alias: info.alias,
            instance_id: info.instance_id,
            local_port: info.local_port,
            target_port: info.target_port,
            status: info.status,
            latency_ms: info.latency_ms,
            bytes_sent: info.bytes_sent,
            bytes_received: info.bytes_received,
            created_at: info.created_at,
        }
    }
}

#[tauri::command]
pub async fn start_p2p_host(
    instance_id: String,
    host_port: u16,
    alias: String,
) -> Result<P2pSessionDto, String> {
    P2P_REGISTRY
        .start_host(instance_id, host_port, alias)
        .await
        .map(P2pSessionDto::from)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn join_p2p_room(
    room_code: String,
    alias: String,
) -> Result<P2pSessionDto, String> {
    P2P_REGISTRY
        .join_room(room_code, alias, None)
        .await
        .map(P2pSessionDto::from)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_p2p_session(session_id: String) -> Result<(), String> {
    P2P_REGISTRY
        .stop_session(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_p2p_sessions() -> Result<Vec<P2pSessionDto>, String> {
    let list = P2P_REGISTRY.list_sessions().await;
    Ok(list.into_iter().map(P2pSessionDto::from).collect())
}

#[tauri::command]
pub async fn p2p_verify_handshake(session_id: String) -> Result<P2pHandshakeResult, String> {
    P2P_REGISTRY
        .verify_handshake(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn p2p_update_session_alias(
    session_id: String,
    new_alias: String,
) -> Result<P2pSessionDto, String> {
    P2P_REGISTRY
        .update_alias(&session_id, &new_alias)
        .await
        .map(P2pSessionDto::from)
        .map_err(|e| e.to_string())
}
