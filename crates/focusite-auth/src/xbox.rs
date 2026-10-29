//! Xbox Live and XSTS authentication token exchange models and workflows.

use serde::{Deserialize, Serialize};
use crate::AuthError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XboxTokenResponse {
    #[serde(rename = "IssueInstant")]
    pub issue_instant: String,
    #[serde(rename = "NotAfter")]
    pub not_after: String,
    #[serde(rename = "Token")]
    pub token: String,
    #[serde(rename = "DisplayClaims")]
    pub display_claims: DisplayClaims,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayClaims {
    pub xui: Vec<XuiClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XuiClaim {
    pub uhs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftAuthResponse {
    pub access_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftProfileResponse {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<MinecraftSkinInfo>,
    #[serde(default)]
    pub capes: Vec<MinecraftCapeInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftSkinInfo {
    pub id: String,
    pub state: String,
    pub url: String,
    #[serde(default)]
    pub variant: Option<String>,
}

impl MinecraftSkinInfo {
    pub fn is_slim(&self) -> bool {
        self.variant
            .as_deref()
            .map(|v| v.eq_ignore_ascii_case("SLIM"))
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftCapeInfo {
    pub id: String,
    pub state: String,
    pub url: String,
    #[serde(default)]
    pub alias: Option<String>,
}

/// Exchanges Microsoft Access Token for Xbox Live (XBL) Token.
pub async fn authenticate_xbox_live(
    client: &reqwest::Client,
    ms_access_token: &str,
) -> Result<(String, String), AuthError> {
    let payload = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", ms_access_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&payload)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AuthError::AuthFailed(format!(
            "XBL authentication failed with HTTP {}",
            resp.status()
        )));
    }

    let xbl_resp: XboxTokenResponse = resp.json().await?;
    let uhs = xbl_resp
        .display_claims
        .xui
        .first()
        .map(|x| x.uhs.clone())
        .ok_or_else(|| AuthError::AuthFailed("Missing UHS claim in XBL response".into()))?;

    Ok((xbl_resp.token, uhs))
}

/// Exchanges Xbox Live Token for XSTS Token.
pub async fn obtain_xsts_token(
    client: &reqwest::Client,
    xbl_token: &str,
) -> Result<(String, String), AuthError> {
    let payload = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl_token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });

    let resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&payload)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AuthError::AuthFailed(format!(
            "XSTS authorization failed with HTTP {}",
            resp.status()
        )));
    }

    let xsts_resp: XboxTokenResponse = resp.json().await?;
    let uhs = xsts_resp
        .display_claims
        .xui
        .first()
        .map(|x| x.uhs.clone())
        .ok_or_else(|| AuthError::AuthFailed("Missing UHS claim in XSTS response".into()))?;

    Ok((xsts_resp.token, uhs))
}

/// Exchanges XSTS Token for Minecraft Java Services Token.
pub async fn login_minecraft_with_xbox(
    client: &reqwest::Client,
    userhash: &str,
    xsts_token: &str,
) -> Result<MinecraftAuthResponse, AuthError> {
    let payload = serde_json::json!({
        "identityToken": format!("XBL3.0 x={};{}", userhash, xsts_token)
    });

    let resp = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&payload)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AuthError::AuthFailed(format!(
            "Minecraft Services login failed with HTTP {}",
            resp.status()
        )));
    }

    let mc_resp: MinecraftAuthResponse = resp.json().await?;
    Ok(mc_resp)
}

/// Fetches Minecraft player profile (UUID and username).
pub async fn fetch_minecraft_profile(
    client: &reqwest::Client,
    mc_access_token: &str,
) -> Result<MinecraftProfileResponse, AuthError> {
    let resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(mc_access_token)
        .send()
        .await?;

    if !resp.status().is_success() {
        if resp.status().as_u16() == 404 {
            return Err(AuthError::NoMinecraftEntitlement);
        }
        return Err(AuthError::AuthFailed(format!(
            "Fetch Minecraft profile failed with HTTP {}",
            resp.status()
        )));
    }

    let profile: MinecraftProfileResponse = resp.json().await?;
    Ok(profile)
}

