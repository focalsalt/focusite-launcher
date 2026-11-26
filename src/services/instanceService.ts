//! Real instance service communicating with Tauri backend or local filesystem storage.

import { invoke } from "@tauri-apps/api/core";
import { LoaderType, MinecraftInstance, PackFileInfo } from "@/types/navigation";
import { isTauri } from "@/lib/tauri";

export interface ModFileInfo {
  filename: string;
  sizeBytes: number;
  size_bytes?: number;
  enabled: boolean;
}

export interface ScreenshotFileInfo {
  name: string;
  path: string;
  createdAt: string;
  created_at?: string;
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

export interface WorldSummary {
  folder_name: string;
  name: string;
  seed: string;
  game_mode: number;
  is_hardcore: boolean;
  last_played: number;
  version_name: string;
  icon_base64?: string;
}

export interface LogFileEntry {
  name: string;
  kind: "log" | "crash";
  size: number;
  /** Modification time, Unix epoch milliseconds. */
  modified: number;
}

export interface DatapackEntry {
  file_name: string;
  is_dir: boolean;
  size_bytes: number;
}

export interface ServerEntry {
  name: string;
  ip: string;
  icon_base64?: string;
}

export interface ServerPingResult {
  motd: string;
  online_players: number;
  max_players: number;
  version_name: string;
  protocol_version: number;
  latency_ms: number;
  favicon_base64?: string;
}

const LOCAL_STORAGE_KEY = "focusite_instances_v26";

export const instanceService = {
  /**
   * Fetches real instances from disk via Tauri IPC or persistent local storage.
   */
  async listInstances(): Promise<MinecraftInstance[]> {
    if (isTauri()) {
      return await invoke<MinecraftInstance[]>("list_instances");
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
  /** Jar file names stored in the instance's `custom_jar` folder. */
  async listCustomJars(instanceId: string): Promise<string[]> {
    return await invoke<string[]>("list_custom_jars", { instanceId });
  },

  /** Saves a custom loader jar into the instance's `custom_jar` folder; returns the stored name. */
  async saveCustomJar(instanceId: string, name: string, bytes: number[]): Promise<string> {
    return await invoke<string>("save_custom_jar", { instanceId, name, bytes });
  },

  /** First-time setup of a folder that has no config of ours. */
  async setupInstance(params: {
    instanceId: string;
    name: string;
    version: string;
    loader: LoaderType;
    loaderVersion?: string;
  }): Promise<MinecraftInstance> {
    return await invoke<MinecraftInstance>("setup_instance", {
      instanceId: params.instanceId,
      name: params.name,
      version: params.version,
      loader: params.loader,
      loaderVersion: params.loaderVersion || null,
    });
  },

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
      await invoke("open_instance_directory", { instanceId, target });
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
      await invoke("delete_instance", { id });
      return;
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
      return await invoke<ModFileInfo[]>("list_instance_mods", {
        instanceId,
      });
    }
    return [];
  },


  /**
   * Scans and returns screenshots in the instance's screenshots directory.
   */
  async listInstanceScreenshots(instanceId: string): Promise<ScreenshotFileInfo[]> {
    if (isTauri()) {
      return await invoke<ScreenshotFileInfo[]>("list_instance_screenshots", {
        instanceId,
      });
    }
    return [];
  },


  /**
   * Scans and returns detected system Java environments.
   */
  async listSystemJavas(): Promise<JavaInstallationDto[]> {
    if (isTauri()) {
      return await invoke<JavaInstallationDto[]>("list_system_javas");
    }
    return [];
  },

  /**
   * Launches Minecraft for the specified instance ID, returning process PID.
   * Supports Quick Play singleplayer/multiplayer direct launch.
   */
  async launchInstance(
    instanceId: string,
    accountId?: string,
    accountName?: string,
    quickPlayType?: "singleplayer" | "multiplayer",
    quickPlayTarget?: string
  ): Promise<number> {
    if (isTauri()) {
      return await invoke<number>("launch_instance", {
        instanceId,
        accountId: accountId || null,
        accountName: accountName || null,
        quickPlayType: quickPlayType || null,
        quickPlayTarget: quickPlayTarget || null,
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
      return await invoke("get_instance_running_status", {
        instanceId,
      });
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
      return await invoke("get_running_instances");
    }
    return [];
  },

  /**
   * Updates an instance's settings and immediately persists to focusite-instance.json.
   */
  async updateInstanceSettings(
    instanceId: string,
    settings: {
      minMemoryMb?: number;
      maxMemoryMb?: number;
      javaPath?: string | null;
      jvmArgs?: string[];
      showLogOnLaunch?: boolean;
      /** Both 0 clears the stored size. */
      windowWidth?: number;
      windowHeight?: number;
      group?: string;
      customJvmArgs?: string[];
      environmentVars?: Record<string, string>;
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
        windowWidth: settings.windowWidth ?? null,
        windowHeight: settings.windowHeight ?? null,
        group: settings.group !== undefined ? settings.group : null,
        customJvmArgs: settings.customJvmArgs ?? null,
        environmentVars: settings.environmentVars ?? null,
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
      windowWidth: settings.windowWidth ? settings.windowWidth : settings.windowWidth === 0 ? undefined : target.windowWidth,
      windowHeight: settings.windowHeight ? settings.windowHeight : settings.windowHeight === 0 ? undefined : target.windowHeight,
      group: settings.group !== undefined ? settings.group : target.group,
      customJvmArgs: settings.customJvmArgs ?? target.customJvmArgs,
      environmentVars: settings.environmentVars ?? target.environmentVars,
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
      return await invoke<ModFileInfo[]>("list_instance_coremods", { instanceId });
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
      return await invoke<PackFileInfo[]>("list_instance_resourcepacks", { instanceId });
    }
    return [];
  },

  /**
   * Scans and returns shaderpacks in minecraft/shaderpacks/.
   */
  async listInstanceShaderpacks(instanceId: string): Promise<PackFileInfo[]> {
    if (isTauri()) {
      return await invoke<PackFileInfo[]>("list_instance_shaderpacks", { instanceId });
    }
    return [];
  },


  /**
   * Fetches the in-memory buffered logs for a specific instance.
   */
  async getInstanceLogBuffer(instanceId: string): Promise<InstanceLogEvent[]> {
    if (isTauri()) {
      return await invoke<InstanceLogEvent[]>("get_instance_log_buffer", { instanceId });
    }
    return [];
  },


  /**
   * Sets instance icon from a local image file (PNG/JPG/WebP/ICO/GIF).
   */
  async setInstanceIconFromFile(instanceId: string, sourceImagePath: string): Promise<MinecraftInstance> {
    return await invoke<MinecraftInstance>("set_instance_icon_from_file", {
      instanceId,
      sourceImagePath,
    });
  },

  /**
   * Sets instance icon from a built-in curated preset key.
   */
  async setInstancePresetIcon(instanceId: string, presetKey: string, pngBytes?: number[]): Promise<MinecraftInstance> {
    return await invoke<MinecraftInstance>("set_instance_preset_icon", {
      pngBytes: pngBytes ?? null,
      instanceId,
      presetKey,
    });
  },

  /**
   * Resets instance icon back to default.
   */
  async setInstanceBackground(instanceId: string, sourcePath: string): Promise<MinecraftInstance> {
    return await invoke<MinecraftInstance>("set_instance_background", { instanceId, sourcePath });
  },

  async resetInstanceBackground(instanceId: string): Promise<MinecraftInstance> {
    return await invoke<MinecraftInstance>("reset_instance_background", { instanceId });
  },

  async resetInstanceIcon(instanceId: string): Promise<MinecraftInstance> {
    return await invoke<MinecraftInstance>("reset_instance_icon", {
      instanceId,
    });
  },

  /**
   * Retrieves a specific instance by its ID.
   */
  async getInstance(instanceId: string): Promise<MinecraftInstance | null> {
    const instances = await this.listInstances();
    return instances.find((i) => i.id === instanceId) ?? null;
  },

  /**
   * Lists worlds parsed from level.dat in saves/ directory.
   */
  async listInstanceWorlds(instanceId: string): Promise<WorldSummary[]> {
    if (isTauri()) {
      return await invoke<WorldSummary[]>("list_instance_worlds_cmd", { instanceId });
    }
    return [];
  },

  /**
   * Renames a Minecraft world level name.
   */
  async renameInstanceWorld(instanceId: string, folderName: string, newName: string): Promise<void> {
    if (isTauri()) {
      await invoke("rename_instance_world_cmd", { instanceId, folderName, newName });
    }
  },

  /**
   * Deletes a world save folder.
   */
  async openInstanceLogWindow(instanceId: string): Promise<void> {
    if (isTauri()) {
      await invoke("open_instance_log_window", { instanceId });
    }
  },

  async listInstanceLogFiles(instanceId: string): Promise<LogFileEntry[]> {
    if (isTauri()) {
      return await invoke<LogFileEntry[]>("list_instance_log_files", { instanceId });
    }
    return [];
  },

  async readInstanceLogFile(instanceId: string, kind: LogFileEntry["kind"], name: string): Promise<string> {
    return await invoke<string>("read_instance_log_file", { instanceId, kind, name });
  },

  async listWorldDatapacks(instanceId: string, folderName: string): Promise<DatapackEntry[]> {
    if (isTauri()) {
      return await invoke<DatapackEntry[]>("list_world_datapacks_cmd", { instanceId, folderName });
    }
    return [];
  },

  async deleteWorldDatapack(instanceId: string, folderName: string, packName: string): Promise<void> {
    if (isTauri()) {
      await invoke("delete_world_datapack_cmd", { instanceId, folderName, packName });
    }
  },

  async openWorldDatapacksDir(instanceId: string, folderName: string): Promise<void> {
    if (isTauri()) {
      await invoke("open_world_datapacks_dir_cmd", { instanceId, folderName });
    }
  },

  async deleteInstanceWorld(instanceId: string, folderName: string): Promise<void> {
    if (isTauri()) {
      await invoke("delete_instance_world_cmd", { instanceId, folderName });
    }
  },

  /**
   * Backs up a world into a zip file.
   */
  async backupInstanceWorld(instanceId: string, folderName: string, targetZipPath: string): Promise<void> {
    if (isTauri()) {
      await invoke("backup_instance_world_cmd", { instanceId, folderName, targetZipPath });
    }
  },

  /**
   * Reads the server entries from servers.dat.
   */
  async readInstanceServers(instanceId: string): Promise<ServerEntry[]> {
    if (isTauri()) {
      return await invoke<ServerEntry[]>("read_instance_servers_cmd", { instanceId });
    }
    return [];
  },

  /**
   * Saves the server entries back to servers.dat.
   */
  async saveInstanceServers(instanceId: string, servers: ServerEntry[]): Promise<void> {
    if (isTauri()) {
      await invoke("save_instance_servers_cmd", { instanceId, servers });
    }
  },

  /**
   * Pings a Minecraft server using TCP SLP protocol.
   */
  async pingServer(host: string, port?: number): Promise<ServerPingResult> {
    if (isTauri()) {
      return await invoke<ServerPingResult>("ping_server_cmd", { host, port: port || null });
    }
    throw new Error("pingServer is only available in desktop environment");
  },
};
