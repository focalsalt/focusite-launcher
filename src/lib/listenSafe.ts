import { listen, type EventCallback } from "@tauri-apps/api/event";

/** Subscribes to a Tauri event; the returned cleanup is safe to call before the subscription resolves. */
export function listenSafe<T>(event: string, handler: EventCallback<T>): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  listen<T>(event, handler).then((un) => {
    if (disposed) un();
    else unlisten = un;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
