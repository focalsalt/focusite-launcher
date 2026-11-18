import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/lib/tauri";

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
