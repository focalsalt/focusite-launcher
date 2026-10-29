//! Command-line argument interpolator and builder for Minecraft launch.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::manifest::{eval_rules, ArgumentEntry, VersionManifest};

/// Parameters used to interpolate Minecraft and JVM launch arguments.
#[derive(Debug, Clone)]
pub struct LaunchContext {
    pub auth_player_name: String,
    pub version_name: String,
    pub game_directory: String,
    pub assets_root: String,
    pub assets_index_name: String,
    pub auth_uuid: String,
    pub auth_access_token: String,
    pub user_type: String,
    pub version_type: String,
    pub classpath: String,
    pub natives_directory: String,
    pub launcher_name: String,
    pub launcher_version: String,
    pub tweak_class: Option<String>,
}

impl Default for LaunchContext {
    fn default() -> Self {
        Self {
            auth_player_name: "Player".into(),
            version_name: "1.21.4".into(),
            game_directory: "".into(),
            assets_root: "".into(),
            assets_index_name: "".into(),
            auth_uuid: "00000000-0000-0000-0000-000000000000".into(),
            auth_access_token: "".into(),
            user_type: "msa".into(),
            version_type: "release".into(),
            classpath: "".into(),
            natives_directory: "".into(),
            launcher_name: "Focusite".into(),
            launcher_version: "26.1.0".into(),
            tweak_class: None,
        }
    }
}

impl LaunchContext {
    pub fn to_map(&self) -> HashMap<&'static str, &str> {
        let mut map = HashMap::new();
        map.insert("${auth_player_name}", self.auth_player_name.as_str());
        map.insert("${version_name}", self.version_name.as_str());
        map.insert("${game_directory}", self.game_directory.as_str());
        map.insert("${assets_root}", self.assets_root.as_str());
        map.insert("${assets_index_name}", self.assets_index_name.as_str());
        map.insert("${auth_uuid}", self.auth_uuid.as_str());
        map.insert("${auth_access_token}", self.auth_access_token.as_str());
        map.insert("${user_type}", self.user_type.as_str());
        map.insert("${version_type}", self.version_type.as_str());
        map.insert("${classpath}", self.classpath.as_str());
        map.insert("${natives_directory}", self.natives_directory.as_str());
        map.insert("${launcher_name}", self.launcher_name.as_str());
        map.insert("${launcher_version}", self.launcher_version.as_str());
        if let Some(ref tc) = self.tweak_class {
            map.insert("${tweak_class}", tc.as_str());
        }
        map
    }

    /// Interpolates placeholders in an argument template string.
    pub fn interpolate(&self, template: &str) -> String {
        let mut result = template.to_string();
        for (key, val) in self.to_map() {
            result = result.replace(key, val);
        }
        result
    }
}

/// Helper to build a platform-native classpath string.
/// Uses `;` on Windows, `:` on Unix-like operating systems.
pub fn build_classpath(libraries: &[PathBuf], client_jar: &Path) -> String {
    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let mut parts: Vec<String> = libraries
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    parts.push(client_jar.to_string_lossy().to_string());
    parts.join(separator)
}

