import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Converts a local file path to a URL the webview can load.
 * `updatedAt` busts the webview cache when the file is overwritten in place (e.g. icon.png).
 */
export function toAssetSrc(path?: string, updatedAt?: number): string | undefined {
  if (!path) return undefined;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const src = convertFileSrc(path);
      return updatedAt ? `${src}?t=${updatedAt}` : src;
    } catch {
      return path;
    }
  }
  return path;
}
