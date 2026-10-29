import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

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
 * Hides the current Tauri window to system tray.
 */
export async function hideWindow(): Promise<void> {
  try {
    const win = getCurrentWindow();
    await win.hide();
  } catch (err) {
    console.warn("Tauri window hide error:", err);
  }
}

/**
 * Reveals and centers the splash window once its DOM is painted.
 */
export async function showSplashWindow(): Promise<void> {
  try {
    await invoke("show_splash_window");
  } catch (err) {
    console.warn("show_splash_window invoke error:", err);
  }
}

/**
 * Expands the window or reveals the 1280x720 main workspace (alias for showMainWindow).
 */
export async function expandMainWindow(): Promise<void> {
  await showMainWindow();
}

/**
 * Reveals and focuses the 1280x720 main window once initial UI is painted,
 * gracefully destroying the startup splash window.
 */
export async function showMainWindow(): Promise<void> {
  try {
    await invoke("show_main_window");
  } catch {
    try {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
    } catch (err) {
      console.warn("showMainWindow error:", err);
    }
  }
}

/**
 * Forcefully terminates all running games and exits the Focusite Launcher application completely.
 */
export async function exitApp(): Promise<void> {
  try {
    await invoke("exit_app");
  } catch (err) {
    console.warn("Tauri exit_app error:", err);
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
