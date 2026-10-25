import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Minimizes the current Tauri application window.
 */
export async function minimizeWindow(): Promise<void> {
  try {
    const win = getCurrentWindow();
    await win.minimize();
  } catch (err) {
    console.warn("Tauri window minimize error:", err);
  }
}

/**
 * Toggles maximize / restore state on the current Tauri window.
 */
export async function toggleMaximizeWindow(): Promise<void> {
  try {
    const win = getCurrentWindow();
    await win.toggleMaximize();
  } catch (err) {
    console.warn("Tauri window toggleMaximize error:", err);
  }
}

/**
 * Closes the current Tauri window.
 */
export async function closeWindow(): Promise<void> {
  try {
    const win = getCurrentWindow();
    await win.close();
  } catch (err) {
    console.warn("Tauri window close error:", err);
  }
}

/**
 * Checks if the window is currently maximized.
 */
export async function isWindowMaximized(): Promise<boolean> {
  try {
    const win = getCurrentWindow();
    return await win.isMaximized();
  } catch {
    return false;
  }
}

/**
 * Starts window dragging on mouse down.
 */
export async function startDragging(): Promise<void> {
  try {
    const win = getCurrentWindow();
    await win.startDragging();
  } catch (err) {
    console.warn("Tauri window startDragging error:", err);
  }
}
