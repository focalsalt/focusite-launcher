//! Modpack import service communicating with Tauri IPC or simulating in development.

import { invoke } from "@tauri-apps/api/core";

export interface MissingModItem {
  projectId: number;
  fileId: number;
  name: string;
  fileName: string;
  webUrl: string;
  /** Exact path inside the minecraft folder (set for .mrpack files). */
  relPath?: string;
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

    throw new Error("Modpack import is only available in the desktop app");
  },

  /** Downloads the newest release of a Modrinth modpack project and imports it. */
  async importModrinthModpack(projectId: string, customName?: string, versionId?: string): Promise<ModpackImportResult> {
    if (isTauri()) {
      return await invoke<ModpackImportResult>("import_modrinth_modpack", {
        projectId,
        customName: customName || null,
        versionId: versionId || null,
      });
    }
    throw new Error("Online modpack import is only available in the desktop app");
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
