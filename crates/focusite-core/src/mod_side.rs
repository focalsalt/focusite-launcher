//! What a mod file says about itself (name, versions, side), plus Modrinth's side data.

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

/// What a mod file declares. A field is `None` when the file says nothing usable about it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct JarInfo {
    /// `Both` only when written out.
    pub side: Option<ModSide>,
    pub name: Option<String>,
    pub version: Option<String>,
    /// The declared Minecraft constraint, verbatim (`>=1.20 <1.21`, `[1.20.1,1.21)`).
    pub mc_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Metadata {
    Fabric,
    Quilt,
    Forge,
    NeoForge,
    /// `mcmod.info`, used before Forge 1.13.
    LegacyForge,
}

impl Metadata {
    /// The files the given loader actually reads, in its order of preference.
    fn for_loader(loader: &str) -> &'static [Metadata] {
        use Metadata::*;
        match loader.to_ascii_lowercase().as_str() {
            "fabric" => &[Fabric],
            "quilt" => &[Quilt, Fabric],
            "forge" => &[Forge, LegacyForge],
            "neoforge" => &[NeoForge, Forge],
            _ => &[Fabric, Quilt, Forge, NeoForge, LegacyForge],
        }
    }

    fn file_name(self) -> &'static str {
        match self {
            Metadata::Fabric => "fabric.mod.json",
            Metadata::Quilt => "quilt.mod.json",
            Metadata::Forge => "META-INF/mods.toml",
            Metadata::NeoForge => "META-INF/neoforge.mods.toml",
            Metadata::LegacyForge => "mcmod.info",
        }
    }

    fn parse(self, text: &str) -> Option<JarInfo> {
        match self {
            Metadata::Fabric => {
                let json = parse_lenient_json(text)?;
                Some(JarInfo {
                    side: environment_side(&json["environment"], "server"),
                    name: string(&json["name"]),
                    version: string(&json["version"]),
                    mc_version: constraint(&json["depends"]["minecraft"]),
                })
            }
            Metadata::Quilt => {
                let json = parse_lenient_json(text)?;
                let loader = &json["quilt_loader"];
                let minecraft = loader["depends"].as_array().and_then(|d| d.iter().find(|d| d["id"] == "minecraft"));
                Some(JarInfo {
                    side: environment_side(&json["minecraft"]["environment"], "dedicated_server"),
                    name: string(&loader["metadata"]["name"]),
                    version: string(&loader["version"]),
                    mc_version: minecraft.and_then(|d| constraint(&d["versions"])),
                })
            }
            Metadata::Forge | Metadata::NeoForge => parse_mods_toml(text),
            Metadata::LegacyForge => {
                let json = parse_lenient_json(text)?;
                // Either a bare list or `{"modList": [...]}`.
                let first = json.get(0).unwrap_or(&json["modList"][0]);
                Some(JarInfo {
                    side: None,
                    name: string(&first["name"]),
                    version: string(&first["version"]),
                    mc_version: string(&first["mcversion"]),
                })
            }
        }
    }
}

/// A non-empty string that is not an unfilled build placeholder such as `${version}`.
fn string(value: &Value) -> Option<String> {
    let text = value.as_str()?.trim();
    (!text.is_empty() && !text.contains("${")).then(|| text.to_string())
}

/// One version predicate, or a list of alternatives.
fn constraint(value: &Value) -> Option<String> {
    match value.as_array() {
        Some(list) => {
            let all: Vec<String> = list.iter().filter_map(string).collect();
            (!all.is_empty()).then(|| all.join(" || "))
        }
        None => string(value),
    }
}

