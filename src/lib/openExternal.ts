import { openUrl } from "@tauri-apps/plugin-opener";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Opens an http(s) link in the system browser. `window.open` does nothing useful inside the
 * Tauri webview, so desktop builds go through the opener plugin.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
