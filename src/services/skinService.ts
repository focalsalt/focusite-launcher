//! Local skin management service communicating with Tauri backend.

import { invoke } from "@tauri-apps/api/core";

export interface SkinItem {
  id: string;
  filename: string;
  name: string;
  path: string;
  bytes: number[];
  blobUrl?: string;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const skinService = {
  /**
   * Lists all local skin files stored in %APPDATA%/focusite_launcher/skins/.
   */
  async listLocalSkins(): Promise<SkinItem[]> {
    if (isTauri()) {
      try {
        const list = await invoke<SkinItem[]>("skin_list_local");
        return list.map((item) => {
          const blob = new Blob([new Uint8Array(item.bytes)], {
            type: "image/png",
          });
          const blobUrl = URL.createObjectURL(blob);
          return {
            ...item,
            blobUrl,
          };
        });
      } catch (err) {
        console.error("Tauri skin_list_local failed:", err);
      }
    }
    return [];
  },

  /**
   * Saves a new skin file to %APPDATA%/focusite_launcher/skins/.
   */
  async saveLocalSkin(name: string, file: File): Promise<SkinItem> {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));

    if (isTauri()) {
      const item = await invoke<SkinItem>("skin_save_local", {
        name,
        bytes,
      });
      const blob = new Blob([new Uint8Array(item.bytes)], {
        type: "image/png",
      });
      const blobUrl = URL.createObjectURL(blob);
      return {
        ...item,
        blobUrl,
      };
    }

    throw new Error("非 Tauri 環境無法儲存實體皮膚至 %APPDATA%");
  },

  /**
   * Deletes a local skin file.
   */
  async deleteLocalSkin(filename: string): Promise<void> {
    if (isTauri()) {
      await invoke("skin_delete_local", { filename });
    }
  },
};
