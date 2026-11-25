//! Launcher settings service connecting to Tauri backend or localStorage.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";

export interface LauncherSettingsDto {
  enableBmclapiMirror: boolean;
  curseforgeApiKey?: string | null;
  soundEnabled: boolean;
  instancesDir?: string | null;
  /** Camp location (real sunrise/sunset and weather); null or missing = the user was not asked yet. */
  locationEnabled?: boolean | null;
}

const LOCAL_STORAGE_SETTINGS_KEY = "focusite_launcher_settings_v26";

/** Fired on `window` after the camp location choice changes, so the camp can react at once. */
export const LOCATION_SETTING_EVENT = "focusite:location-setting";

export const settingsService = {
  /** Folder instances are stored in right now (custom or default). */
  async getInstancesDir(): Promise<string> {
    return isTauri() ? invoke<string>("get_instances_dir_path") : "";
  },

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
    /** Empty string resets to the default folder. */
    instancesDir?: string;
    locationEnabled?: boolean;
  }): Promise<LauncherSettingsDto> {
    const notify = () => {
      if (params.locationEnabled !== undefined) window.dispatchEvent(new Event(LOCATION_SETTING_EVENT));
    };
    if (isTauri()) {
      const saved = await invoke<LauncherSettingsDto>("update_launcher_settings", {
        enableBmclapiMirror: params.enableBmclapiMirror ?? null,
        curseforgeApiKey: params.curseforgeApiKey !== undefined ? params.curseforgeApiKey : null,
        soundEnabled: params.soundEnabled ?? null,
        instancesDir: params.instancesDir ?? null,
        locationEnabled: params.locationEnabled ?? null,
      });
      notify();
      return saved;
    }
    const current = await this.getSettings();
    const updated: LauncherSettingsDto = {
      enableBmclapiMirror: params.enableBmclapiMirror ?? current.enableBmclapiMirror,
      curseforgeApiKey:
        params.curseforgeApiKey !== undefined
          ? (params.curseforgeApiKey || null)
          : current.curseforgeApiKey,
      soundEnabled: params.soundEnabled ?? current.soundEnabled,
      instancesDir: params.instancesDir !== undefined ? params.instancesDir || null : current.instancesDir,
      locationEnabled: params.locationEnabled ?? current.locationEnabled,
    };
    localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(updated));
    notify();
    return updated;
  },
};
