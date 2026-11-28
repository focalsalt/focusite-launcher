//! Theme packs: JSON files of `--fc-*` design tokens kept in `<app data>\themes`.
//!
//! A pack only carries token values (no CSS), so loading one can never inject styles or fetch
//! resources. Names and values are still validated before they reach the webview.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const THEMES_DIR: &str = "themes";
const PACK_SUFFIX: &str = ".focusite-theme.json";
const MAX_TOKENS: usize = 64;
const MAX_PACK_BYTES: usize = 64 * 1024;

/// Packs written to the themes folder on first run. Existing files are never overwritten.
const DEFAULT_PACKS: [(&str, &str); 4] = [
    ("minecraft", include_str!("../../themes/minecraft.focusite-theme.json")),
    ("focusite", include_str!("../../themes/focusite.focusite-theme.json")),
    ("amethyst", include_str!("../../themes/amethyst.focusite-theme.json")),
    ("light", include_str!("../../themes/light.focusite-theme.json")),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemePack {
    /// File name without the `.focusite-theme.json` suffix; assigned on load.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: Option<String>,
    pub tokens: BTreeMap<String, String>,
}

fn is_valid_token_name(name: &str) -> bool {
    name.len() <= 48
        && name.starts_with("--fc-")
        && name.len() > 5
        && name[2..].chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_valid_token_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    !value.trim().is_empty()
        && value.len() <= 96
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || " #.%(),-+/*_\"'".contains(c))
        && !lower.contains("url(")
        && !lower.contains("image-set(")
        && !lower.contains("expression(")
        && !lower.contains("/*")
}

fn validate_pack(pack: &ThemePack) -> Result<(), String> {
    if pack.name.trim().is_empty() || pack.name.len() > 64 {
        return Err("E_THEME_NAME_INVALID".into());
    }
    if pack.tokens.is_empty() || pack.tokens.len() > MAX_TOKENS {
        return Err(format!("E_THEME_TOKEN_COUNT: {}", MAX_TOKENS));
    }
    for (k, v) in &pack.tokens {
        if !is_valid_token_name(k) {
            return Err(format!("E_THEME_TOKEN_NAME: {}", k));
        }
        if !is_valid_token_value(v) {
            return Err(format!("E_THEME_TOKEN_VALUE: {}", k));
        }
    }
    Ok(())
}

fn parse_pack(json: &str) -> Result<ThemePack, String> {
    if json.len() > MAX_PACK_BYTES {
        return Err("E_THEME_TOO_LARGE".into());
    }
    super::check_schema(json, "theme pack")?;
    let pack: ThemePack = serde_json::from_str(json).map_err(super::ctx("E_THEME_INVALID"))?;
    validate_pack(&pack)?;
    Ok(pack)
}

pub fn themes_dir() -> PathBuf {
    super::get_app_data_dir().join(THEMES_DIR)
}

/// Creates the themes folder and writes the default packs that are missing.
fn ensure_default_packs(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    // Built-in packs always exist: a missing one is written back, an existing (possibly edited) one is kept.
    for (id, body) in DEFAULT_PACKS {
        let path = dir.join(format!("{id}{PACK_SUFFIX}"));
        if !path.exists() {
            std::fs::write(path, body)?;
        }
    }
    Ok(())
}

/// Reads every valid pack in `dir`; broken files are skipped (and logged) so one bad file cannot hide the rest.
fn read_packs(dir: &Path) -> Vec<ThemePack> {
    let mut packs: Vec<ThemePack> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let id = file_name.strip_suffix(PACK_SUFFIX)?.to_string();
            let parsed = std::fs::read_to_string(entry.path())
                .map_err(|e| e.to_string())
                .and_then(|text| parse_pack(&text));
            match parsed {
                Ok(mut pack) => {
                    pack.id = id;
                    Some(pack)
                }
                Err(e) => {
                    tracing::warn!("Skipping invalid theme pack {}: {}", file_name, e);
                    None
                }
            }
        })
        .collect();
    packs.sort_by_key(|p| p.name.to_lowercase());
    packs
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "theme".into()
    } else {
        out
    }
}

/// Lists the packs in the themes folder, seeding the defaults first.
#[tauri::command]
pub fn list_themes() -> Result<Vec<ThemePack>, String> {
    let dir = themes_dir();
    ensure_default_packs(&dir).map_err(super::ctx("E_THEME_FOLDER_FAILED"))?;
    Ok(read_packs(&dir))
}

