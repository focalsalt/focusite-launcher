//! LAN world announcement and WebRTC tunnel commands (manual offer/answer signaling).

use focusite_p2p::{LanWatcher, P2pHandshakeResult, P2pRole, P2pSessionInfo, P2pSessionRegistry, StunTurnConfig, TurnServerEntry};
use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

static P2P_REGISTRY: LazyLock<P2pSessionRegistry> = LazyLock::new(P2pSessionRegistry::new);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2pSessionDto {
    pub session_id: String,
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
        .map_err(super::ctx("建立 P2P 房間失敗"))
}

#[tauri::command]
pub async fn stop_p2p_session(session_id: String) -> Result<(), String> {
    P2P_REGISTRY
        .stop_session(&session_id)
        .await
        .map_err(super::ctx("關閉 P2P 房間失敗"))
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
        .map_err(super::ctx("P2P 握手驗證失敗"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelCodeDto {
    pub session: P2pSessionDto,
    /// Offer code (host) or answer code (guest) to hand to the friend.
    pub code: String,
}

/// Public STUN servers, plus the TURN relays the Worker issued (if any) for peers that cannot connect directly.
fn ice_config(turn: Option<Vec<TurnServerEntry>>) -> StunTurnConfig {
    StunTurnConfig { turn_servers: turn.unwrap_or_default(), ..StunTurnConfig::default() }
}

#[tauri::command]
pub async fn p2p_create_offer(
    instance_id: Option<String>,
    game_port: u16,
    alias: String,
    turn: Option<Vec<TurnServerEntry>>,
) -> Result<TunnelCodeDto, String> {
    let (info, code) = P2P_REGISTRY
        .create_tunnel_offer(instance_id, game_port, alias, &ice_config(turn))
        .await
        .map_err(super::ctx("建立邀請碼失敗"))?;
    Ok(TunnelCodeDto { session: info.into(), code })
}

#[tauri::command]
pub async fn p2p_apply_answer(session_id: String, answer_code: String) -> Result<P2pSessionDto, String> {
    P2P_REGISTRY
        .apply_tunnel_answer(&session_id, &answer_code)
        .await
        .map(P2pSessionDto::from)
        .map_err(super::ctx("套用回應碼失敗"))
}

#[tauri::command]
pub async fn p2p_join_with_offer(
    offer_code: String,
    local_port: Option<u16>,
    turn: Option<Vec<TurnServerEntry>>,
) -> Result<TunnelCodeDto, String> {
    let (info, code) = P2P_REGISTRY
        .join_tunnel(&offer_code, local_port.unwrap_or(0), &ice_config(turn))
        .await
        .map_err(super::ctx("加入失敗"))?;
    Ok(TunnelCodeDto { session: info.into(), code })
}

/// Sets the files the peer of this session may fetch. Each entry is sha1 hex -> local path; nothing else is served.
#[tauri::command]
pub async fn p2p_serve_file(session_id: String, files: std::collections::HashMap<String, String>) -> Result<(), String> {
    let whitelist = files.into_iter().map(|(sha1, path)| (sha1, path.into())).collect();
    P2P_REGISTRY
        .serve_files(&session_id, whitelist)
        .await
        .map_err(super::ctx("設定共享檔案失敗"))
}

/// Downloads a file from the session's peer into `dest`, verified against `sha1` and `size`.
#[tauri::command]
pub async fn p2p_fetch_file(session_id: String, sha1: String, size: u64, dest: String) -> Result<(), String> {
    // The peer chose both values: a bad hash would end up in a file name, a huge size would fill the disk.
    if sha1.len() != 40 || !sha1.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid file hash".into());
    }
    if size == 0 || size > super::share::MAX_CUSTOM_JAR_BYTES {
        return Err("the file is too large to receive".into());
    }
    P2P_REGISTRY
        .fetch_file(&session_id, &sha1, size, std::path::Path::new(&dest))
        .await
        .map_err(super::ctx("下載檔案失敗"))
}

/// The running LAN world listener; at most one.
static LAN_WATCHER: Mutex<Option<LanWatcher>> = Mutex::new(None);

/// Starts reporting the local game's LAN world: emits `lan-world` with its port, or null when it closes.
#[tauri::command]
pub async fn lan_world_watch_start(app: AppHandle) -> Result<(), String> {
    if LAN_WATCHER.lock().map_err(|e| e.to_string())?.is_some() {
        return Ok(());
    }
    let (watcher, mut rx) = LanWatcher::start().map_err(super::ctx("無法監聽區網世界"))?;
    *LAN_WATCHER.lock().map_err(|e| e.to_string())? = Some(watcher);
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("lan-world", *rx.borrow());
        while rx.changed().await.is_ok() {
            let _ = app.emit("lan-world", *rx.borrow());
        }
    });
    Ok(())
}

#[tauri::command]
pub fn lan_world_watch_stop() {
    if let Ok(mut guard) = LAN_WATCHER.lock() {
        *guard = None;
    }
}

const FIREWALL_RULE: &str = "Focusite Launcher P2P";

/// Runs a hidden console command and returns (success, stdout).
#[cfg(windows)]
fn run_hidden(program: &str, args: &[&str]) -> std::io::Result<(bool, String)> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new(program).args(args).creation_flags(CREATE_NO_WINDOW).output()?;
    Ok((out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned()))
}

/// True when an inbound allow rule for this exact executable exists (always true off Windows).
#[tauri::command]
pub async fn p2p_firewall_status() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().to_lowercase();
        let rule = format!("name={FIREWALL_RULE}");
        let result = tokio::task::spawn_blocking(move || {
            run_hidden("netsh", &["advfirewall", "firewall", "show", "rule", &rule, "verbose"])
        })
        .await
        .map_err(|e| e.to_string())?;
        // netsh exits non-zero when no rule matches.
        Ok(matches!(result, Ok((true, out)) if out.to_lowercase().contains(&exe)))
    }
    #[cfg(not(windows))]
    Ok(true)
}

/// Adds the inbound allow rule for this executable. Windows shows one UAC prompt; declining returns an error.
#[tauri::command]
pub async fn p2p_firewall_setup() -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
        let netsh = format!(
            "/c netsh advfirewall firewall delete rule name=\"{FIREWALL_RULE}\" & netsh advfirewall firewall add rule name=\"{FIREWALL_RULE}\" dir=in action=allow program=\"{exe}\" protocol=UDP enable=yes profile=private,domain"
        );
        let script = format!(
            "Start-Process -FilePath cmd.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '{}'",
            netsh.replace('\'', "''")
        );
        let (ok, _) = tokio::task::spawn_blocking(move || run_hidden("powershell", &["-NoProfile", "-Command", &script]))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        if !ok {
            return Err("未取得系統管理員授權，防火牆規則沒有建立".into());
        }
        if p2p_firewall_status().await? {
            Ok(())
        } else {
            Err("防火牆規則沒有建立成功".into())
        }
    }
    #[cfg(not(windows))]
    Ok(())
}
