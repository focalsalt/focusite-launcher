import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectContextType {
  value: string;
  onValueChange: (val: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRect: DOMRect | null;
  setTriggerRect: (rect: DOMRect | null) => void;
  triggerElement: HTMLElement | null;
  setTriggerElement: (el: HTMLElement | null) => void;
  disabled?: boolean;
}

const SelectContext = React.createContext<SelectContextType | null>(null);

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export const Select: React.FC<SelectProps> = ({
  value,
  onValueChange,
  disabled = false,
  children,
}) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const [triggerRect, setTriggerRect] = React.useState<DOMRect | null>(null);
  const [triggerElement, setTriggerElement] = React.useState<HTMLElement | null>(null);

  return (
    <SelectContext.Provider
      value={{
        value,
        onValueChange,
        open,
        setOpen,
        triggerRect,
        setTriggerRect,
        triggerElement,
        setTriggerElement,
        disabled,
      }}
    >
      <div className="relative w-full inline-block">{children}</div>
    </SelectContext.Provider>
  );
};

export interface SelectTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  children?: React.ReactNode;
}

export const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  SelectTriggerProps
>(({ className, children, ...props }, ref) => {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("SelectTrigger must be used within Select");

  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (ctx.disabled) return;
    if (buttonRef.current) {
      ctx.setTriggerRect(buttonRef.current.getBoundingClientRect());
    }
    ctx.setOpen(!ctx.open);
    props.onClick?.(e);
  };

  return (
    <button
      ref={(node) => {
        buttonRef.current = node;
        ctx.setTriggerElement(node);
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
      }}
      type="button"
      role="combobox"
      aria-expanded={ctx.open}
      disabled={ctx.disabled}
      onClick={handleClick}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 shadow-sm transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:border-[#52A43A]/60 focus-visible:ring-1 focus-visible:ring-[#52A43A] disabled:cursor-not-allowed disabled:opacity-50 select-none",
        className
      )}
      {...props}
    >
      <div className="flex items-center flex-1 min-w-0 truncate pr-2">{children}</div>
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200",
          ctx.open && "rotate-180 text-white"
        )}
      />
    </button>
  );
});
SelectTrigger.displayName = "SelectTrigger";

export const SelectValue: React.FC<{
  placeholder?: string;
  className?: string;
}> = ({ placeholder, className }) => {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("SelectValue must be used within Select");

  return (
    <span className={cn(!ctx.value && "text-slate-500", className)}>
      {ctx.value || placeholder || "請選擇..."}
    </span>
  );
};

export interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

export const SelectContent: React.FC<SelectContentProps> = ({
  children,
  className,
}) => {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("SelectContent must be used within Select");

  const [coords, setCoords] = React.useState<{
    top: number;
    left: number;
    width: number;
    flipped: boolean;
  }>({
    top: 0,
    left: 0,
    width: 0,
    flipped: false,
  });

  const contentRef = React.useRef<HTMLDivElement | null>(null);

  // 計算座標與防溢出翻轉
  React.useLayoutEffect(() => {
    if (!ctx.open || !ctx.triggerRect) return;

    const rect = ctx.triggerRect;
    const estimatedHeight = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldFlip = spaceBelow < estimatedHeight && rect.top > estimatedHeight;

    const top = shouldFlip
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));

    setCoords({
      top,
      left,
      width: rect.width,
      flipped: shouldFlip,
    });
  }, [ctx.open, ctx.triggerRect]);

  // 監聽點擊外部與 Esc 鍵關閉
  React.useEffect(() => {
    if (!ctx.open) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // 若點擊位於 Dropdown 內容區或觸發器內部，略過由其原生事件處理
      if (
        (contentRef.current && contentRef.current.contains(target)) ||
        (ctx.triggerElement && ctx.triggerElement.contains(target))
      ) {
        return;
      }
      ctx.setOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        ctx.setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctx.open, ctx]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {ctx.open && (
        <motion.div
          ref={contentRef}
          initial={{ opacity: 0, scale: 0.96, y: coords.flipped ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: coords.flipped ? 4 : -4 }}
          transition={{ duration: 0.12 }}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: coords.width,
            zIndex: 200,
          }}
          className={cn(
            "max-h-60 overflow-y-auto rounded-xl border border-white/15 bg-slate-900/98 p-1.5 shadow-2xl backdrop-blur-2xl text-xs text-slate-100 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:none",
            className
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  extraRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SelectItem: React.FC<SelectItemProps> = ({
  value,
  disabled = false,
  extraRight,
  children,
  className,
}) => {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error("SelectItem must be used within Select");

  const isSelected = ctx.value === value;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    ctx.onValueChange(value);
    ctx.setOpen(false);
  };

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        "relative flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors select-none",
        isSelected
          ? "bg-[#3C8527]/25 text-[#52A43A] font-semibold"
          : "text-slate-200 hover:bg-white/10 hover:text-white",
        disabled && "opacity-40 cursor-not-allowed pointer-events-none",
        className
      )}
    >
      <div className="flex items-center gap-2 truncate">
        {isSelected ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-[#52A43A]" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="truncate">{children}</span>
      </div>

      {extraRight && <div className="shrink-0 ml-2">{extraRight}</div>}
    </button>
  );
};
