import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { instanceService } from "@/services/instanceService";
import { p2pService } from "@/services/p2pService";
import { partyService, type ShareSpec } from "@/services/partyService";

const AUTO_SHARE_KEY = "focusite_auto_share_world";

export const getAutoShare = (): boolean => {
  try {
    return localStorage.getItem(AUTO_SHARE_KEY) !== "0";
  } catch {
    return true;
  }
};

export const setAutoShare = (value: boolean): void => {
  try {
    localStorage.setItem(AUTO_SHARE_KEY, value ? "1" : "0");
  } catch {
    // The choice just is not remembered.
  }
};

/**
 * While in a party, watches for a world the game opened to LAN and shares it with the party (and stops
 * sharing when the world closes). Returns the cleanup.
 */
export const initWorldSharing = (): (() => void) => {
  let port: number | null = null;
  let watching = false;
  let busy = false;

  const sync = async () => {
    if (busy) return;
    const party = partyService.getSnapshot();
    const mine = party.shares.some((x) => x.by === party.self);
    if (port === null) {
      if (mine) partyService.unshare();
      return;
    }
    if (party.status !== "connected" || mine || !getAutoShare()) return;
    busy = true;
    try {
      // The LAN packet does not say which instance sent it; the running game is the one that did.
      const running = await instanceService.getRunningInstances();
      const instanceId = running[0]?.instance_id;
      if (!instanceId) return;
      const spec = await invoke<ShareSpec>("instance_share_spec", { instanceId });
      if (port !== null && !partyService.getSnapshot().shares.some((x) => x.by === party.self)) partyService.share(spec, port, instanceId);
    } catch (e) {
      console.warn("Could not share the world:", e);
    } finally {
      busy = false;
    }
  };

  const unsubscribe = partyService.subscribe(() => {
    const connected = partyService.getSnapshot().status === "connected";
    if (connected && !watching) {
      watching = true;
      void p2pService.watchLanWorld().catch(() => (watching = false));
    } else if (!connected && watching) {
      watching = false;
      port = null;
      void p2pService.unwatchLanWorld().catch(() => undefined);
    }
    void sync();
  });
  const unlisten = listen<number | null>("lan-world", (event) => {
    port = event.payload;
    void sync();
  });

  return () => {
    unsubscribe();
    void unlisten.then((fn) => fn());
    if (watching) void p2pService.unwatchLanWorld().catch(() => undefined);
  };
};
