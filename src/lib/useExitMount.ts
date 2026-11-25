import { useEffect, useRef, useState } from "react";

/**
 * Keeps a conditionally-rendered subtree mounted for `ms` after `open` turns false so its exit
 * animation can play, then unmounts it (resetting its internal state for the next open).
 */
export function useExitMount(open: boolean, ms = 300): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(id);
  }, [open, ms]);
  return open || mounted;
}

/** Returns the latest non-null value, so a closing dialog keeps its content during the exit animation. */
export function useLastValue<T>(value: T | null): T | null {
  const ref = useRef<T | null>(value);
  if (value !== null) ref.current = value;
  return ref.current;
}
