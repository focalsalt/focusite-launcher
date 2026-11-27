//! Which side (client, server, both) a mod belongs to, from its jar metadata and Modrinth project data.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use zip::ZipArchive;

/// Metadata files are a few KiB; the cap stops a crafted jar from inflating into all memory.
const MAX_METADATA_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModSide {
    Client,
    Server,
    Both,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SideSource {
    Jar,
    Modrinth,
}

#[derive(Debug, Clone, Copy)]
enum Metadata {
    Fabric,
    Quilt,
    Forge,
    NeoForge,
}

impl Metadata {
    /// The files the given loader actually reads, in its order of preference.
    fn for_loader(loader: &str) -> &'static [Metadata] {
        use Metadata::*;
        match loader.to_ascii_lowercase().as_str() {
            "fabric" => &[Fabric],
            "quilt" => &[Quilt, Fabric],
            "forge" => &[Forge],
            "neoforge" => &[NeoForge, Forge],
            _ => &[Fabric, Quilt, Forge, NeoForge],
        }
    }

    fn file_name(self) -> &'static str {
        match self {
            Metadata::Fabric => "fabric.mod.json",
            Metadata::Quilt => "quilt.mod.json",
            Metadata::Forge => "META-INF/mods.toml",
            Metadata::NeoForge => "META-INF/neoforge.mods.toml",
        }
    }

    fn declared_side(self, text: &str) -> Option<ModSide> {
        match self {
            Metadata::Fabric => environment_side(&parse_lenient_json(text)?["environment"], "server"),
            Metadata::Quilt => environment_side(&parse_lenient_json(text)?["minecraft"]["environment"], "dedicated_server"),
            Metadata::Forge | Metadata::NeoForge => is_client_side_only(text).then_some(ModSide::Client),
        }
    }
}

/// Fabric Loader accepts raw line breaks inside strings, which serde_json rejects. Outside strings
/// they are plain whitespace, so replacing them changes nothing that is read here.
fn parse_lenient_json(text: &str) -> Option<Value> {
    serde_json::from_str(&text.trim_start_matches('\u{feff}').replace(['\n', '\r', '\t'], " ")).ok()
}

fn environment_side(value: &Value, server_name: &str) -> Option<ModSide> {
    match value.as_str()? {
        "client" => Some(ModSide::Client),
        "*" => Some(ModSide::Both),
        name if name == server_name => Some(ModSide::Server),
        _ => None,
    }
}

/// Top-level `clientSideOnly=true` in a `mods.toml`; keys below the first table header belong to that table.
fn is_client_side_only(toml: &str) -> bool {
    toml.trim_start_matches('\u{feff}')
        .lines()
        .map(|line| line.split('#').next().unwrap_or("").trim())
        .take_while(|line| !line.starts_with('['))
        .filter_map(|line| line.split_once('='))
        .any(|(key, value)| key.trim() == "clientSideOnly" && value.trim() == "true")
}

/// The side the jar itself declares for `loader`: `Both` only when written out, `None` when the jar says
/// nothing usable (absent field, unreadable archive).
pub fn read_jar_side(jar: &Path, loader: &str) -> Option<ModSide> {
    let mut archive = ZipArchive::new(File::open(jar).ok()?).ok()?;
    for kind in Metadata::for_loader(loader) {
        let Ok(entry) = archive.by_name(kind.file_name()) else { continue };
        let mut text = String::new();
        entry.take(MAX_METADATA_BYTES).read_to_string(&mut text).ok()?;
        return kind.declared_side(&text);
    }
    None
}

/// Modrinth's `client_side` / `server_side` pair. Any value outside the known three is not used.
pub fn modrinth_side(client: &str, server: &str) -> Option<ModSide> {
    let supported = |value: &str| match value {
        "required" | "optional" => Some(true),
        "unsupported" => Some(false),
        _ => None,
    };
    match (supported(client)?, supported(server)?) {
        (true, true) => Some(ModSide::Both),
        (true, false) => Some(ModSide::Client),
        (false, true) => Some(ModSide::Server),
        (false, false) => None,
    }
}