/// The first `[[mods]]` entry and its `minecraft` dependency. `version` may still be a placeholder.
fn parse_mods_toml(text: &str) -> Option<JarInfo> {
    let toml: toml::Table = text.trim_start_matches('\u{feff}').parse().ok()?;
    let json = serde_json::to_value(toml).ok()?;
    let first = &json["mods"][0];
    let minecraft = first["modId"]
        .as_str()
        .and_then(|id| json["dependencies"][id].as_array())
        .and_then(|deps| deps.iter().find(|d| d["modId"] == "minecraft"));
    Some(JarInfo {
        side: (json["clientSideOnly"] == true).then_some(ModSide::Client),
        name: string(&first["displayName"]),
        version: first["version"].as_str().map(str::to_string),
        mc_version: minecraft.and_then(|d| string(&d["versionRange"])),
    })
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

fn read_entry(archive: &mut ZipArchive<File>, name: &str) -> Option<String> {
    let mut text = String::new();
    archive.by_name(name).ok()?.take(MAX_METADATA_BYTES).read_to_string(&mut text).ok()?;
    Some(text)
}

/// What the file declares to `loader`; empty when the archive or its metadata cannot be read.
pub fn read_jar_info(jar: &Path, loader: &str) -> JarInfo {
    let Some(mut archive) = File::open(jar).ok().and_then(|f| ZipArchive::new(f).ok()) else {
        return JarInfo::default();
    };
    for kind in Metadata::for_loader(loader) {
        let Some(text) = read_entry(&mut archive, kind.file_name()) else { continue };
        let mut info = kind.parse(&text).unwrap_or_default();
        // Forge builds usually leave the version to the jar manifest.
        if info.version.as_deref() == Some("${file.jarVersion}") {
            info.version = read_entry(&mut archive, "META-INF/MANIFEST.MF").and_then(|manifest| {
                manifest.lines().find_map(|l| l.strip_prefix("Implementation-Version:").map(|v| v.trim().to_string()))
            });
        }
        info.version = info.version.filter(|v| !v.is_empty() && !v.contains("${"));
        return info;
    }
    JarInfo::default()
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
        info_of(entries, loader).side
    }

    fn info_of(entries: &[(&str, &str)], loader: &str) -> JarInfo {
        let path = std::env::temp_dir().join(format!("focusite_mod_side_{}.jar", uuid::Uuid::new_v4()));
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        for (name, text) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        let info = read_jar_info(&path, loader);
        std::fs::remove_file(path).unwrap();
        info
    }

    fn info(name: &str, version: &str, mc: &str) -> JarInfo {
        JarInfo { side: None, name: Some(name.into()), version: Some(version.into()), mc_version: Some(mc.into()) }
    }

    #[test]
    fn name_and_versions_per_format() {
        let fabric = r#"{"name":"A","version":"1.0","depends":{"minecraft":["1.20","1.20.1"]}}"#;
        assert_eq!(info_of(&[("fabric.mod.json", fabric)], "Fabric"), info("A", "1.0", "1.20 || 1.20.1"));

        let quilt = r#"{"quilt_loader":{"version":"2.0","metadata":{"name":"B"},"depends":["quilt_loader",{"id":"minecraft","versions":">=1.20"}]}}"#;
        assert_eq!(info_of(&[("quilt.mod.json", quilt)], "Quilt"), info("B", "2.0", ">=1.20"));

        let toml = "[[mods]]\nmodId=\"c\"\ndisplayName=\"C\"\nversion=\"${file.jarVersion}\"\n[[dependencies.c]]\nmodId=\"minecraft\"\nversionRange=\"[1.20.1,1.21)\"\n";
        let manifest = ("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\r\nImplementation-Version: 3.0\r\n");
        assert_eq!(info_of(&[("META-INF/mods.toml", toml), manifest], "Forge"), info("C", "3.0", "[1.20.1,1.21)"));
        assert_eq!(info_of(&[("META-INF/mods.toml", toml)], "Forge").version, None);

        let legacy = r#"[{"name":"D","version":"4.0","mcversion":"1.12.2"}]"#;
        assert_eq!(info_of(&[("mcmod.info", legacy)], "Forge"), info("D", "4.0", "1.12.2"));
        assert_eq!(info_of(&[("fabric.mod.json", r#"{"version":"${version}"}"#)], "Fabric"), JarInfo::default());
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
        assert_eq!(read_jar_info(Path::new("missing.jar"), "Fabric"), JarInfo::default());
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
