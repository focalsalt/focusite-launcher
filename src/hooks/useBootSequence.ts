import { useEffect, useRef, useState } from "react";
import { showMainWindow } from "@/lib/tauriWindow";
import {
  computeRemainingSplashDelay,
  runSequentialPrefetch,
  SECONDARY_2D_PREFETCH_TASKS,
} from "@/lib/startupOrchestrator";

/**
 * Progressive mount of the main window:
 * - "window-reveal": only the WindowBar and the light MainBootOverlay are in the DOM, so the window can be
 *   shown without ever exposing an empty Win32 surface.
 * - "workspace-mount": the overlay is on screen and the full workspace mounts underneath it.
 * - "ready": the workspace has painted and the overlay fades out (220ms).
 */
export type BootStage = "window-reveal" | "workspace-mount" | "ready";

export function useBootSequence(isInitialDataLoaded: boolean): BootStage {
  const [bootStage, setBootStage] = useState<BootStage>("window-reveal");
  const bootStartTimeRef = useRef<number>(performance.now());
  const hasRevealedWindowRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isInitialDataLoaded || hasRevealedWindowRef.current) {
      return;
    }

    const remainingDelay = computeRemainingSplashDelay({
      bootStartTimeMs: bootStartTimeRef.current,
      nowMs: performance.now(),
      minSplashDurationMs: 400,
    });

    let mountTimer: number | undefined;
    let rafId1 = 0;
    let rafId2 = 0;
    let rafId3 = 0;

    const timer = window.setTimeout(() => {
      if (hasRevealedWindowRef.current) return;
      hasRevealedWindowRef.current = true;

      void showMainWindow().then(() => {
        // Force a reflow so the overlay styles apply as soon as the hidden window becomes visible,
        // which speeds up the first DirectComposition frame.
        void document.body.offsetHeight;

        // Double rAF: the overlay's first frame has reached the screen.
        rafId1 = window.requestAnimationFrame(() => {
          rafId2 = window.requestAnimationFrame(() => {
            setBootStage("workspace-mount");

            // Give the complex workspace DOM, shadows and text 260ms plus a frame to rasterize.
            mountTimer = window.setTimeout(() => {
              rafId3 = window.requestAnimationFrame(() => {
                setBootStage("ready");

                // After the fade, preload the ordinary 2D pages one by one in the background.
                const ac = new AbortController();
                abortControllerRef.current = ac;
                window.setTimeout(() => {
                  void runSequentialPrefetch(SECONDARY_2D_PREFETCH_TASKS, 150, ac.signal);
                }, 1500);
              });
            }, 260);
          });
        });
      });
    }, remainingDelay);

    return () => {
      window.clearTimeout(timer);
      if (mountTimer) window.clearTimeout(mountTimer);
      if (rafId1) window.cancelAnimationFrame(rafId1);
      if (rafId2) window.cancelAnimationFrame(rafId2);
      if (rafId3) window.cancelAnimationFrame(rafId3);
    };
  }, [isInitialDataLoaded]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return bootStage;
}
