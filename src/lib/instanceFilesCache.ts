import type { ModFileInfo, ScreenshotFileInfo, ServerEntry, WorldSummary } from "@/services/instanceService";
import type { PackFileInfo } from "@/types/navigation";

/** Everything the instance page lists from disk. */
export interface InstanceFiles {
  mods: ModFileInfo[];
  coremods: ModFileInfo[];
  resourcepacks: PackFileInfo[];
  shaderpacks: PackFileInfo[];
  worlds: WorldSummary[];
  servers: ServerEntry[];
  screenshots: ScreenshotFileInfo[];
}

export const EMPTY_FILES: InstanceFiles = {
  mods: [],
  coremods: [],
  resourcepacks: [],
  shaderpacks: [],
  worlds: [],
  servers: [],
  screenshots: [],
};

// Last listing per instance: opening a page again paints this at once and refreshes it in the background,
// so the skeleton only shows the first time an instance is opened.
const cache = new Map<string, InstanceFiles>();

export const getCachedFiles = (instanceId: string): InstanceFiles | undefined => cache.get(instanceId);
export const setCachedFiles = (instanceId: string, files: InstanceFiles): void => {
  cache.set(instanceId, files);
};
export const clearCachedFiles = (instanceId: string): void => {
  cache.delete(instanceId);
};
