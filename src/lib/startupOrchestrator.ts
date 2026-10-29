/**
 * Focusite Launcher Startup Orchestrator & View Prefetch Scheduler.
 * Coordinates smooth splash-to-main window handovers and queues non-blocking secondary view loading.
 */

export interface StartupTimingInput {
  bootStartTimeMs: number;
  nowMs: number;
  minSplashDurationMs?: number;
}

/**
 * Computes the remaining display duration before revealing the main workspace,
 * ensuring the startup splash screen meets the minimum presentation contract (default 400ms).
 */
export function computeRemainingSplashDelay(input: StartupTimingInput): number {
  const minDuration = input.minSplashDurationMs ?? 400;
  const elapsed = Math.max(0, input.nowMs - input.bootStartTimeMs);
  return Math.max(0, minDuration - elapsed);
}

/**
 * Sequentially executes a queue of prefetch promises with non-blocking intervals
 * between each task, ensuring the JavaScript main thread and WebView2 compositor remain at 60/144 FPS.
 */
export async function runSequentialPrefetch(
  tasks: ReadonlyArray<() => Promise<unknown>>,
  delayBetweenTasksMs: number = 150,
  signal?: AbortSignal
): Promise<number> {
  let completedCount = 0;

  for (const task of tasks) {
    if (signal?.aborted) {
      break;
    }

    try {
      await task();
      completedCount += 1;
    } catch {
      // Background prefetching errors are silently ignored; actual navigation will retry via Suspense
    }

    if (signal?.aborted) {
      break;
    }

    if (delayBetweenTasksMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayBetweenTasksMs);
        if (signal) {
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        }
      });
    }
  }

  return completedCount;
}

/**
 * Standard 2D secondary views scheduled for sequential background prefetching.
 * Heavy 3D WebGL runtimes and auxiliary dialogs are explicitly excluded to keep the startup footprint low.
 */
export const SECONDARY_2D_PREFETCH_TASKS: ReadonlyArray<() => Promise<unknown>> = [
  () => import("@/views/InstancesView"),
  () => import("@/views/InstanceDetailView"),
  () => import("@/views/NewsView"),
  () => import("@/views/SettingsView"),
];

let isSkinManagerPreloaded = false;
/**
 * On-demand hover/click preheater for SkinManagerView and its skinview3d/Three.js engine.
 */
export function preloadSkinManagerView(): void {
  if (isSkinManagerPreloaded) return;
  isSkinManagerPreloaded = true;
  void import("@/views/SkinManagerView").catch(() => {
    isSkinManagerPreloaded = false;
  });
}

let isCreateInstancePreloaded = false;
/**
 * On-demand hover/click preheater for CreateInstanceDialog.
 */
export function preloadCreateInstanceDialog(): void {
  if (isCreateInstancePreloaded) return;
  isCreateInstancePreloaded = true;
  void import("@/components/instance/CreateInstanceDialog").catch(() => {
    isCreateInstancePreloaded = false;
  });
}

let isImportModpackPreloaded = false;
/**
 * On-demand hover/click preheater for ImportModpackDialog.
 */
export function preloadImportModpackDialog(): void {
  if (isImportModpackPreloaded) return;
  isImportModpackPreloaded = true;
  void import("@/components/instance/ImportModpackDialog").catch(() => {
    isImportModpackPreloaded = false;
  });
}

let isMicrosoftLoginPreloaded = false;
/**
 * On-demand hover/click preheater for MicrosoftLoginModal.
 */
export function preloadMicrosoftLoginModal(): void {
  if (isMicrosoftLoginPreloaded) return;
  isMicrosoftLoginPreloaded = true;
  void import("@/components/auth/MicrosoftLoginModal").catch(() => {
    isMicrosoftLoginPreloaded = false;
  });
}
