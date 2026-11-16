import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Sliding highlight for a row of tab buttons.
 *
 * The highlight is placed from the active button's own `offsetLeft` / `offsetWidth` instead of a shared
 * `layoutId`. Layout projection measured the strip while a view transition was still stacking and moving the
 * page, so indicators used to fly in from somewhere else; offsets are local to the strip and never are.
 *
 * Usage: the strip must be `relative` and be the offset parent of the buttons. Give each button
 * `ref={register(key)}` and render `<SlidingIndicator box={box} className="..." />` inside the strip.
 */
export function useSlidingIndicator(active: string | null) {
  const els = useRef<Record<string, HTMLElement | null>>({});
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  // Runs after every render so a changed label width (language switch, late font) keeps the highlight in step.
  useLayoutEffect(() => {
    const el = active === null ? null : els.current[active];
    if (!el) {
      setBox((prev) => (prev === null ? prev : null));
      return;
    }
    const { offsetLeft: x, offsetWidth: w } = el;
    setBox((prev) => (prev && prev.x === x && prev.w === w ? prev : { x, w }));
  });

  const register = (key: string) => (el: HTMLElement | null) => {
    els.current[key] = el;
  };

  return { box, register };
}

export function SlidingIndicator({
  box,
  className,
}: {
  box: { x: number; w: number } | null;
  /** Vertical placement and look (`top-1 bottom-1 rounded-lg bg-brand`, `bottom-0 h-0.5 ...`). */
  className?: string;
}) {
  if (!box) return null;
  return (
    <motion.div
      initial={false}
      animate={{ x: box.x, width: box.w }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className={cn("pointer-events-none absolute left-0", className)}
    />
  );
}