/// A single-sided jar declaration wins (the loader enforces it), then Modrinth, then an explicit `*`.
pub fn resolve_side(jar: Option<ModSide>, modrinth: Option<ModSide>) -> (ModSide, Option<SideSource>) {
    match (jar, modrinth) {
        (Some(side @ (ModSide::Client | ModSide::Server)), _) => (side, Some(SideSource::Jar)),
        (_, Some(side)) => (side, Some(SideSource::Modrinth)),
        (Some(side), None) => (side, Some(SideSource::Jar)),
        (None, None) => (ModSide::Unknown, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn side_of(entries: &[(&str, &str)], loader: &str) -> Option<ModSide> {
        let path = std::env::temp_dir().join(format!("focusite_mod_side_{}.jar", uuid::Uuid::new_v4()));
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        for (name, text) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        let side = read_jar_side(&path, loader);
        std::fs::remove_file(path).unwrap();
        side
    }

    #[test]
    fn fabric_environment() {
        let fabric = |json: &str| side_of(&[("fabric.mod.json", json)], "Fabric");
        assert_eq!(fabric(r#"{"environment":"client"}"#), Some(ModSide::Client));
        assert_eq!(fabric(r#"{"environment":"server"}"#), Some(ModSide::Server));
        assert_eq!(fabric(r#"{"environment":"*"}"#), Some(ModSide::Both));
        assert_eq!(fabric(r#"{"id":"a"}"#), None);
        assert_eq!(fabric("{\"description\":\"two\nlines\",\"environment\":\"client\"}"), Some(ModSide::Client));
        assert_eq!(fabric("not json"), None);
    }

    #[test]
    fn quilt_prefers_its_own_file_and_falls_back_to_fabric() {
        let quilt = ("quilt.mod.json", r#"{"minecraft":{"environment":"dedicated_server"}}"#);
        let fabric = ("fabric.mod.json", r#"{"environment":"client"}"#);
        assert_eq!(side_of(&[fabric, quilt], "Quilt"), Some(ModSide::Server));
        assert_eq!(side_of(&[fabric], "Quilt"), Some(ModSide::Client));
        assert_eq!(side_of(&[fabric, quilt], "Fabric"), Some(ModSide::Client));
        assert_eq!(side_of(&[fabric], "Forge"), None);
    }

    #[test]
    fn forge_client_side_only_must_be_top_level() {
        let forge = |toml: &str| side_of(&[("META-INF/mods.toml", toml)], "Forge");
        assert_eq!(forge("modLoader=\"javafml\"\nclientSideOnly = true # note\n[[mods]]\n"), Some(ModSide::Client));
        assert_eq!(forge("clientSideOnly=false\n"), None);
        assert_eq!(forge("[[mods]]\nclientSideOnly=true\n"), None);
        assert_eq!(forge("[[dependencies.a]]\nside=\"CLIENT\"\n"), None);
        assert_eq!(side_of(&[("META-INF/neoforge.mods.toml", "clientSideOnly=true\n")], "NeoForge"), Some(ModSide::Client));
    }

    #[test]
    fn unreadable_jar_declares_nothing() {
        assert_eq!(read_jar_side(Path::new("missing.jar"), "Fabric"), None);
    }

    #[test]
    fn modrinth_pairs() {
        assert_eq!(modrinth_side("required", "unsupported"), Some(ModSide::Client));
        assert_eq!(modrinth_side("unsupported", "optional"), Some(ModSide::Server));
        assert_eq!(modrinth_side("optional", "required"), Some(ModSide::Both));
        assert_eq!(modrinth_side("unsupported", "unsupported"), None);
        assert_eq!(modrinth_side("unknown", "required"), None);
    }

    #[test]
    fn precedence() {
        use ModSide::*;
        assert_eq!(resolve_side(Some(Client), Some(Both)), (Client, Some(SideSource::Jar)));
        assert_eq!(resolve_side(Some(Both), Some(Client)), (Client, Some(SideSource::Modrinth)));
        assert_eq!(resolve_side(Some(Both), None), (Both, Some(SideSource::Jar)));
        assert_eq!(resolve_side(None, Some(Server)), (Server, Some(SideSource::Modrinth)));
        assert_eq!(resolve_side(None, None), (Unknown, None));
    }
}
