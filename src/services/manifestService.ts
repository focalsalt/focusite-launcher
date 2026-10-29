//! Live Mojang Version Manifest service communicating with official endpoints and BMCLAPI.

import { invoke } from "@tauri-apps/api/core";

export interface VersionSummary {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  url: string;
  time: string;
  releaseTime: string;
  sha1: string;
  complianceLevel?: number;
}

export interface VersionManifestV2 {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: VersionSummary[];
}

export interface VersionManifest {
  id: string;
  type: string;
  mainClass: string;
  javaVersion?: {
    component: string;
    majorVersion: number;
  };
  assets?: string;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const manifestService = {
  /**
   * Fetches real version manifest list from Mojang or mirror.
   */
  async getVersionManifest(mirror?: "official" | "bmclapi" | "mcbbs"): Promise<VersionManifestV2> {
    const effectiveMirror =
      mirror ||
      (typeof window !== "undefined"
        ? (localStorage.getItem("focusite_download_mirror") as "official" | "bmclapi" | "mcbbs") || "official"
        : "official");

    if (isTauri()) {
      try {
        return await invoke<VersionManifestV2>("get_version_manifest", { mirror: effectiveMirror });
      } catch (err) {
        console.warn("Tauri get_version_manifest IPC failed, falling back to direct fetch:", err);
      }
    }

    const officialUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    const mirrorUrl = "https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json";
    const targetUrl = effectiveMirror === "bmclapi" ? mirrorUrl : officialUrl;

    const resp = await fetch(targetUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  },

  /**
   * Fetches details of a specific version manifest.
   */
  async getVersionDetail(url: string, mirror?: "official" | "bmclapi" | "mcbbs"): Promise<VersionManifest> {
    const effectiveMirror =
      mirror ||
      (typeof window !== "undefined"
        ? (localStorage.getItem("focusite_download_mirror") as "official" | "bmclapi" | "mcbbs") || "official"
        : "official");

    if (isTauri()) {
      try {
        return await invoke<VersionManifest>("get_version_detail", {
          versionUrl: url,
          mirror: effectiveMirror,
        });
      } catch (err) {
        console.warn("Tauri get_version_detail IPC failed, falling back to direct fetch:", err);
      }
    }

    const resp = await fetch(url);
    return await resp.json();
  },
};
