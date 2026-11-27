import React, { useEffect, useState } from "react";
import dirtUrl from "@/assets/party/block/dirt.png";
import portalUrl from "@/assets/party/block/nether_portal.png";
import { MC_FONT_FAMILY } from "./CampScene";

/** The game's LoadingDotsText: a lit dot moves along three. */
const DOTS = ["O o o", "o O o", "o o O", "o O o"];
const FADE_MS = 500;
/** nether_portal.png is 32 frames of 16 px, shown at 4x; the game plays one frame per tick (50 ms). */
const PORTAL_FRAME_PX = 64;
const PORTAL_FRAMES = 32;

interface McLoadingScreenProps {
  title: string;
  /** "world" is the dirt "Loading world" screen with a progress bar; "realms" is the portal screen with moving dots; "offline" is the dirt screen with the game's no-connection icon. */
  variant: "world" | "realms" | "offline";
  /** Fades out (then unmounts) when false. */
  visible: boolean;
  /** World variant only, 0..1. */
  progress?: number;
}

/** The game's "unreachable" ping icon (10x8 px): grey signal bars crossed out in red. */
const NoConnectionIcon: React.FC = () => (
  <svg viewBox="0 0 10 8" width={60} height={48} shapeRendering="crispEdges" aria-hidden>
    {[2, 3, 4, 5, 6].map((h, i) => (
      <rect key={i} x={i * 2} y={8 - h} width={1} height={h} fill="#7f7f7f" />
    ))}
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <React.Fragment key={i}>
        <rect x={3 + i} y={1 + i} width={1} height={1} fill="#e03030" />
        <rect x={8 - i} y={1 + i} width={1} height={1} fill="#e03030" />
      </React.Fragment>
    ))}
  </svg>
);

/** Full-size loading screen in the style of the game's own; it fills its (positioned) parent, which is the scene's box. */
export const McLoadingScreen: React.FC<McLoadingScreenProps> = ({ title, variant, visible, progress = 0 }) => {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(visible);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setShown(true);
      return;
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!mounted || variant !== "realms") return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 300);
    return () => window.clearInterval(timer);
  }, [mounted, variant]);

  if (!mounted) return null;
  const background =
    variant === "realms"
      ? {
          backgroundImage: `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url(${portalUrl})`,
          backgroundSize: `auto, ${PORTAL_FRAME_PX}px ${PORTAL_FRAME_PX * PORTAL_FRAMES}px`,
          animation: `mc-portal ${PORTAL_FRAMES * 50}ms steps(${PORTAL_FRAMES}) infinite`,
        }
      : {
          backgroundImage: `linear-gradient(rgba(0,0,0,0.75), rgba(0,0,0,0.75)), url(${dirtUrl})`,
          backgroundSize: "auto, 64px 64px",
        };

  return (
    <div
      className="fc-dark pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-white transition-opacity"
      style={{
        fontFamily: MC_FONT_FAMILY,
        textShadow: "2px 2px 0 #3f3f3f",
        backgroundColor: "#202020",
        imageRendering: "pixelated",
        opacity: shown ? 1 : 0,
        transitionDuration: `${FADE_MS}ms`,
        ...background,
      }}
    >
      <style>{`@keyframes mc-portal { from { background-position: 0 0, 0 0; } to { background-position: 0 0, 0 -${PORTAL_FRAME_PX * PORTAL_FRAMES}px; } }`}</style>
      {variant === "offline" && <NoConnectionIcon />}
      <p className="text-xl">{title}</p>
      {variant === "offline" ? null : variant === "realms" ? (
        <p className="text-lg text-white/90">{DOTS[tick % DOTS.length]}</p>
      ) : (
        // Like the game's progress bar: a black track with a one-pixel light border and a pale green fill.
        <div className="h-2 w-52 bg-black p-px ring-1 ring-[#808080]">
          <div className="h-full bg-[#80ff80] transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
};
