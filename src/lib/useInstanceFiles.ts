import { SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { instanceService } from "@/services/instanceService";
import type { MinecraftInstance } from "@/types/navigation";
import { EMPTY_FILES, getCachedFiles, InstanceFiles, setCachedFiles } from "@/lib/instanceFilesCache";

async function listFiles(instance: MinecraftInstance): Promise<InstanceFiles> {
  const caps = instance.capabilities;
  const [mods, coremods, worlds, servers, screenshots, resourcepacks, shaderpacks] = await Promise.all([
    instanceService.listInstanceMods(instance.id),
    caps?.modsTabMode === "legacydualnav" ? instanceService.listInstanceCoremods(instance.id) : Promise.resolve([]),
    instanceService.listInstanceWorlds(instance.id).catch(() => []),
    instanceService.readInstanceServers(instance.id).catch(() => []),
    instanceService.listInstanceScreenshots(instance.id),
    instanceService.listInstanceResourcepacks(instance.id),
    (caps?.supportsShaderpacks ?? true) ? instanceService.listInstanceShaderpacks(instance.id) : Promise.resolve([]),
  ]);
  return { mods, coremods, worlds, servers, screenshots, resourcepacks, shaderpacks };
}

/**
 * Files of one instance, cached per instance. `isLoading` is true only while nothing is known yet, so a
 * page that was opened before shows its last listing immediately while it refreshes in the background.
 */
export function useInstanceFiles(instance: MinecraftInstance | null) {
  const id = instance?.id;
  const [files, setFiles] = useState<InstanceFiles>(() => (id && getCachedFiles(id)) || EMPTY_FILES);
  const [isLoading, setIsLoading] = useState<boolean>(() => !!id && !getCachedFiles(id));
  const idRef = useRef(id);
  idRef.current = id;

  const refresh = useCallback(async () => {
    if (!instance) return;
    try {
      const next = await listFiles(instance);
      // Ignore a listing that arrives after the user moved to another instance.
      if (idRef.current !== instance.id) return;
      setCachedFiles(instance.id, next);
      setFiles(next);
    } catch (err) {
      console.error("Failed to list instance files:", err);
    } finally {
      if (idRef.current === instance.id) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id, instance?.capabilities]);

  useEffect(() => {
    if (!id) return;
    const cached = getCachedFiles(id);
    setFiles(cached ?? EMPTY_FILES);
    setIsLoading(!cached);
    void refresh();
  }, [id, refresh]);

  /** Updates one list (like useState's setter) and keeps the cache in step. */
  const patch = useCallback(
    <K extends keyof InstanceFiles>(key: K, value: SetStateAction<InstanceFiles[K]>) => {
      setFiles((prev) => {
        const nextValue = typeof value === "function" ? (value as (p: InstanceFiles[K]) => InstanceFiles[K])(prev[key]) : value;
        const next = { ...prev, [key]: nextValue };
        if (idRef.current) setCachedFiles(idRef.current, next);
        return next;
      });
    },
    [],
  );

  return { files, isLoading, refresh, patch };
}
