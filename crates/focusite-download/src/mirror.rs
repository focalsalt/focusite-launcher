//! Mirror fallback and dynamic URL rewriting for official Minecraft services.

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MirrorProvider {
    Official,
    Bmclapi,
    Mcbbs,
}

pub struct MirrorManager;

impl MirrorManager {
    /// Rewrites an official Mojang URL to a selected mirror equivalent.
    pub fn rewrite_url(url: &str, mirror: MirrorProvider) -> String {
        match mirror {
            MirrorProvider::Official => url.to_string(),
            MirrorProvider::Bmclapi => {
                url.replace("https://launchermeta.mojang.com", "https://bmclapi2.bangbang93.com")
                    .replace("https://launcher.mojang.com", "https://bmclapi2.bangbang93.com")
                    .replace("https://piston-meta.mojang.com", "https://bmclapi2.bangbang93.com")
                    .replace("https://piston-data.mojang.com", "https://bmclapi2.bangbang93.com")
                    .replace("https://resources.download.minecraft.net", "https://bmclapi2.bangbang93.com/assets")
                    .replace("https://libraries.minecraft.net", "https://bmclapi2.bangbang93.com/maven")
            }
            MirrorProvider::Mcbbs => {
                url.replace("https://launchermeta.mojang.com", "https://download.mcbbs.net")
                    .replace("https://launcher.mojang.com", "https://download.mcbbs.net")
                    .replace("https://piston-meta.mojang.com", "https://download.mcbbs.net")
                    .replace("https://piston-data.mojang.com", "https://download.mcbbs.net")
                    .replace("https://resources.download.minecraft.net", "https://download.mcbbs.net/assets")
                    .replace("https://libraries.minecraft.net", "https://download.mcbbs.net/maven")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bmclapi_rewrite() {
        let original = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
        let rewritten = MirrorManager::rewrite_url(original, MirrorProvider::Bmclapi);
        assert_eq!(rewritten, "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json");

        let piston = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
        let piston_rewritten = MirrorManager::rewrite_url(piston, MirrorProvider::Bmclapi);
        assert_eq!(piston_rewritten, "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json");

        let asset = "https://resources.download.minecraft.net/ab/abcdef123";
        let asset_rewritten = MirrorManager::rewrite_url(asset, MirrorProvider::Bmclapi);
        assert_eq!(asset_rewritten, "https://bmclapi2.bangbang93.com/assets/ab/abcdef123");

        let lib = "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar";
        let lib_rewritten = MirrorManager::rewrite_url(lib, MirrorProvider::Bmclapi);
        assert_eq!(lib_rewritten, "https://bmclapi2.bangbang93.com/maven/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar");
    }
}
