//! Modpack import / instance export service communicating with Tauri IPC or simulating in development.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/tauri";

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
  /** What was carried over besides the files, e.g. `jvm`, `memory`, `icon`, `background`. */
  imported: string[];
}

/** What a pack file or instance folder contains, known before the import starts. */
export interface PackInspection {
  format: "mrpack" | "curseforge" | "focusite" | "folder" | "unknown";
  name: string;
  version: string;
  loader: string;
  loaderVersion?: string | null;
  fileCount: number;
  /** Estimated disk space the import needs, in bytes. */
  sizeBytes: number;
  missingCurseforgeKey: boolean;
  /** Folder the instance would be created in; differs from `name` when that name is taken. */
  folderName: string;
  imported: string[];
  /** Above 1 GiB: not opened, and the import needs the user's confirmation. */
  large?: boolean;
}

/** Progress of a running import or export. */
export interface JobProgress {
  jobId: string;
  step: string;
  message: string;
  current: number;
  total: number;
  speedBytesPerSec: number;
  /** Attempt number while a file is being retried. */
  retry?: number | null;
}

export interface ExportEntry {
  name: string;
  /** Path below the game folder, `/`-separated. */
  path: string;
  isDir: boolean;
  /** Whether the folder can be opened to pick what is inside it. */
  expandable: boolean;
  sizeBytes: number;
  defaultIncluded: boolean;
}

export const IMPORT_PROGRESS_EVENT = "modpack-import-progress";
export const EXPORT_PROGRESS_EVENT = "instance-export-progress";

export const newJobId = (): string => crypto.randomUUID();

/** Delivers the progress events of one job; resolves to the function that stops listening. */
export function listenJobProgress(
  event: string,
  jobId: string,
  onProgress: (p: JobProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<JobProgress>(event, (e) => {
    if (e.payload.jobId === jobId) onProgress(e.payload);
  });
}

export const modpackService = {
  async importModpack(packPath: string, customName?: string, importId?: string, allowLarge?: boolean): Promise<ModpackImportResult> {
    if (isTauri()) {
      return await invoke<ModpackImportResult>("import_modpack", {
        packPath,
        customName: customName || null,
        importId: importId ?? null,
        allowLarge: allowLarge ?? null,
      });
    }

    throw new Error("Modpack import is only available in the desktop app");
  },

  /** Downloads the chosen release of a Modrinth modpack project and imports it. */
  async importModrinthModpack(
    projectId: string,
    customName?: string,
    versionId?: string,
    importId?: string,
  ): Promise<ModpackImportResult> {
    if (isTauri()) {
      return await invoke<ModpackImportResult>("import_modrinth_modpack", {
        projectId,
        customName: customName || null,
        versionId: versionId || null,
        importId: importId ?? null,
      });
    }
    throw new Error("Online modpack import is only available in the desktop app");
  },

  /** Reads a pack file or instance folder without importing it. */
  async inspectModpackFile(packPath: string, customName?: string): Promise<PackInspection> {
    return await invoke<PackInspection>("inspect_modpack_file", { packPath, customName: customName || null });
  },

  /** Stops a running import or export; unknown ids are ignored. */
  async cancelJob(jobId: string): Promise<void> {
    if (isTauri()) await invoke("cancel_job", { jobId });
  },

  /** Tries the files an import could not fetch again; resolves to the ones that still fail. */
  async retryPackDownloads(instanceId: string, importId?: string): Promise<MissingModItem[]> {
    return await invoke<MissingModItem[]>("retry_pack_downloads", { instanceId, importId: importId ?? null });
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

  /** Lists a folder of the game directory (`subPath` empty = the top level). */
  async listExportEntries(instanceId: string, subPath?: string): Promise<ExportEntry[]> {
    return await invoke<ExportEntry[]>("list_export_entries", { instanceId, subPath: subPath ?? null });
  },

  /** Packs an instance into a `.zip`; resolves to the written path. */
  async exportInstance(instanceId: string, destPath: string, include: string[], exportId?: string): Promise<string> {
    return await invoke<string>("export_instance", {
      instanceId,
      destPath,
      options: { include },
      exportId: exportId ?? null,
    });
  },
};
