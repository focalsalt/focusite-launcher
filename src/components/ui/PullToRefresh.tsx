import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const THRESHOLD = 70;
const MAX_PULL = 110;
const DRAG_START_PX = 8;

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return null;
}

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Drag down (mouse or touch) while scrolled to the top to trigger `onRefresh`. */
export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  disabled,
  className,
  children,
}) => {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const startY = React.useRef<number | null>(null);
  const dragging = React.useRef(false);
  const suppressClick = React.useRef(false);
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);

  const reset = () => {
    startY.current = null;
    dragging.current = false;
    setPull(0);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || refreshing || (e.pointerType === "mouse" && e.button !== 0)) return;
    const scroller = findScrollParent(rootRef.current);
    if (scroller && scroller.scrollTop > 0) return;
    startY.current = e.clientY;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const dy = e.clientY - startY.current;
    if (!dragging.current) {
      if (dy < DRAG_START_PX) return;
      dragging.current = true;
      rootRef.current?.setPointerCapture(e.pointerId);
    }
    setPull(Math.min(MAX_PULL, dy * 0.5));
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const wasDragging = dragging.current;
    if (wasDragging) {
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
    }
    const shouldRefresh = wasDragging && pull >= THRESHOLD;
    if (wasDragging) rootRef.current?.releasePointerCapture(e.pointerId);
    startY.current = null;
    dragging.current = false;
    if (!shouldRefresh) {
      reset();
      return;
    }
    setRefreshing(true);
    setPull(THRESHOLD * 0.7);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      reset();
    }
  };

  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div
      ref={rootRef}
      className="relative"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      // A drag that started on a card must not also click it.
      onClickCapture={(e) => {
        if (dragging.current || suppressClick.current) e.stopPropagation();
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center overflow-hidden"
        style={{ height: pull, opacity: progress, transition: dragging.current ? "none" : "height 0.2s, opacity 0.2s" }}
      >
        <RefreshCw
          className={cn("h-4 w-4 text-brand-light", refreshing && "animate-spin")}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        />
      </div>
      <div
        className={className}
        style={{ transform: `translateY(${pull}px)`, transition: dragging.current ? "none" : "transform 0.2s" }}
      >
        {children}
      </div>
    </div>
  );
};
