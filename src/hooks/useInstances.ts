import { useEffect, useState } from "react";
import { instanceService } from "@/services/instanceService";
import { MinecraftInstance } from "@/types/navigation";

/** Instances on disk and the selected one, kept in sync on window focus and by a 3s poll. */
export function useInstances() {
  const [instances, setInstances] = useState<MinecraftInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");

  const refreshInstances = async () => {
    try {
      const list = await instanceService.listInstances();
      // Keep the previous array when the poll found nothing new, so the whole tree does not re-render.
      setInstances((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      setSelectedInstanceId((currentId) => {
        if (!currentId && list.length > 0) return list[0].id;
        if (currentId && !list.some((i) => i.id === currentId)) {
          return list.length > 0 ? list[0].id : "";
        }
        return currentId;
      });
    } catch (err) {
      console.error("Failed to sync instances from disk:", err);
    }
  };

  useEffect(() => {
    const handleFocus = () => {
      refreshInstances();
    };
    window.addEventListener("focus", handleFocus);
    // Skip polling while the window is not focused; the focus handler catches up.
    const interval = setInterval(() => {
      if (document.hasFocus()) refreshInstances();
    }, 3000);
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, []);

  const activeInstance =
    instances.find((i) => i.id === selectedInstanceId) || instances[0] || null;

  return {
    instances,
    setInstances,
    selectedInstanceId,
    setSelectedInstanceId,
    activeInstance,
    refreshInstances,
  };
}
