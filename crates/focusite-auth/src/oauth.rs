//! Microsoft OAuth 2.0 PKCE structures and URL generators.

use serde::{Deserialize, Serialize};

pub const MS_OAUTH_AUTH_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
pub const MS_OAUTH_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
pub const MS_OAUTH_CLIENT_ID: &str = "00000000402b5328"; // Standard Minecraft public client id or custom

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
}
