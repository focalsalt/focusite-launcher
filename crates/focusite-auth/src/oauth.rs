//! Microsoft OAuth 2.0 Device Authorization Grant (RFC 8628) implementation.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::AuthError;

pub const MS_OAUTH_DEVICE_CODE_URL: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
pub const MS_OAUTH_TOKEN_URL: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

/// Resolves and validates a Microsoft Client ID string.
pub fn resolve_client_id(env_val: Option<String>) -> Result<String, AuthError> {
    match env_val {
        Some(id) if !id.trim().is_empty() => Ok(id.trim().to_string()),
        _ => Err(AuthError::MissingClientId),
    }
}

/// Gets the Microsoft Client ID strictly from .env or environment variables.
pub fn get_microsoft_client_id() -> Result<String, AuthError> {
    let _ = dotenvy::dotenv();
    resolve_client_id(std::env::var("MICROSOFT_CLIENT_ID").ok())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub user_code: String,
    pub device_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthErrorResponse {
    pub error: String,
    pub error_description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceCodePollStatus {
    Pending,
    SlowDown,
    Success,
    Expired,
    Error(String),
}

/// Initiates Microsoft Device Authorization flow.
pub async fn start_device_code(
    client: &reqwest::Client,
    client_id: &str,
) -> Result<DeviceCodeResponse, AuthError> {
    let mut params = HashMap::new();
    params.insert("client_id", client_id);
    params.insert("scope", "XboxLive.signin offline_access");

    let resp = client
        .post(MS_OAUTH_DEVICE_CODE_URL)
        .form(&params)
        .send()
        .await?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(AuthError::AuthFailed(format!(
            "Device code request failed: {}",
            err_text
        )));
    }

    let code_resp: DeviceCodeResponse = resp.json().await?;
    Ok(code_resp)
}

/// Polls Microsoft OAuth token endpoint once using device_code.
pub async fn poll_device_code_once(
    client: &reqwest::Client,
    client_id: &str,
    device_code: &str,
) -> Result<(DeviceCodePollStatus, Option<OAuthTokenResponse>), AuthError> {
    let mut params = HashMap::new();
    params.insert("grant_type", "urn:ietf:params:oauth:grant-type:device_code");
    params.insert("client_id", client_id);
    params.insert("device_code", device_code);

    let resp = client
        .post(MS_OAUTH_TOKEN_URL)
        .form(&params)
        .send()
        .await?;

    if resp.status().is_success() {
        let token_resp: OAuthTokenResponse = resp.json().await?;
        return Ok((DeviceCodePollStatus::Success, Some(token_resp)));
    }

    let err_body: OAuthErrorResponse = match resp.json().await {
        Ok(e) => e,
        Err(_) => {
            return Ok((
                DeviceCodePollStatus::Error("Failed to parse token error response".into()),
                None,
            ));
        }
    };

    match err_body.error.as_str() {
        "authorization_pending" => Ok((DeviceCodePollStatus::Pending, None)),
        "slow_down" => Ok((DeviceCodePollStatus::SlowDown, None)),
        "expired_token" => Ok((DeviceCodePollStatus::Expired, None)),
        other => Ok((
            DeviceCodePollStatus::Error(format!(
                "{}: {}",
                other,
                err_body.error_description.unwrap_or_default()
            )),
            None,
        )),
    }
}

/// Refreshes Microsoft OAuth token using a refresh token.
pub async fn refresh_oauth_token(
    client: &reqwest::Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<OAuthTokenResponse, AuthError> {
    let mut params = HashMap::new();
    params.insert("grant_type", "refresh_token");
    params.insert("client_id", client_id);
    params.insert("refresh_token", refresh_token);
    params.insert("scope", "XboxLive.signin offline_access");

    let resp = client
        .post(MS_OAUTH_TOKEN_URL)
        .form(&params)
        .send()
        .await?;

    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(AuthError::AuthFailed(format!(
            "Refresh Microsoft OAuth token failed: {}",
            err_text
        )));
    }

    let token_resp: OAuthTokenResponse = resp.json().await?;
    Ok(token_resp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_missing_client_id_error() {
        assert!(matches!(resolve_client_id(None), Err(AuthError::MissingClientId)));
        assert!(matches!(resolve_client_id(Some("".into())), Err(AuthError::MissingClientId)));
        assert!(matches!(resolve_client_id(Some("   ".into())), Err(AuthError::MissingClientId)));
    }

    #[test]
    fn test_valid_client_id_read() {
        let res = resolve_client_id(Some("test-client-id-123".into())).unwrap();
        assert_eq!(res, "test-client-id-123");
    }
}
