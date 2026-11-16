import type { Variants } from "motion/react";

// Shared motion. Rule: only the NEW content moves. It rises a few pixels from the side the user is heading
// to while fading in; the OLD content just fades out in place and fast. With AnimatePresence popLayout the
// two overlap briefly, and because the old one does not travel there is never a second, competing motion.
// `dir` is +1 when the user moves forward/down/right and -1 when moving back.
export const SPRING = { type: "spring" as const, stiffness: 450, damping: 35, mass: 0.8 };

const FADE_IN = { duration: 0.2, ease: "easeOut" as const };
const FADE_OUT = { duration: 0.12, ease: "linear" as const };

const offset = (axis: "x" | "y", value: number) => (axis === "x" ? { x: value } : { y: value });

/** New content slides a short way in from the side the user is heading to; old content fades out in place. */
export function slideVariants(axis: "x" | "y", distance: number): Variants {
  return {
    initial: (dir: number) => ({ opacity: 0, ...offset(axis, dir * distance) }),
    animate: { opacity: 1, ...offset(axis, 0), transition: { ...SPRING, opacity: FADE_IN } },
    exit: { opacity: 0, transition: FADE_OUT },
  };
}

/** Pop-in for pages that are opened on top of the usual navigation (like the skin manager). */
export const scaleVariants: Variants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: { ...SPRING, opacity: FADE_IN } },
  exit: { opacity: 0, transition: FADE_OUT },
};
