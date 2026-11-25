//! Java Edition friends list, requests and presence, through the same Minecraft Services API the game uses.
//! Which friends also run this launcher comes from our signaling Worker (`/launcher/*`).

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::Mutex;

use focusite_auth::friends::{self, Friend, FriendAction, FriendData, FriendsError, PresenceStatus, UpdateType};
use focusite_auth::keyring_store::CredentialStore;
use focusite_p2p::TurnServerEntry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendDto {
    pub profile_id: String,
    pub name: String,
    pub status: PresenceStatus,
    pub on_launcher: bool,
}

/// A party invite waiting for us in the Worker's inbox. The sender is not checked there: the caller keeps
/// only invites from people on the friends list.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyInviteDto {
    pub from: String,
    pub from_name: String,
    pub party: String,
    pub expires: u64,
}

#[derive(Debug, Serialize)]
pub struct FriendsListDto {
    pub friends: Vec<FriendDto>,
    pub incoming: Vec<Friend>,
    pub outgoing: Vec<Friend>,
    pub invites: Vec<PartyInviteDto>,
}

/// What the browser side needs to open a party connection; the Worker checks it against its stored hash.
#[derive(Debug, Serialize)]
pub struct PartyCredentials {
    pub uuid: String,
    pub secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherConfig {
    /// HTTPS origin of the signaling Worker.
    pub server: String,
    /// Java name of the signed-in account; the session server checks it together with the profile id.
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendActionDto {
    /// `add` sends a request (by name) or accepts one (by id); `remove` removes, declines or cancels (by id).
    pub kind: String,
    pub name: Option<String>,
    pub profile_id: Option<String>,
}

/// Secret the Worker issued per account after the session-server check; lost on restart, then we log in again.
static LAUNCHER_SECRETS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn secret_for(account_id: &str) -> Option<String> {
    LAUNCHER_SECRETS.lock().unwrap_or_else(|e| e.into_inner()).as_ref()?.get(account_id).cloned()
}

fn set_secret(account_id: &str, secret: Option<String>) {
    let mut guard = LAUNCHER_SECRETS.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    match secret {
        Some(s) => map.insert(account_id.to_string(), s),
        None => map.remove(account_id),
    };
}

fn message(e: FriendsError) -> String {
    match e {
        FriendsError::Unauthorized => "登入已失效，請重新登入".into(),
        FriendsError::BadRequest => "找不到這位玩家".into(),
        FriendsError::Forbidden => "對方未開啟好友請求，或此帳號沒有有效的 Minecraft 檔案".into(),
        FriendsError::Failed(m) => m,
    }
}

fn credentials(account_id: &str) -> Result<(String, String), String> {
    let (mc, refresh) = CredentialStore::get_credentials(account_id)
        .map_err(|e| format!("讀取憑證失敗: {}", e))?
        .ok_or("此帳號沒有登入憑證，請重新登入")?;
    Ok((mc, refresh.ok_or("此帳號沒有 refresh token，請重新登入")?))
}

/// Runs `op` with the stored Minecraft token; when it was rejected, refreshes it and runs `op` once more.
async fn with_token<T, F, Fut>(account_id: &str, op: F) -> Result<T, String>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, FriendsError>>,
{
    let (mc, refresh) = credentials(account_id)?;
    match op(mc.clone()).await {
        Err(FriendsError::Unauthorized) => {
            super::auth::silent_refresh(super::http(), account_id, &mc, &refresh).await?;
            let (mc, _) = credentials(account_id)?;
            op(mc).await.map_err(message)
        }
        other => other.map_err(message),
    }
}

/// Posts our own status first when sharing: it is the only way the service returns friends' presence.
async fn load(
    client: &reqwest::Client,
    token: &str,
    share: bool,
) -> Result<(FriendData, HashMap<String, PresenceStatus>), FriendsError> {
    let presence = if share {
        friends::post_presence(client, token, PresenceStatus::Online).await?
    } else {
        HashMap::new()
    };
    Ok((friends::fetch_friends(client, token).await?, presence))
}

fn undashed(id: &str) -> String {
    id.replace('-', "").to_lowercase()
}

async fn worker_json(
    client: &reqwest::Client,
    server: &str,
    path: &str,
    body: serde_json::Value,
) -> Result<(u16, serde_json::Value), String> {
    let resp = client
        .post(format!("{server}{path}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let code = resp.status().as_u16();
    Ok((code, resp.json().await.unwrap_or(serde_json::Value::Null)))
}

/// Logs in to the Worker; returns the Worker's secret. When the Worker verifies logins, we first join its challenge
/// at the Mojang session server with our own token, which is what proves the profile belongs to us.
async fn launcher_login(
    client: &reqwest::Client,
    cfg: &LauncherConfig,
    _mc: &str,
    uuid: &str,
) -> Result<String, String> {
    let (code, body) = worker_json(client, &cfg.server, "/launcher/challenge", serde_json::json!({})).await?;
    let server_id = body["serverId"].as_str().filter(|_| code == 200).ok_or("啟動器伺服器拒絕了挑戰請求")?;
    if body["verify"].as_bool() == Some(true) {
        // with_token reads the stored token itself and refreshes it once when Mojang rejects it.
        with_token(uuid, |token| async move { friends::session_join(client, &token, uuid, server_id).await }).await?;
    }
    let (code, body) = worker_json(
        client,
        &cfg.server,
        "/launcher/login",
        serde_json::json!({ "uuid": uuid, "name": cfg.name, "serverId": server_id }),
    )
    .await?;
    body["secret"]
        .as_str()
        .filter(|_| code == 200)
        .map(str::to_string)
        .ok_or_else(|| format!("啟動器伺服器登入失敗（HTTP {code}：{}）", body["error"].as_str().unwrap_or("")))
}

/// The Worker secret for this account; logs in (through the session server) when we have none or `fresh` is set.
async fn ensure_secret(
    client: &reqwest::Client,
    cfg: &LauncherConfig,
    mc: &str,
    uuid: &str,
    fresh: bool,
) -> Result<String, String> {
    if let Some(s) = secret_for(uuid).filter(|_| !fresh) {
        return Ok(s);
    }
    let s = launcher_login(client, cfg, mc, uuid).await?;
    set_secret(uuid, Some(s.clone()));
    Ok(s)
}

/// Registers us as a launcher user; returns which of `ids` (undashed) are online in the launcher too,
/// and the party invites that were waiting for us.
async fn launcher_sync(
    client: &reqwest::Client,
    cfg: &LauncherConfig,
    mc: &str,
    uuid: &str,
    ids: &[String],
) -> Result<(HashSet<String>, Vec<PartyInviteDto>), String> {
    for attempt in 0..2 {
        let secret = ensure_secret(client, cfg, mc, uuid, attempt > 0).await?;
        let (code, body) = worker_json(
            client,
            &cfg.server,
            "/launcher/sync",
            serde_json::json!({ "uuid": uuid, "secret": secret, "uuids": ids }),
        )
        .await?;
        match code {
            200 => {
                let online = body["online"].as_array().map(Vec::as_slice).unwrap_or(&[]);
                let invites = serde_json::from_value(body["invites"].clone()).unwrap_or_default();
                return Ok((online.iter().filter_map(|v| v.as_str()).map(str::to_string).collect(), invites));
            }
            401 => set_secret(uuid, None),
            _ => return Err(format!("啟動器伺服器同步失敗（HTTP {code}）")),
        }
    }
    Err("啟動器伺服器登入狀態無法建立".into())
}

/// Keeps invites sent by people we are friends with; the Worker cannot tell who is a friend.
fn only_from(invites: Vec<PartyInviteDto>, friend_ids: &[String]) -> Vec<PartyInviteDto> {
    invites.into_iter().filter(|i| friend_ids.contains(&i.from)).collect()
}

/// Collects waiting party invites without touching the Minecraft friends API (cheap enough to run often).
#[tauri::command]
pub async fn party_poll(
    account_id: String,
    launcher: LauncherConfig,
    friend_ids: Vec<String>,
) -> Result<Vec<PartyInviteDto>, String> {
    let client = super::http();
    let (mc, _) = credentials(&account_id)?;
    let ids: Vec<String> = friend_ids.iter().map(|id| undashed(id)).collect();
    let (_, invites) = launcher_sync(client, &launcher, &mc, &account_id, &[]).await?;
    Ok(only_from(invites, &ids))
}

/// Credentials for opening a party connection. `fresh` forces a new login after the Worker rejected the old secret.
#[tauri::command]
pub async fn party_credentials(account_id: String, launcher: LauncherConfig, fresh: bool) -> Result<PartyCredentials, String> {
    let client = super::http();
    let (mc, _) = credentials(&account_id)?;
    let secret = ensure_secret(client, &launcher, &mc, &account_id, fresh).await?;
    Ok(PartyCredentials { uuid: account_id, secret })
}

/// TURN relays for tunnels that cannot connect directly. Empty when the Worker has none configured (STUN only).
#[tauri::command]
pub async fn party_ice_servers(account_id: String, launcher: LauncherConfig) -> Result<Vec<TurnServerEntry>, String> {
    let client = super::http();
    let (mc, _) = credentials(&account_id)?;
    for attempt in 0..2 {
        let secret = ensure_secret(client, &launcher, &mc, &account_id, attempt > 0).await?;
        let (code, body) = worker_json(
            client,
            &launcher.server,
            "/launcher/turn",
            serde_json::json!({ "uuid": account_id, "secret": secret }),
        )
        .await?;
        match code {
            200 => return Ok(turn_entries(&body["iceServers"])),
            401 => set_secret(&account_id, None),
            _ => return Ok(Vec::new()),
        }
    }
    Ok(Vec::new())
}

/// Cloudflare lists `{urls, username, credential}` per server; only the `turn:`/`turns:` URLs are relays.
fn turn_entries(ice_servers: &serde_json::Value) -> Vec<TurnServerEntry> {
    let mut entries = Vec::new();
    for server in ice_servers.as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let urls: Vec<&str> = match &server["urls"] {
            serde_json::Value::String(u) => vec![u.as_str()],
            serde_json::Value::Array(list) => list.iter().filter_map(|u| u.as_str()).collect(),
            _ => Vec::new(),
        };
        for url in urls.into_iter().filter(|u| u.starts_with("turn:") || u.starts_with("turns:")) {
            entries.push(TurnServerEntry {
                url: url.to_string(),
                username: server["username"].as_str().map(str::to_string),
                credential: server["credential"].as_str().map(str::to_string),
            });
        }
    }
    entries
}

#[tauri::command]
pub async fn friends_list(
    account_id: String,
    share_presence: bool,
    launcher: Option<LauncherConfig>,
) -> Result<FriendsListDto, String> {
    let client = super::http();
    let (data, presence) = with_token(&account_id, |mc| async move { load(client, &mc, share_presence).await }).await?;

    // Which friends run this launcher is a bonus: a Worker failure never hides the friends list.
    let mut on_launcher = HashSet::new();
    let mut invites = Vec::new();
    if let (true, Some(cfg)) = (share_presence, launcher) {
        let ids: Vec<String> = data.friends.iter().map(|f| undashed(&f.profile_id)).collect();
        let synced = match credentials(&account_id) {
            Ok((mc, _)) => launcher_sync(client, &cfg, &mc, &account_id, &ids).await,
            Err(e) => Err(e),
        };
        match synced {
            Ok((set, pending)) => {
                on_launcher = set;
                invites = only_from(pending, &ids);
            }
            Err(e) => tracing::warn!("啟動器在線登記失敗：{}", e),
        }
    }

    Ok(FriendsListDto {
        friends: data
            .friends
            .into_iter()
            .map(|f| FriendDto {
                status: presence.get(&f.profile_id).copied().unwrap_or(PresenceStatus::Offline),
                on_launcher: on_launcher.contains(&undashed(&f.profile_id)),
                profile_id: f.profile_id,
                name: f.name,
            })
            .collect(),
        incoming: data.incoming,
        outgoing: data.outgoing,
        invites,
    })
}

#[tauri::command]
pub async fn friends_act(account_id: String, action: FriendActionDto) -> Result<FriendData, String> {
    let update_type = match action.kind.as_str() {
        "add" => UpdateType::Add,
        "remove" => UpdateType::Remove,
        other => return Err(format!("未知的好友動作：{other}")),
    };
    let name = action.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    if name.is_none() && action.profile_id.is_none() {
        return Err("請輸入玩家名稱".into());
    }
    let action = FriendAction { name, profile_id: action.profile_id, update_type };
    let client = super::http();
    with_token(&account_id, |mc| {
        let action = action.clone();
        async move { friends::put_friend_action(client, &mc, &action).await }
    })
    .await
}
