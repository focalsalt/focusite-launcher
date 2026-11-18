import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { instanceService } from "@/services/instanceService";
import { Camera, ChevronLeft, ChevronRight, FolderOpen } from "lucide-react";
import { toAssetSrc } from "@/lib/assetUrl";
import type { MinecraftInstance } from "@/types/navigation";
import type { ScreenshotFileInfo } from "@/services/instanceService";
import { FramelessEmptyState, tabContentVariants } from "./shared";
import { useI18n } from "@/i18n";

/** Shows a pulsing placeholder until the image has loaded, then fades it in. Only mounted for nearby cards. */
const ShotImage: React.FC<{ src?: string; alt: string }> = ({ src, alt }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-white/10" />}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </>
  );
};

interface ScreenshotsTabProps {
  instance: MinecraftInstance;
  screenshots: ScreenshotFileInfo[];
  tabDirection: number;
  ref?: React.Ref<HTMLDivElement>;
}

export const ScreenshotsTab: React.FC<ScreenshotsTabProps> = ({ instance, screenshots, tabDirection, ref }: ScreenshotsTabProps) => {
  const { t } = useI18n();
  const [currentScreenshotIdx, setCurrentScreenshotIdx] = useState<number>(0);

  // Arrow keys switch screenshots while this tab is mounted.
  useEffect(() => {
    if (screenshots.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setCurrentScreenshotIdx((cur) => (cur > 0 ? cur - 1 : screenshots.length - 1));
      } else if (e.key === "ArrowRight") {
        setCurrentScreenshotIdx((cur) => (cur < screenshots.length - 1 ? cur + 1 : 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screenshots.length]);

  // Wheel / trackpad swipe flips through the images; the cooldown keeps one gesture to one step.
  const lastWheelAt = useRef<number>(0);

  // The card size follows the stage: as large as the height allows (16:9), never wider than the width allows.
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [screenshots.length === 0]);
  const cardW = Math.max(160, Math.min(stage.w * 0.7, stage.h * 0.82 * (16 / 9)));
  const handleWheel = (e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = Date.now();
    if (Math.abs(delta) < 4 || now - lastWheelAt.current < 220 || screenshots.length < 2) return;
    lastWheelAt.current = now;
    setCurrentScreenshotIdx((cur) =>
      delta > 0 ? (cur + 1) % screenshots.length : (cur - 1 + screenshots.length) % screenshots.length,
    );
  };

  return (
              <motion.div
                key="screenshots"
                custom={tabDirection}
                ref={ref}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex h-full flex-col gap-3"
              >
                {screenshots.length === 0 ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <FramelessEmptyState
                      icon={Camera}
                      title={t.shots.emptyTitle}
                      description={t.shots.emptyDesc}
                    />
                  </div>
                ) : (
                  <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setCurrentScreenshotIdx((cur) => (cur > 0 ? cur - 1 : screenshots.length - 1))}
                      className="absolute left-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-2xl backdrop-blur-md transition-all hover:bg-white/20 active:scale-95"
                      title={t.shots.prev}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentScreenshotIdx((cur) => (cur < screenshots.length - 1 ? cur + 1 : 0))}
                      className="absolute right-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-2xl backdrop-blur-md transition-all hover:bg-white/20 active:scale-95"
                      title={t.shots.next}
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>

                    {/* Shows n-1, n, n+1 (wrapping around); farther cards wait invisibly so they glide in */}
                    <div
                      ref={stageRef}
                      onWheel={handleWheel}
                      className="relative flex h-full min-h-[240px] w-full items-center justify-center [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
                    >
                      {screenshots.map((sc, idx) => {
                        // Signed circular distance: the last image sits left of the first and vice versa.
                        const count = screenshots.length;
                        let diff = (((idx - currentScreenshotIdx) % count) + count) % count;
                        if (diff > count / 2) diff -= count;
                        const distance = Math.abs(diff);
                        if (distance > 2) return null;
                        const isCurrent = diff === 0;

                        return (
                          <motion.div
                            key={sc.path}
                            onClick={() => setCurrentScreenshotIdx(idx)}
                            initial={false}
                            animate={{
                              x: diff * cardW * 0.58,
                              scale: isCurrent ? 1 : 0.78,
                              opacity: isCurrent ? 1 : distance === 1 ? 0.5 : 0,
                            }}
                            transition={{ type: "spring", stiffness: 380, damping: 34 }}
                            style={{ width: cardW, zIndex: 10 - distance, pointerEvents: distance > 1 ? "none" : "auto" }}
                            className={`absolute aspect-video cursor-pointer select-none overflow-hidden rounded-2xl border ${isCurrent
                              ? "border-brand-light/70 shadow-[0_0_36px_color-mix(in_srgb,var(--fc-highlight)_30%,transparent)]"
                              : "border-white/10"
                              }`}
                          >
                            <ShotImage src={toAssetSrc(sc.path)} alt={sc.name} />

                            {isCurrent && (
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-4">
                                <p className="truncate text-sm font-bold text-white drop-shadow">{sc.name}</p>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Bottom row: position dots in the middle, folder shortcut on the right */}
                <div className="relative flex shrink-0 items-center justify-center py-1">
                  <div className="z-20 flex items-center gap-1.5">
                    {screenshots.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setCurrentScreenshotIdx(idx)}
                        className={`transition-all duration-300 ${idx === currentScreenshotIdx
                          ? "h-1.5 w-6 rounded-full bg-brand-light"
                          : "h-1.5 w-1.5 rounded-full bg-white/20 hover:bg-white/40"
                          }`}
                      />
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => instanceService.openInstanceDirectory(instance.id, "screenshots")}
                    className="absolute right-0 h-8 border-white/10 bg-white/5 text-xs hover:bg-white/10"
                  >
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    {t.shots.openFolder}
                  </Button>
                </div>
              </motion.div>
  );
};
