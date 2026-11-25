//! Minecraft Services friends API, as the Java Edition 26.x client calls it (authlib `YggdrasilFriendsService`).
//! The friends list carries Java profile ids and names; presence is read by posting your own status.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

const SERVICES: &str = "https://api.minecraftservices.com";

#[derive(Debug, thiserror::Error)]
pub enum FriendsError {
    /// The Minecraft token was rejected; refresh it and retry once.
    #[error("Minecraft token rejected")]
    Unauthorized,
    /// 400: the name or profile does not exist.
    #[error("Player not found")]
    BadRequest,
    /// 403: no active profile, or the other player does not accept requests.
    #[error("Request refused (403)")]
    Forbidden,
    #[error("{0}")]
    Failed(String),
}

impl From<reqwest::Error> for FriendsError {
    fn from(e: reqwest::Error) -> Self {
        FriendsError::Failed(e.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresenceStatus {
    Online,
    PlayingOffline,
    PlayingRealms,
    PlayingServer,
    PlayingHostedServer,
    Offline,
    /// A status newer than this client knows; the person is still reachable.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub profile_id: String,
    pub name: String,
}

/// The whole friends list: friends plus pending requests in both directions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FriendData {
    #[serde(default)]
    pub friends: Vec<Friend>,
    #[serde(default, alias = "incomingRequests")]
    pub incoming: Vec<Friend>,
    #[serde(default, alias = "outgoingRequests")]
    pub outgoing: Vec<Friend>,
}

/// `PUT /friends` body: ADD by name sends a request, ADD by id accepts one; REMOVE by id removes, declines or cancels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendAction {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    pub update_type: UpdateType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpdateType {
    Add,
    Remove,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceResponse {
    #[serde(default)]
    presence: Vec<PresenceEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceEntry {
    profile_id: String,
    status: PresenceStatus,
}

pub fn parse_friends(body: &[u8]) -> Result<FriendData, FriendsError> {
    serde_json::from_slice::<FriendData>(body)
        .map_err(|e| FriendsError::Failed(format!("Unexpected friends response: {e}")))
}

pub fn parse_presence(body: &[u8]) -> Result<HashMap<String, PresenceStatus>, FriendsError> {
    serde_json::from_slice::<PresenceResponse>(body)
        .map(|r| r.presence.into_iter().map(|p| (p.profile_id, p.status)).collect())
        .map_err(|e| FriendsError::Failed(format!("Unexpected presence response: {e}")))
}

fn check(resp: reqwest::Response) -> Result<reqwest::Response, FriendsError> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    Err(match status.as_u16() {
        401 => FriendsError::Unauthorized,
        400 => FriendsError::BadRequest,
        403 => FriendsError::Forbidden,
        429 => {
            let wait = resp.headers().get("Retry-After").and_then(|v| v.to_str().ok()).unwrap_or("?");
            FriendsError::Failed(format!("Friends service is rate limiting; retry after {wait}s"))
        }
        code => FriendsError::Failed(format!("Friends service returned HTTP {code}")),
    })
}

// shortcut: no ETag / If-None-Match caching like the game does; add it if polling hits rate limits.
pub async fn fetch_friends(client: &reqwest::Client, mc_token: &str) -> Result<FriendData, FriendsError> {
    let resp = client.get(format!("{SERVICES}/friends")).bearer_auth(mc_token).send().await?;
    parse_friends(&check(resp)?.bytes().await?)
}

/// Applies one friend action and returns the updated lists. The game waits 10 seconds between actions.
pub async fn put_friend_action(
    client: &reqwest::Client,
    mc_token: &str,
    action: &FriendAction,
) -> Result<FriendData, FriendsError> {
    let resp = client.put(format!("{SERVICES}/friends")).bearer_auth(mc_token).json(action).send().await?;
    parse_friends(&check(resp)?.bytes().await?)
}

/// Proves to the session server that this client holds the account (`serverId` comes from a verifier such as our Worker).
pub async fn session_join(
    client: &reqwest::Client,
    mc_token: &str,
    profile_id: &str,
    server_id: &str,
) -> Result<(), FriendsError> {
    let resp = client
        .post("https://sessionserver.mojang.com/session/minecraft/join")
        .json(&serde_json::json!({
            "accessToken": mc_token,
            "selectedProfile": profile_id.replace('-', ""),
            "serverId": server_id,
        }))
        .send()
        .await?;
    check(resp).map(|_| ())
}

/// Posts this player's own status and returns the presence of every friend, keyed by profile id.
pub async fn post_presence(
    client: &reqwest::Client,
    mc_token: &str,
    status: PresenceStatus,
) -> Result<HashMap<String, PresenceStatus>, FriendsError> {
    let resp = client
        .post(format!("{SERVICES}/presence"))
        .bearer_auth(mc_token)
        .json(&serde_json::json!({ "status": status }))
        .send()
        .await?;
    parse_presence(&check(resp)?.bytes().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_friends_and_requests() {
        let body = br#"{"friends":[{"profileId":"069a79f4-44e9-4726-a5be-fca90e38aaf5","name":"Notch"}],
            "incomingRequests":[{"profileId":"x","name":"y"}],"outgoingRequests":[]}"#;
        let data = parse_friends(body).unwrap();
        assert_eq!(data.friends.len(), 1);
        assert_eq!(data.friends[0].name, "Notch");
        assert_eq!(data.incoming.len(), 1);
        assert!(data.outgoing.is_empty());
    }

    #[test]
    fn parses_presence_with_unknown_status() {
        let body = br#"{"presence":[
            {"profileId":"a","pmid":"b","status":"PLAYING_SERVER","lastUpdated":"2026-11-21T00:00:00Z"},
            {"profileId":"c","pmid":"d","status":"SOMETHING_NEW","lastUpdated":"2026-11-21T00:00:00Z"}]}"#;
        let map = parse_presence(body).unwrap();
        assert_eq!(map["a"], PresenceStatus::PlayingServer);
        assert_eq!(map["c"], PresenceStatus::Unknown);
    }

    #[test]
    fn action_omits_unset_fields() {
        let by_name = FriendAction { name: Some("Notch".into()), profile_id: None, update_type: UpdateType::Add };
        assert_eq!(serde_json::to_string(&by_name).unwrap(), r#"{"name":"Notch","updateType":"ADD"}"#);
        let by_id = FriendAction { name: None, profile_id: Some("abc".into()), update_type: UpdateType::Remove };
        assert_eq!(serde_json::to_string(&by_id).unwrap(), r#"{"profileId":"abc","updateType":"REMOVE"}"#);
    }

    #[test]
    fn status_serializes_as_game_names() {
        assert_eq!(serde_json::to_string(&PresenceStatus::Online).unwrap(), "\"ONLINE\"");
        assert_eq!(serde_json::to_string(&PresenceStatus::PlayingHostedServer).unwrap(), "\"PLAYING_HOSTED_SERVER\"");
    }
}
