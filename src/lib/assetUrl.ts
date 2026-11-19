import { convertFileSrc } from "@tauri-apps/api/core";

/** Mojang returns texture URLs as http://, which the app's CSP blocks; the same host serves https. */
export const toHttps = (url: string): string => url.replace(/^http:\/\/textures\.minecraft\.net/i, "https://textures.minecraft.net");

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
