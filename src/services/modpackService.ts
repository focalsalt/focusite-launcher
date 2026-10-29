//! Modpack import service communicating with Tauri IPC or simulating in development.

import { invoke } from "@tauri-apps/api/core";

export interface MissingModItem {
  projectId: number;
  fileId: number;
  name: string;
  fileName: string;
  webUrl: string;
}

export interface ModpackImportResult {
  instanceId: string;
  instanceName: string;
  version: string;
  loader: string;
  missingMods: MissingModItem[];
  isCompleted: boolean;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const modpackService = {
  async importModpack(packPath: string, customName?: string): Promise<ModpackImportResult> {
    if (isTauri()) {
      return await invoke<ModpackImportResult>("import_modpack", {
        packPath,
        customName: customName || null,
      });
    }

    console.warn("[Browser Mock] importModpack called for:", packPath);
    return {
      instanceId: "mock-imported-pack",
      instanceName: customName || "Mock Modpack",
      version: "1.20.1",
      loader: "Forge",
      missingMods: [],
      isCompleted: true,
    };
  },

  async rescanMissingMods(
    instanceId: string,
    missingMods: MissingModItem[]
  ): Promise<MissingModItem[]> {
    if (isTauri()) {
      return await invoke<MissingModItem[]>("rescan_instance_missing_mods", {
        instanceId,
        missingMods,
      });
    }
    return missingMods;
  },

  async openExternalUrls(urls: string[]): Promise<void> {
    if (isTauri()) {
      await invoke("open_external_urls", { urls });
    } else {
      for (const url of urls) {
        window.open(url, "_blank");
      }
    }
  },
};
