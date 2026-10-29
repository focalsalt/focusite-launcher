//! Real download service handling live chunked download events and backend IPC.

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface DownloadProgressPayload {
  version_id: string;
  downloaded_bytes: number;
  total_bytes: number | null;
  speed_bytes_per_sec: number;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const downloadService = {
  /**
   * Triggers client jar download in backend.
   */
  async downloadVersionClient(versionId: string, mirror?: string): Promise<string> {
    const effectiveMirror =
      mirror ||
      (typeof window !== "undefined"
        ? localStorage.getItem("focusite_download_mirror") || "official"
        : "official");

    if (isTauri()) {
      return await invoke<string>("download_version_client", {
        versionId,
        mirror: effectiveMirror,
      });
    }
    return `Simulated download complete for ${versionId}`;
  },

  /**
   * Listens for download progress updates from Tokio downloader.
   */
  async onProgress(
    callback: (payload: DownloadProgressPayload) => void
  ): Promise<UnlistenFn | (() => void)> {
    if (isTauri()) {
      return await listen<DownloadProgressPayload>("download-progress", (event) => {
        callback(event.payload);
      });
    }
    return () => {};
  },

  /**
   * Listens for download finished events.
   */
  async onFinished(callback: (versionId: string) => void): Promise<UnlistenFn | (() => void)> {
    if (isTauri()) {
      return await listen<string>("download-finished", (event) => {
        callback(event.payload);
      });
    }
    return () => {};
  },
};
