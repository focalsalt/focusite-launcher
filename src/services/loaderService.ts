//! Loader version service fetching live metadata from official endpoints via Tauri IPC or direct fetch fallback.

import { invoke } from "@tauri-apps/api/core";
import { LoaderType } from "@/types/navigation";

export interface LoaderVersionOption {
  version: string;
  isRecommended?: boolean;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

// In-memory cache for (loader, mcVersion, mirror)
const cache: Record<string, LoaderVersionOption[]> = {};

export const loaderService = {
  /**
   * Fetches real loader versions for a specific Minecraft version.
   */
  async getLoaderVersions(
    loader: LoaderType,
    mcVersion: string,
    mirror?: "official" | "bmclapi" | "mcbbs"
  ): Promise<LoaderVersionOption[]> {
    if (loader === "Vanilla" || loader === "Custom") {
      return [];
    }

    const cacheKey = `${loader}:${mcVersion}:${mirror || "official"}`;
    if (cache[cacheKey]) {
      return cache[cacheKey];
    }

    if (isTauri()) {
      try {
        const versions = await invoke<LoaderVersionOption[]>("get_loader_versions", {
          loader,
          mcVersion,
          mirror,
        });
        cache[cacheKey] = versions;
        return versions;
      } catch (err) {
        console.warn("Tauri get_loader_versions IPC failed, falling back to direct fetch:", err);
      }
    }

    // Direct browser fetch fallback
    try {
      let versions: LoaderVersionOption[] = [];
      if (loader === "Fabric") {
        const resp = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
        if (resp.ok) {
          const data = await resp.json();
          let recFound = false;
          versions = data.map((item: { loader: { version: string; stable?: boolean } }) => {
            const isRec = !recFound && Boolean(item.loader.stable);
            if (isRec) recFound = true;
            return {
              version: item.loader.version,
              isRecommended: isRec,
            };
          });
          if (!recFound && versions.length > 0) {
            versions[0].isRecommended = true;
          }
        }
      } else if (loader === "Quilt") {
        const resp = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`);
        if (resp.ok) {
          const data = await resp.json();
          versions = data.map((item: { loader: { version: string } }, idx: number) => ({
            version: item.loader.version,
            isRecommended: idx === 0,
          }));
        }
      } else if (loader === "NeoForge") {
        const resp = await fetch("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml");
        if (resp.ok) {
          const xml = await resp.text();
          const parts = mcVersion.split(".");
          const prefix =
            parts.length >= 2 && parts[0] === "1"
              ? `${parts[1]}.${parts[2] || "0"}.`
              : `${mcVersion}.`;
          const allVersions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
            .map((m) => m[1].trim())
            .filter((v) => v.startsWith(prefix))
            .reverse();
          versions = allVersions.map((v, idx) => ({
            version: v,
            isRecommended: idx === 0,
          }));
        }
      } else if (loader === "Forge") {
        const promoResp = await fetch("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json");
        if (promoResp.ok) {
          const promoData = await promoResp.json();
          const rec = promoData.promos?.[`${mcVersion}-recommended`];
          const lat = promoData.promos?.[`${mcVersion}-latest`];
          if (rec) {
            versions.push({ version: rec, isRecommended: true });
            if (lat && lat !== rec) {
              versions.push({ version: lat, isRecommended: false });
            }
          } else if (lat) {
            versions.push({ version: lat, isRecommended: true });
          }
        }
      }

      cache[cacheKey] = versions;
      return versions;
    } catch (e) {
      console.error(`Failed to fetch ${loader} versions for ${mcVersion}:`, e);
      return [];
    }
  },
};
