import type { Variants } from "motion/react";

// Shared motion. Rule: only the NEW content moves. It rises a few pixels from the side the user is heading
// to while fading in; the OLD content just fades out in place and fast. With AnimatePresence popLayout the
// two overlap briefly, and because the old one does not travel there is never a second, competing motion.
// `dir` is +1 when the user moves forward/down/right and -1 when moving back.
/** Tween durations in seconds. */
export const DURATION = { fast: 0.12, base: 0.15, slow: 0.2 } as const;
export const EASE = { enter: "easeOut", exit: "linear" } as const;

const spring = (stiffness: number, damping: number, mass = 1) =>
  ({ type: "spring" as const, stiffness, damping, mass });

export const SPRING = spring(450, 35, 0.8);
/** Button hover / tap scale. */
export const SPRING_PRESS = spring(500, 25);
/** Switch knob. */
export const SPRING_TOGGLE = spring(600, 30);
export const SPRING_DIALOG = spring(450, 30);
export const SPRING_TOAST = spring(420, 34, 0.7);

const FADE_IN = { duration: DURATION.slow, ease: EASE.enter };
const FADE_OUT = { duration: DURATION.fast, ease: EASE.exit };

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
