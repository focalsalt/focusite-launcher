import { useEffect, useState } from "react";
import { instanceService, type ModFileInfo, type ModSides } from "@/services/instanceService";

/** Enabling or disabling a mod renames it, so labels are matched without the `.disabled` suffix. */
const baseName = (filename: string) => filename.replace(/\.disabled$/, "");

/**
 * Side of each mod of an instance, loaded after the list itself is shown. Previous labels stay
 * on screen while a changed list is checked again.
 */
export function useModSides(instanceId: string, mods: ModFileInfo[]) {
  const [state, setState] = useState<{ instanceId: string; result: ModSides | null } | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const listKey = mods.map((m) => baseName(m.filename)).join("/");

  useEffect(() => {
    if (!listKey) return;
    let stale = false;
    setIsChecking(true);
    instanceService
      .getModSides(instanceId)
      .then((result) => !stale && setState({ instanceId, result }))
      .catch((err) => {
        console.error("Failed to check mod sides:", err);
        if (!stale) setState({ instanceId, result: null });
      })
      .finally(() => !stale && setIsChecking(false));
    return () => {
      stale = true;
    };
  }, [instanceId, listKey]);

  const current = state?.instanceId === instanceId ? state : null;
  const byName = new Map(current?.result?.mods.map((m) => [baseName(m.filename), m]));
  return {
    isChecking,
    failed: current !== null && current.result === null,
    modrinthFailed: current?.result?.modrinthFailed ?? false,
    get: (filename: string) => byName.get(baseName(filename)),
  };
}