/// Builds complete command-line arguments to launch Minecraft.
pub fn build_launch_arguments(
    manifest: &VersionManifest,
    context: &LaunchContext,
    min_memory_mb: u32,
    max_memory_mb: u32,
    custom_jvm_args: &[String],
    os_name: &str,
    os_arch: &str,
) -> Vec<String> {
    let mut args = Vec::new();

    // 1. Memory constraints
    args.push(format!("-Xms{}M", min_memory_mb));
    args.push(format!("-Xmx{}M", max_memory_mb));

    // 2. Custom user JVM flags
    for custom in custom_jvm_args {
        if !custom.trim().is_empty() {
            args.push(custom.clone());
        }
    }

    // 3. Manifest JVM arguments
    if let Some(ref launch_args) = manifest.arguments {
        for entry in &launch_args.jvm {
            match entry {
                ArgumentEntry::Simple(val) => {
                    args.push(context.interpolate(val));
                }
                ArgumentEntry::Conditional { rules, value } => {
                    if eval_rules(rules, os_name, os_arch) {
                        for val in value.as_vec() {
                            args.push(context.interpolate(&val));
                        }
                    }
                }
            }
        }
    } else {
        // Fallback for legacy Minecraft (1.12 and below)
        args.push(format!("-Djava.library.path={}", context.natives_directory));
        args.push(format!("-Dminecraft.launcher.brand={}", context.launcher_name));
        args.push(format!("-Dminecraft.launcher.version={}", context.launcher_version));
        args.push("-cp".into());
        args.push(context.classpath.clone());
    }

    // 4. Main Class
    args.push(manifest.main_class.clone());

    // 5. Game arguments
    if let Some(ref launch_args) = manifest.arguments {
        for entry in &launch_args.game {
            match entry {
                ArgumentEntry::Simple(val) => {
                    args.push(context.interpolate(val));
                }
                ArgumentEntry::Conditional { rules, value } => {
                    if eval_rules(rules, os_name, os_arch) {
                        for val in value.as_vec() {
                            args.push(context.interpolate(&val));
                        }
                    }
                }
            }
        }
    } else if let Some(ref legacy) = manifest.legacy_arguments {
        for part in legacy.split_whitespace() {
            args.push(context.interpolate(part));
        }
    }

    args
}

