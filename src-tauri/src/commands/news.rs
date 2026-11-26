//! Minecraft.net news archive, fetched server-side page by page (the API sends no CORS headers).

use serde::{Deserialize, Serialize};
use std::time::Duration;

const SEARCH_URL: &str = "https://net-secondary.web.minecraft-services.net/api/v1.0/en-us/search";
/// Hard server-side limit for `pageSize`.
const PAGE_SIZE: u32 = 24;

#[derive(Debug, Deserialize)]
struct SearchEnvelope {
    result: SearchResult,
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    #[serde(default)]
    results: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    title: String,
    url: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    image: String,
    #[serde(default)]
    time: i64,
    #[serde(rename = "type", default)]
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArchiveItem {
    pub id: String,
    pub title: String,
    pub category: String,
    /// ISO date (YYYY-MM-DD).
    pub date: String,
    pub text: String,
    pub image_url: String,
    pub read_more_link: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArchivePage {
    pub items: Vec<NewsArchiveItem>,
    /// False once the server returned an empty page (oldest article reached).
    pub has_more: bool,
}

#[tauri::command]
pub async fn news_fetch_archive_page(page: u32) -> Result<NewsArchivePage, String> {
    if page == 0 {
        return Err("E_NEWS_PAGE_INVALID".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(SEARCH_URL)
        .query(&[
            ("pageSize", PAGE_SIZE.to_string()),
            ("sortType", "Recent".into()),
            ("category", "News".into()),
            ("newsOnly", "true".into()),
            ("page", page.to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("E_NEWS_CONNECTION_FAILED: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("E_NEWS_SERVER_ERROR: {}", resp.status()));
    }

    let envelope: SearchEnvelope = resp
        .json()
        .await
        .map_err(|e| format!("E_NEWS_BAD_DATA: {}", e))?;

    let items: Vec<NewsArchiveItem> = envelope
        .result
        .results
        .into_iter()
        .map(|h| NewsArchiveItem {
            id: h.url.clone(),
            title: h.title,
            category: if h.kind.is_empty() { "News".into() } else { h.kind },
            date: chrono::DateTime::from_timestamp(h.time, 0)
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_default(),
            text: h.description,
            image_url: h.image,
            read_more_link: h.url,
        })
        .collect();

    Ok(NewsArchivePage {
        has_more: !items.is_empty(),
        items,
    })
}
