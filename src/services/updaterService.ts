import { check, Update } from "@tauri-apps/plugin-updater";

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  version?: string;
  body?: string;
  date?: string;
}

let pendingUpdate: Update | null = null;

export const updaterService = {
  /** Throws on network/signature errors so the UI can tell "failed" apart from "up to date". */
  checkForUpdates: async (): Promise<UpdateCheckResult> => {
    const update = await check();
    if (update?.available) {
      pendingUpdate = update;
      return {
        available: true,
        currentVersion: update.currentVersion,
        version: update.version,
        body: update.body || undefined,
        date: update.date || undefined,
      };
    }
    pendingUpdate = null;
    return { available: false, currentVersion: "" };
  },

  downloadAndInstall: async (
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<void> => {
    if (!pendingUpdate) {
      throw new Error("沒有待安裝的更新版本");
    }

    let downloaded = 0;
    let total = 0;

    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength || 0;
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          if (onProgress && total > 0) {
            onProgress(downloaded, total);
          }
          break;
        case "Finished":
          break;
      }
    });

    pendingUpdate = null;
  },
};
