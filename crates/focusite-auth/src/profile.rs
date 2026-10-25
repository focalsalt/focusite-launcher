//! Auth profile definitions and data models.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthProfile {
    pub id: String,
    pub username: String,
    pub xbox_gamertag: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    pub has_entitlement: bool,
    pub skin_url: Option<String>,
    pub is_offline_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthProfileSummary {
    pub id: String,
    pub username: String,
    pub xbox_gamertag: String,
    pub skin_url: Option<String>,
    pub is_active: bool,
}
