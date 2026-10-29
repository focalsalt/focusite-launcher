//! Real instance service communicating with Tauri backend or local filesystem storage.

import { invoke } from "@tauri-apps/api/core";
import { LoaderType, MinecraftInstance, PackFileInfo } from "@/types/navigation";

export interface ModFileInfo {
  filename: string;
  size_bytes: number;
  enabled: boolean;
}

export interface ScreenshotFileInfo {
  name: string;
  path: string;
  created_at: string;
}

export interface CreateInstanceParams {
  name: string;
  version: string;
  loader: LoaderType;
  loaderVersion?: string;
  description?: string;
  iconBytes?: number[] | Uint8Array;
  customJarName?: string;
  customJarBytes?: number[] | Uint8Array;
}

export interface JavaInstallationDto {
  path: string;
  major_version: number;
  version_string: string;
  vendor: string;
  is_64_bit: boolean;
  is_managed: boolean;
}

export interface InstanceLogEvent {
  instance_id: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  timestamp: number;
}

export interface InstanceStatusEvent {
  instance_id: string;
  status: "launching" | "running" | "stopped" | "crashed";
  exit_code?: number | null;
  pid?: number | null;
}

const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const LOCAL_STORAGE_KEY = "focusite_instances_v26";

export const instanceService = {
  /**
   * Fetches real instances from disk via Tauri IPC or persistent local storage.
   */
  async listInstances(): Promise<MinecraftInstance[]> {
    if (isTauri()) {
      try {
        return await invoke<MinecraftInstance[]>("list_instances");
      } catch (err) {
        console.error("Tauri list_instances failed:", err);
      }
    }

    // Browser development persistence (no fake seed data)
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved instances:", e);
      }
    }

    return [];
  },

  /**
   * Creates a real instance on disk with optional icon, loader version, description, and custom loader jar.
   */
  async createInstance(params: CreateInstanceParams): Promise<MinecraftInstance> {
    const {
      name,
      version,
      loader,
      loaderVersion,
      description,
      iconBytes,
      customJarName,
      customJarBytes,
    } = params;

    if (isTauri()) {
      return await invoke<MinecraftInstance>("create_instance", {
        name,
        version,
        loader,
        loaderVersion: loaderVersion || null,
        description: description || null,
        iconBytes: iconBytes ? Array.from(iconBytes) : null,
        customJarName: customJarName || null,
        customJarBytes: customJarBytes ? Array.from(customJarBytes) : null,
      });
    }

    const id = name.trim().replace(/[<>:"/\\|?*]/g, "_") || `inst-${Date.now()}`;
    const newInst: MinecraftInstance = {
      id,
      name,
      version,
      loader,
      loaderVersion,
      description,
      hasIcon: !!iconBytes,
      modCount: 0,
      lastPlayed: "尚未遊玩",
      isFavorite: false,
    };

    const current = await this.listInstances();
    const updated = [...current, newInst];
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
    return newInst;
  },

  /**
   * Renames an instance, optionally renaming the underlying disk folder.
   */
  async renameInstance(
    currentId: string,
    newName: string,
    renameFolder: boolean
  ): Promise<MinecraftInstance> {
    if (isTauri()) {
      return await invoke<MinecraftInstance>("rename_instance", {
        currentId,
        newName,
        renameFolder,
      });
    }

    const current = await this.listInstances();
    const target = current.find((it) => it.id === currentId);
    if (!target) {
      throw new Error(`Instance ${currentId} not found`);
    }

    const finalId = renameFolder ? newName.trim().replace(/[<>:"/\\|?*]/g, "_") : currentId;
    const updated: MinecraftInstance = {
      ...target,
      id: finalId,
      name: newName,
    };

    const nextList = current.map((it) => (it.id === currentId ? updated : it));
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextList));
    return updated;
  },

  /**
   * Opens the instance directory or a subfolder in native OS file explorer.
   */
  async openInstanceDirectory(
    instanceId: string,
    target: "mods" | "coremods" | "saves" | "screenshots" | "resourcepacks" | "texturepacks" | "shaderpacks" | "minecraft" | "root" = "root"
  ): Promise<void> {
    if (isTauri()) {
      try {
        await invoke("open_instance_directory", { instanceId, target });
      } catch (err) {
        console.error("Tauri open_instance_directory failed:", err);
      }
    } else {
      console.log(`[Browser Mock] Open directory for ${instanceId}: ${target}`);
    }
  },

  /**
   * Toggles a mod's enabled state by renaming .jar <-> .jar.disabled.
   */
  async toggleModState(
    instanceId: string,
    filename: string,
    enabled: boolean
  ): Promise<void> {
    if (isTauri()) {
      await invoke("toggle_mod_state", {
        instanceId,
        filename,
        enabled,
      });
    }
  },

  /**
   * Removes an instance from disk.
   */
  async deleteInstance(id: string): Promise<void> {
    if (isTauri()) {
      try {
        await invoke("delete_instance", { id });
        return;
      } catch (err) {
        console.error("Tauri delete_instance failed:", err);
      }
    }

    const current = await this.listInstances();
    const updated = current.filter((it) => it.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  },

  /**
   * Scans and returns all mods in the instance's mods directory.
   */
  async listInstanceMods(instanceId: string): Promise<ModFileInfo[]> {
    if (isTauri()) {
      try {
        return await invoke<ModFileInfo[]>("list_instance_mods", {
          instanceId,
        });
      } catch (err) {
        console.error("Tauri list_instance_mods failed:", err);
      }
    }
    return [];
  },

  /**
   * Scans and returns world saves names in the instance's saves directory.
   */
  async listInstanceSaves(instanceId: string): Promise<string[]> {
    if (isTauri()) {
      try {
        return await invoke<string[]>("list_instance_saves", {
          instanceId,
        });
      } catch (err) {
        console.error("Tauri list_instance_saves failed:", err);
      }
    }
    return [];
  },

  /**
   * Scans and returns screenshots in the instance's screenshots directory.
   */
  async listInstanceScreenshots(instanceId: string): Promise<ScreenshotFileInfo[]> {
    if (isTauri()) {
      try {
        return await invoke<ScreenshotFileInfo[]>("list_instance_screenshots", {
          instanceId,
        });
      } catch (err) {
        console.error("Tauri list_instance_screenshots failed:", err);
      }
    }
    return [];
  },

  /**
   * Reads real logs from .minecraft/logs/latest.log.
   */
  async getInstanceLog(instanceId: string): Promise<string> {
    if (isTauri()) {
      try {
        return await invoke<string>("get_instance_log", {
          instanceId,
        });
      } catch (err) {
        console.error("Tauri get_instance_log failed:", err);
      }
    }
    return "";
  },

  /**
   * Scans and returns detected system Java environments.
   */
  async listSystemJavas(): Promise<JavaInstallationDto[]> {
    if (isTauri()) {
      try {
        return await invoke<JavaInstallationDto[]>("list_system_javas");
      } catch (err) {
        console.error("Tauri list_system_javas failed:", err);
      }
    }
    return [];
  },

  /**
   * Launches Minecraft for the specified instance ID, returning process PID.
   */
  async launchInstance(
    instanceId: string,
    accountId?: string,
    accountName?: string
  ): Promise<number> {
    if (isTauri()) {
      return await invoke<number>("launch_instance", {
        instanceId,
        accountId: accountId || null,
        accountName: accountName || null,
      });
    }
    console.warn("Simulating launch in browser development mode");
    return 9999;
  },

  /**
   * Force kills a running instance process tree.
   */
  async killInstance(instanceId: string): Promise<void> {
    if (isTauri()) {
      await invoke("kill_instance", { instanceId });
    }
  },

  /**
   * Gets the running status of an instance if active.
   */
  async getInstanceRunningStatus(
    instanceId: string
  ): Promise<{ pid: number; instance_id: string; accountId?: string; accountName?: string } | null> {
    if (isTauri()) {
      try {
        return await invoke("get_instance_running_status", {
          instanceId,
        });
      } catch (err) {
        console.error("Tauri get_instance_running_status failed:", err);
      }
    }
    return null;
  },

  /**
   * Returns all actively running instances across the launcher.
   */
  async getRunningInstances(): Promise<
    Array<{ pid: number; instance_id: string; accountId?: string; accountName?: string }>
  > {
    if (isTauri()) {
      try {
        return await invoke("get_running_instances");
      } catch (err) {
        console.error("Tauri get_running_instances failed:", err);
      }
    }
    return [];
  },

  /**
   * Updates an instance's settings and immediately persists to instance.cfg.
   */
  async updateInstanceSettings(
    instanceId: string,
    settings: {
      minMemoryMb?: number;
      maxMemoryMb?: number;
      javaPath?: string | null;
      jvmArgs?: string[];
      showLogOnLaunch?: boolean;
    }
  ): Promise<MinecraftInstance> {
    if (isTauri()) {
      return await invoke<MinecraftInstance>("update_instance_settings", {
        instanceId,
        minMemoryMb: settings.minMemoryMb ?? null,
        maxMemoryMb: settings.maxMemoryMb ?? null,
        javaPath: settings.javaPath !== undefined ? (settings.javaPath === null ? "" : settings.javaPath) : null,
        jvmArgs: settings.jvmArgs ?? null,
        showLogOnLaunch: settings.showLogOnLaunch ?? null,
      });
    }

    const current = await this.listInstances();
    const target = current.find((it) => it.id === instanceId);
    if (!target) throw new Error(`Instance ${instanceId} not found`);
    const updated: MinecraftInstance = {
      ...target,
      minMemoryMb: settings.minMemoryMb ?? target.minMemoryMb,
      maxMemoryMb: settings.maxMemoryMb ?? target.maxMemoryMb,
      javaPath: settings.javaPath !== undefined ? (settings.javaPath ?? undefined) : target.javaPath,
      jvmArgs: settings.jvmArgs ?? target.jvmArgs,
      showLogOnLaunch: settings.showLogOnLaunch ?? target.showLogOnLaunch,
    };
    const nextList = current.map((it) => (it.id === instanceId ? updated : it));
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextList));
    return updated;
  },

  /**
   * Duplicates an existing instance with CAS hardlink optimization.
   */
  async duplicateInstance(sourceId: string, newName: string): Promise<MinecraftInstance> {
    if (isTauri()) {
      return await invoke<MinecraftInstance>("duplicate_instance", {
        sourceId,
        newName,
      });
    }

    const current = await this.listInstances();
    const source = current.find((it) => it.id === sourceId);
    if (!source) throw new Error(`Instance ${sourceId} not found`);
    const newId = newName.trim().replace(/[<>:"/\\|?*]/g, "_") || `inst-${Date.now()}`;
    const duplicated: MinecraftInstance = {
      ...source,
      id: newId,
      name: newName,
      lastPlayed: "尚未遊玩",
    };
    const nextList = [...current, duplicated];
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(nextList));
    return duplicated;
  },

  /**
   * Lists coremods in minecraft/coremods/ for Minecraft 1.2.5 ~ 1.5.2 Forge instances.
   */
  async listInstanceCoremods(instanceId: string): Promise<ModFileInfo[]> {
    if (isTauri()) {
      try {
        return await invoke<ModFileInfo[]>("list_instance_coremods", { instanceId });
      } catch (err) {
        console.error("Tauri list_instance_coremods failed:", err);
      }
    }
    return [];
  },

  /**
   * Toggles coremod state between .jar and .jar.disabled.
   */
  async toggleCoremodState(instanceId: string, filename: string, enabled: boolean): Promise<void> {
    if (isTauri()) {
      await invoke("toggle_coremod_state", { instanceId, filename, enabled });
    }
  },

  /**
   * Scans and returns resourcepacks or texturepacks based on instance capabilities.
   */
  async listInstanceResourcepacks(instanceId: string): Promise<PackFileInfo[]> {
    if (isTauri()) {
      try {
        return await invoke<PackFileInfo[]>("list_instance_resourcepacks", { instanceId });
      } catch (err) {
        console.error("Tauri list_instance_resourcepacks failed:", err);
      }
    }
    return [];
  },

  /**
   * Scans and returns shaderpacks in minecraft/shaderpacks/.
   */
  async listInstanceShaderpacks(instanceId: string): Promise<PackFileInfo[]> {
    if (isTauri()) {
      try {
        return await invoke<PackFileInfo[]>("list_instance_shaderpacks", { instanceId });
      } catch (err) {
        console.error("Tauri list_instance_shaderpacks failed:", err);
      }
    }
    return [];
  },

  /**
   * Updates an instance's preference for showing the console window on launch.
   */
  async setInstanceShowLog(instanceId: string, showLog: boolean): Promise<void> {
    if (isTauri()) {
      try {
        await invoke("set_instance_show_log", { instanceId, showLog });
      } catch (err) {
        console.error("Tauri set_instance_show_log failed:", err);
      }
    }
  },
};
