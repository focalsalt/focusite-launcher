import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

interface TooltipContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  delayDuration: number;
  triggerRect: DOMRect | null;
  setTriggerRect: (rect: DOMRect | null) => void;
}

const TooltipContext = React.createContext<TooltipContextType | null>(null);

export interface TooltipProviderProps {
  children: React.ReactNode;
  delayDuration?: number;
}

export const TooltipProvider: React.FC<TooltipProviderProps> = ({
  children,
}) => {
  return <>{children}</>;
};

export interface TooltipProps {
  children: React.ReactNode;
  delayDuration?: number;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  delayDuration = 200,
  className,
}) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const [triggerRect, setTriggerRect] = React.useState<DOMRect | null>(null);

  return (
    <TooltipContext.Provider
      value={{ open, setOpen, delayDuration, triggerRect, setTriggerRect }}
    >
      <div className={cn("relative inline-flex", className)}>{children}</div>
    </TooltipContext.Provider>
  );
};

export interface TooltipTriggerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}

export const TooltipTrigger = React.forwardRef<
  HTMLDivElement,
  TooltipTriggerProps
>(({ className, children, ...props }, forwardedRef) => {
  const ctx = React.useContext(TooltipContext);
  const internalRef = React.useRef<HTMLDivElement | null>(null);
  const timeoutRef = React.useRef<number | null>(null);

  if (!ctx) {
    throw new Error("TooltipTrigger must be used within a Tooltip");
  }

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      internalRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    },
    [forwardedRef]
  );

  const updateRectAndOpen = () => {
    if (internalRef.current) {
      ctx.setTriggerRect(internalRef.current.getBoundingClientRect());
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      if (internalRef.current) {
        ctx.setTriggerRect(internalRef.current.getBoundingClientRect());
      }
      ctx.setOpen(true);
    }, ctx.delayDuration);
  };

  const close = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    ctx.setOpen(false);
  };

  return (
    <div
      ref={setRefs}
      onMouseEnter={updateRectAndOpen}
      onMouseLeave={close}
      onFocus={updateRectAndOpen}
      onBlur={close}
      className={cn("inline-flex", className)}
      {...props}
    >
      {children}
    </div>
  );
});
TooltipTrigger.displayName = "TooltipTrigger";

export interface TooltipContentProps
  extends Omit<HTMLMotionProps<"div">, "ref"> {
  side?: "top" | "bottom";
  sideOffset?: number;
}

export const TooltipContent = React.forwardRef<
  HTMLDivElement,
  TooltipContentProps
>(({ className, side = "top", sideOffset = 8, children, style, ...props }, ref) => {
  const ctx = React.useContext(TooltipContext);
  const [mounted, setMounted] = React.useState<boolean>(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!ctx || !mounted || typeof document === "undefined") {
    return null;
  }

  const { open, triggerRect } = ctx;

  let top = 0;
  let left = 0;
  let placeBottom = side === "bottom";

  if (triggerRect) {
    const vw = window.innerWidth;

    // 若距離視窗頂部小於 140px，自動翻轉至 Trigger 下方
    if (triggerRect.top < 140) {
      placeBottom = true;
    }

    if (placeBottom) {
      top = triggerRect.bottom + sideOffset;
    } else {
      top = triggerRect.top - sideOffset;
    }

    // 水平置中於 Trigger，並限制邊距防止超出視窗
    const rawCenter = triggerRect.left + triggerRect.width / 2;
    left = Math.max(140, Math.min(vw - 140, rawCenter));
  }

  return createPortal(
    <AnimatePresence>
      {open && triggerRect && (
        <motion.div
          ref={ref}
          initial={{
            opacity: 0,
            scale: 0.95,
            y: placeBottom ? -4 : 4,
          }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
          }}
          exit={{
            opacity: 0,
            scale: 0.95,
          }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{
            position: "fixed",
            top: placeBottom ? top : undefined,
            bottom: placeBottom ? undefined : window.innerHeight - top,
            left,
            transform: "translateX(-50%)",
            zIndex: 99999,
            ...style,
          }}
          className={cn(
            "pointer-events-none rounded-xl border border-white/15 bg-slate-950/95 px-2.5 py-1.5 text-xs text-slate-200 shadow-2xl backdrop-blur-md max-w-[340px]",
            className
          )}
          {...props}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
});
TooltipContent.displayName = "TooltipContent";
