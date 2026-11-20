//! Xbox friends (people list) lookup. Spike: returns XUIDs only, to prove the launcher's login can read them.

use focusite_auth::keyring_store::CredentialStore;
use focusite_auth::{oauth, xbox};

/// XSTS relying party for Xbox Live services such as `social.xboxlive.com`.
const XBOX_LIVE_RP: &str = "http://xboxlive.com";

#[tauri::command]
pub async fn friends_list_xuids(account_id: String) -> Result<Vec<String>, String> {
    let client = super::http();
    let (mc_token, refresh) = CredentialStore::get_credentials(&account_id)
        .map_err(|e| format!("讀取憑證失敗: {}", e))?
        .ok_or("此帳號沒有登入憑證，請重新登入")?;
    let refresh = refresh.ok_or("此帳號沒有 refresh token，請重新登入")?;

    let client_id = oauth::get_microsoft_client_id().map_err(|e| e.to_string())?;
    let ms = oauth::refresh_oauth_token(client, &client_id, &refresh)
        .await
        .map_err(|e| e.to_string())?;
    // Microsoft rotates refresh tokens: keep the new one before any later step can fail.
    let new_refresh = ms.refresh_token.as_deref().unwrap_or(&refresh);
    let _ = CredentialStore::save_credentials(&account_id, &mc_token, Some(new_refresh));

    let (xbl, _) = xbox::authenticate_xbox_live(client, &ms.access_token)
        .await
        .map_err(|e| format!("Xbox Live: {}", e))?;
    let (xsts, uhs) = xbox::obtain_xsts_token_for(client, &xbl, XBOX_LIVE_RP)
        .await
        .map_err(|e| format!("XSTS: {}", e))?;
    xbox::fetch_xbox_people_xuids(client, &uhs, &xsts)
        .await
        .map_err(|e| e.to_string())
}