/// Public profile model fetched directly from Mojang Session Server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicMinecraftProfile {
    pub id: String,
    pub name: String,
    pub skin_url: Option<String>,
    pub skin_model: Option<String>, // "slim" or "default"
    pub cape_url: Option<String>,
}

/// Fetches public player profile from Mojang Session Server without authentication token.
pub async fn fetch_public_session_profile(
    client: &reqwest::Client,
    uuid: &str,
) -> Result<PublicMinecraftProfile, AuthError> {
    let clean_uuid = uuid.replace('-', "");
    let url = format!(
        "https://sessionserver.mojang.com/session/minecraft/profile/{}?unsigned=false",
        clean_uuid
    );
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        return Err(AuthError::AuthFailed(format!(
            "Session server returned HTTP {}",
            resp.status()
        )));
    }
    let val: serde_json::Value = resp.json().await?;
    let name = val["name"].as_str().unwrap_or("").to_string();
    let mut skin_url = None;
    let mut skin_model = None;
    let mut cape_url = None;

    if let Some(props) = val["properties"].as_array() {
        for prop in props {
            if prop["name"].as_str() == Some("textures") {
                if let Some(raw_b64) = prop["value"].as_str() {
                    use base64::Engine;
                    if let Ok(decoded_bytes) =
                        base64::engine::general_purpose::STANDARD.decode(raw_b64)
                    {
                        if let Ok(tex_json) =
                            serde_json::from_slice::<serde_json::Value>(&decoded_bytes)
                        {
                            if let Some(skin) =
                                tex_json.get("textures").and_then(|t| t.get("SKIN"))
                            {
                                skin_url = skin["url"].as_str().map(|s| s.to_string());
                                if let Some(model) = skin
                                    .get("metadata")
                                    .and_then(|m| m.get("model"))
                                    .and_then(|m| m.as_str())
                                {
                                    skin_model = Some(model.to_string());
                                } else {
                                    skin_model = Some("default".to_string());
                                }
                            }
                            if let Some(cape) =
                                tex_json.get("textures").and_then(|t| t.get("CAPE"))
                            {
                                cape_url = cape["url"].as_str().map(|s| s.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(PublicMinecraftProfile {
        id: clean_uuid,
        name,
        skin_url,
        skin_model,
        cape_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_minecraft_profile_response_with_capes() {
        let json = r#"{
            "id": "255655dc1f164e47804d96601b63f49c",
            "name": "Focal_Salt",
            "skins": [
                {
                    "id": "skin1",
                    "state": "ACTIVE",
                    "url": "http://textures.minecraft.net/texture/abc"
                }
            ],
            "capes": [
                {
                    "id": "cape1",
                    "state": "ACTIVE",
                    "url": "http://textures.minecraft.net/texture/cape_abc",
                    "alias": "Migrator"
                },
                {
                    "id": "cape2",
                    "state": "INACTIVE",
                    "url": "http://textures.minecraft.net/texture/cape_def",
                    "alias": "15Year"
                }
            ]
        }"#;

        let profile: MinecraftProfileResponse = serde_json::from_str(json).unwrap();
        assert_eq!(profile.name, "Focal_Salt");
        assert_eq!(profile.capes.len(), 2);
        assert_eq!(profile.capes[0].alias.as_deref(), Some("Migrator"));
        assert_eq!(profile.capes[0].state, "ACTIVE");
        assert_eq!(profile.capes[1].state, "INACTIVE");
    }

    #[test]
    fn test_skin_variant_and_slim_detection() {
        let slim_skin = MinecraftSkinInfo {
            id: "skin1".into(),
            state: "ACTIVE".into(),
            url: "http://example.com/skin".into(),
            variant: Some("SLIM".into()),
        };
        assert!(slim_skin.is_slim());

        let classic_skin = MinecraftSkinInfo {
            id: "skin2".into(),
            state: "ACTIVE".into(),
            url: "http://example.com/skin".into(),
            variant: Some("CLASSIC".into()),
        };
        assert!(!classic_skin.is_slim());
    }
}