/// Builds complete launch arguments for 1.2.5 ~ 1.5.2 Forge installations.
/// Strict Classpath Order: Forge Core JAR FIRST -> Vanilla Client JAR -> LWJGL and other libraries.
/// Injects `-Djava.library.path=<natives_dir>`.
#[allow(clippy::too_many_arguments)]
pub fn build_legacy_pre16_forge_arguments(
    forge_core_jar: &Path,
    vanilla_client_jar: &Path,
    lwjgl_libraries: &[PathBuf],
    context: &LaunchContext,
    min_memory_mb: u32,
    max_memory_mb: u32,
    custom_jvm_args: &[String],
    main_class: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();

    // 1. Memory constraints
    args.push(format!("-Xms{}M", min_memory_mb));
    args.push(format!("-Xmx{}M", max_memory_mb));

    // 2. Custom user JVM flags
    for custom in custom_jvm_args {
        if !custom.trim().is_empty() {
            args.push(custom.clone());
        }
    }

    // 3. Natives library path
    args.push(format!("-Djava.library.path={}", context.natives_directory));
    args.push(format!("-Dminecraft.launcher.brand={}", context.launcher_name));
    args.push(format!("-Dminecraft.launcher.version={}", context.launcher_version));

    // 4. Classpath (-cp): Forge core jar MUST be first!
    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let mut cp_parts = vec![forge_core_jar.to_string_lossy().to_string()];
    cp_parts.push(vanilla_client_jar.to_string_lossy().to_string());
    for lib in lwjgl_libraries {
        cp_parts.push(lib.to_string_lossy().to_string());
    }
    args.push("-cp".into());
    args.push(cp_parts.join(separator));

    // 5. Main Class
    let entry_class = main_class.unwrap_or("net.minecraft.client.Minecraft");
    args.push(entry_class.to_string());

    // 6. Game arguments
    args.push("--gameDir".into());
    args.push(context.game_directory.clone());
    args.push("--username".into());
    args.push(context.auth_player_name.clone());
    args.push("--version".into());
    args.push(context.version_name.clone());

    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_legacy_pre16_forge_arguments() {
        let forge_jar = PathBuf::from("C:/mods/forge-1.5.2.jar");
        let client_jar = PathBuf::from("C:/versions/1.5.2/1.5.2.jar");
        let lwjgl_libs = vec![
            PathBuf::from("C:/bin/lwjgl.jar"),
            PathBuf::from("C:/bin/lwjgl_util.jar"),
        ];

        let ctx = LaunchContext {
            auth_player_name: "Steve".into(),
            version_name: "1.5.2".into(),
            game_directory: "C:/focusite/instances/Retro/minecraft".into(),
            natives_directory: "C:/focusite/instances/Retro/minecraft/bin/natives".into(),
            ..Default::default()
        };

        let args = build_legacy_pre16_forge_arguments(
            &forge_jar,
            &client_jar,
            &lwjgl_libs,
            &ctx,
            1024,
            2048,
            &["-XX:+UseG1GC".into()],
            Some("net.minecraft.client.Minecraft"),
        );

        assert!(args.contains(&"-Xms1024M".to_string()));
        assert!(args.contains(&"-Xmx2048M".to_string()));
        assert!(args.contains(&"-XX:+UseG1GC".to_string()));
        assert!(args.contains(&"-Djava.library.path=C:/focusite/instances/Retro/minecraft/bin/natives".to_string()));

        // Verify classpath positioning: Forge jar MUST be the very first entry in the -cp string
        let cp_idx = args.iter().position(|a| a == "-cp").expect("-cp argument missing");
        let cp_val = &args[cp_idx + 1];
        let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        let entries: Vec<&str> = cp_val.split(sep).collect();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0], "C:/mods/forge-1.5.2.jar");
        assert_eq!(entries[1], "C:/versions/1.5.2/1.5.2.jar");
        assert_eq!(entries[2], "C:/bin/lwjgl.jar");
        assert_eq!(entries[3], "C:/bin/lwjgl_util.jar");

        // Verify main class and gameDir
        assert!(args.contains(&"net.minecraft.client.Minecraft".to_string()));
        assert!(args.contains(&"--gameDir".to_string()));
        assert!(args.contains(&"C:/focusite/instances/Retro/minecraft".to_string()));
    }

    #[test]
    fn test_argument_interpolation() {
        let ctx = LaunchContext {
            auth_player_name: "Steve".into(),
            version_name: "1.20.4".into(),
            game_directory: "/game".into(),
            ..Default::default()
        };

        let raw = "--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory}";
        let res = ctx.interpolate(raw);
        assert_eq!(res, "--username Steve --version 1.20.4 --gameDir /game");
    }

    #[test]
    fn test_build_launch_arguments_modern() {
        let json = r#"{
            "id": "1.21.4",
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "arguments": {
                "game": [
                    "--username",
                    "${auth_player_name}",
                    "--version",
                    "${version_name}"
                ],
                "jvm": [
                    "-Djava.library.path=${natives_directory}",
                    "-Dminecraft.launcher.brand=${launcher_name}",
                    "-cp",
                    "${classpath}"
                ]
            },
            "libraries": []
        }"#;

        let manifest: VersionManifest = serde_json::from_str(json).unwrap();
        let ctx = LaunchContext {
            auth_player_name: "Alex".into(),
            classpath: "lib1.jar;lib2.jar;client.jar".into(),
            natives_directory: "bin/natives".into(),
            ..Default::default()
        };

        let args = build_launch_arguments(
            &manifest,
            &ctx,
            1024,
            4096,
            &["-XX:+UseG1GC".into()],
            "windows",
            "x86_64",
        );

        assert!(args.contains(&"-Xms1024M".to_string()));
        assert!(args.contains(&"-Xmx4096M".to_string()));
        assert!(args.contains(&"-XX:+UseG1GC".to_string()));
        assert!(args.contains(&"-Djava.library.path=bin/natives".to_string()));
        assert!(args.contains(&"net.minecraft.client.main.Main".to_string()));
        assert!(args.contains(&"Alex".to_string()));
    }

    #[test]
    fn test_build_classpath() {
        let libs = vec![PathBuf::from("a.jar"), PathBuf::from("b.jar")];
        let client = PathBuf::from("client.jar");
        let cp = build_classpath(&libs, &client);
        let expected_sep = if cfg!(target_os = "windows") { ";" } else { ":" };
        assert!(cp.contains(&format!("a.jar{}b.jar{}client.jar", expected_sep, expected_sep)));
    }
}
