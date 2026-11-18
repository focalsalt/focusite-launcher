/** True inside the desktop app; false when the UI runs in a plain browser (`pnpm dev` without Tauri). */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