/// Validates a pack and saves it into the themes folder; returns the stored pack.
#[tauri::command]
pub fn import_theme_pack(json_content: String) -> Result<ThemePack, String> {
    let mut pack = parse_pack(&json_content)?;
    let dir = themes_dir();
    ensure_default_packs(&dir).map_err(super::ctx("E_THEME_FOLDER_FAILED"))?;

    let base = slugify(&pack.name);
    let mut id = base.clone();
    let mut n = 2;
    while dir.join(format!("{id}{PACK_SUFFIX}")).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    pack.id = id.clone();
    let body = super::to_versioned_json(&pack).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{id}{PACK_SUFFIX}")), body).map_err(super::ctx("E_THEME_SAVE_FAILED"))?;
    Ok(pack)
}

/// Validates a pack and writes it to a file the user picked, so it can be shared.
#[tauri::command]
pub fn export_theme_pack(dest_path: String, json_content: String) -> Result<(), String> {
    let pack = parse_pack(&json_content)?;
    let dest = PathBuf::from(dest_path);
    if !dest.extension().is_some_and(|e| e.eq_ignore_ascii_case("json")) {
        return Err("E_THEME_NOT_JSON".into());
    }
    let body = super::to_versioned_json(&pack).map_err(|e| e.to_string())?;
    super::atomic_write(&dest, body.as_bytes()).map_err(super::ctx("E_THEME_SAVE_FAILED"))
}

#[tauri::command]
pub fn open_themes_dir() -> Result<(), String> {
    let dir = themes_dir();
    ensure_default_packs(&dir).map_err(super::ctx("E_THEME_FOLDER_FAILED"))?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer");
        cmd.arg(&dir);
        cmd.creation_flags(0x08000000);
        let _ = cmd.spawn();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("fc_theme_test_{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn test_token_validation() {
        assert!(is_valid_token_name("--fc-primary"));
        assert!(is_valid_token_name("--fc-neutral-950"));
        assert!(!is_valid_token_name("--fc-"));
        assert!(!is_valid_token_name("--other"));
        assert!(!is_valid_token_name("--fc-Primary"));
        assert!(!is_valid_token_name("--fc-a;b"));

        assert!(is_valid_token_value("#3C8527"));
        assert!(is_valid_token_value("oklch(27.9% 0.041 260.031)"));
        assert!(is_valid_token_value("color-mix(in srgb, var(--fc-primary) 80%, white)"));
        assert!(is_valid_token_value("Inter, \"Noto Sans TC\", sans-serif"));
        assert!(!is_valid_token_value("url(https://evil.example/x.png)"));
        assert!(!is_valid_token_value("red; } body { display: none"));
        assert!(!is_valid_token_value("a /* b */"));
        assert!(!is_valid_token_value("  "));
    }

    #[test]
    fn test_default_packs_are_valid() {
        for (id, body) in DEFAULT_PACKS {
            let pack = parse_pack(body).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert!(pack.tokens.contains_key("--fc-primary"), "{id} needs --fc-primary");
        }
    }

    #[test]
    fn test_seed_never_overwrites_and_skips_bad_files() {
        let dir = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let edited = dir.join(format!("minecraft{PACK_SUFFIX}"));
        std::fs::write(&edited, r##"{"name":"Mine","tokens":{"--fc-primary":"#112233"}}"##).unwrap();
        std::fs::write(dir.join(format!("broken{PACK_SUFFIX}")), "{ not json").unwrap();

        ensure_default_packs(&dir).unwrap();
        let packs = read_packs(&dir);

        assert_eq!(packs.len(), DEFAULT_PACKS.len(), "defaults only (one user-edited); the broken file is skipped");
        let mine = packs.iter().find(|p| p.id == "minecraft").unwrap();
        assert_eq!(mine.name, "Mine");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_deleted_default_pack_is_restored() {
        let dir = temp_dir();
        ensure_default_packs(&dir).unwrap();
        std::fs::remove_file(dir.join(format!("amethyst{PACK_SUFFIX}"))).unwrap();
        ensure_default_packs(&dir).unwrap();
        assert_eq!(read_packs(&dir).len(), DEFAULT_PACKS.len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Obsidian Dark!"), "obsidian-dark");
        assert_eq!(slugify("  "), "theme");
        assert_eq!(slugify("../../x"), "x");
    }
}
