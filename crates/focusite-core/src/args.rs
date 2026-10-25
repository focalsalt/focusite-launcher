//! Command-line argument interpolator and builder for Minecraft launch.

use std::collections::HashMap;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_argument_interpolation() {
        let ctx = LaunchContext {
            auth_player_name: "Steve".into(),
            version_name: "1.20.4".into(),
            game_directory: "/game".into(),
            assets_root: "/assets".into(),
            assets_index_name: "1.20".into(),
            auth_uuid: "0000-0000".into(),
            auth_access_token: "token123".into(),
            user_type: "msa".into(),
            version_type: "release".into(),
            classpath: "/cp".into(),
        };

        let raw = "--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory}";
        let res = ctx.interpolate(raw);
        assert_eq!(res, "--username Steve --version 1.20.4 --gameDir /game");
    }
}
