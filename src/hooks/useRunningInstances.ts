import { useEffect, useRef, useState } from "react";
import { instanceService, InstanceStatusEvent } from "@/services/instanceService";
import { useI18n } from "@/i18n";
import { listenSafe } from "@/lib/listenSafe";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { RunningInstanceInfo, UserAccount } from "@/types/navigation";

const without = <T,>(map: Record<string, T>, id: string): Record<string, T> => {
  const next = { ...map };
  delete next[id];
  return next;
};

/** Game processes: which instances are launching or running, and how to start and stop them. */
export function useRunningInstances(activeAccount: UserAccount, defaultInstanceId: string | undefined) {
  const { t } = useI18n();
  // Several instances may run at once, but each one only once.
  const [runningInstances, setRunningInstances] = useState<Record<string, RunningInstanceInfo>>({});
  const [launchingInstanceIds, setLaunchingInstanceIds] = useState<Record<string, boolean>>({});

  // Read by the long-lived instance-status listener so it does not resubscribe on every account change.
  const activeAccountRef = useRef(activeAccount);
  activeAccountRef.current = activeAccount;

  const runningInfo = (instanceId: string, pid: number, account: UserAccount): RunningInstanceInfo => ({
    pid,
    instanceId,
    accountId: account.id,
    accountName: account.username,
  });

  // Games already running in the background.
  useEffect(() => {
    instanceService.getRunningInstances().then((list) => {
      const map: Record<string, RunningInstanceInfo> = {};
      for (const item of list) {
        map[item.instance_id] = {
          pid: item.pid,
          instanceId: item.instance_id,
          accountId: item.accountId,
          accountName: item.accountName,
        };
      }
      setRunningInstances(map);
    }).catch((err) => console.error("Failed to list running instances:", err));
  }, []);

  useEffect(
    () =>
      listenSafe<InstanceStatusEvent>("instance-status", (event) => {
        const id = event.payload.instance_id;
        if (event.payload.status === "running") {
          const info = runningInfo(id, event.payload.pid ?? 0, activeAccountRef.current);
          setRunningInstances((prev) => ({ ...prev, [id]: info }));
          setLaunchingInstanceIds((prev) => without(prev, id));
        } else if (event.payload.status === "stopped" || event.payload.status === "crashed") {
          setRunningInstances((prev) => without(prev, id));
          setLaunchingInstanceIds((prev) => without(prev, id));
        } else if (event.payload.status === "launching") {
          setLaunchingInstanceIds((prev) => ({ ...prev, [id]: true }));
        }
      }),
    []
  );

  const launchGame = async (
    id?: string,
    quickPlayType?: "singleplayer" | "multiplayer",
    quickPlayTarget?: string
  ) => {
    const targetId = id || defaultInstanceId;
    if (!targetId) return;

    // The same instance must never start twice.
    if (runningInstances[targetId]) {
      console.warn(`Instance '${targetId}' is already running; launch ignored`);
      return;
    }

    setLaunchingInstanceIds((prev) => ({ ...prev, [targetId]: true }));
    try {
      const pid = await instanceService.launchInstance(
        targetId,
        activeAccount.id,
        activeAccount.username,
        quickPlayType,
        quickPlayTarget
      );
      setRunningInstances((prev) => ({ ...prev, [targetId]: runningInfo(targetId, pid, activeAccount) }));
    } catch (err) {
      console.error("Launch instance error:", err);
      toast(t.errors.launchFailed(toUserMessage(err)), "error");
      setLaunchingInstanceIds((prev) => without(prev, targetId));
    }
  };

  const killGame = async (id?: string) => {
    const targetId = id || defaultInstanceId;
    if (!targetId || !runningInstances[targetId]) return;
    try {
      await instanceService.killInstance(targetId);
      setRunningInstances((prev) => without(prev, targetId));
    } catch (err) {
      console.error("Kill instance error:", err);
    }
  };

  return { runningInstances, launchingInstanceIds, launchGame, killGame };
}
