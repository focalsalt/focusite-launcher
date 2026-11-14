import type { Variants } from "motion/react";

// Shared motion: one spring for entering and a stiffer one for leaving, so every slide feels like the
// same object being moved. `dir` is +1 when the user moves forward/down/right and -1 when moving back.
export const SPRING = { type: "spring" as const, stiffness: 450, damping: 35, mass: 0.8 };
export const SPRING_EXIT = { type: "spring" as const, stiffness: 600, damping: 45, mass: 0.7 };

const offset = (axis: "x" | "y", value: number) => (axis === "x" ? { x: value } : { y: value });

/** New content slides in from the side the user is heading to; old content leaves the opposite way. */
export function slideVariants(axis: "x" | "y", distance: number): Variants {
  return {
    initial: (dir: number) => ({ opacity: 0, ...offset(axis, dir * distance) }),
    animate: { opacity: 1, ...offset(axis, 0), transition: SPRING },
    exit: (dir: number) => ({ opacity: 0, ...offset(axis, -dir * distance), transition: SPRING_EXIT }),
  };
}

/** Pop-in for pages that are opened on top of the usual navigation (like the skin manager). */
export const scaleVariants: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: SPRING },
  exit: { opacity: 0, scale: 0.96, transition: SPRING_EXIT },
};
