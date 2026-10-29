//! Launcher settings service connecting to Tauri backend or localStorage.

import { invoke } from "@tauri-apps/api/core";

export interface LauncherSettingsDto {
  enableBmclapiMirror: boolean;
  curseforgeApiKey?: string | null;
  soundEnabled: boolean;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const LOCAL_STORAGE_SETTINGS_KEY = "focusite_launcher_settings_v26";

export const settingsService = {
  async getSettings(): Promise<LauncherSettingsDto> {
    if (isTauri()) {
      try {
        return await invoke<LauncherSettingsDto>("get_launcher_settings");
      } catch (err) {
        console.error("Tauri get_launcher_settings failed:", err);
      }
    }
    const saved = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse settings from localStorage:", e);
      }
    }
    return {
      enableBmclapiMirror: false,
      curseforgeApiKey: null,
      soundEnabled: true,
    };
  },

  async updateSettings(params: {
    enableBmclapiMirror?: boolean;
    curseforgeApiKey?: string | null;
    soundEnabled?: boolean;
  }): Promise<LauncherSettingsDto> {
    if (isTauri()) {
      return await invoke<LauncherSettingsDto>("update_launcher_settings", {
        enableBmclapiMirror: params.enableBmclapiMirror ?? null,
        curseforgeApiKey: params.curseforgeApiKey !== undefined ? params.curseforgeApiKey : null,
        soundEnabled: params.soundEnabled ?? null,
      });
    }
    const current = await this.getSettings();
    const updated: LauncherSettingsDto = {
      enableBmclapiMirror: params.enableBmclapiMirror ?? current.enableBmclapiMirror,
      curseforgeApiKey:
        params.curseforgeApiKey !== undefined
          ? (params.curseforgeApiKey || null)
          : current.curseforgeApiKey,
      soundEnabled: params.soundEnabled ?? current.soundEnabled,
    };
    localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  },
};
