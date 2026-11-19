import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled = false }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-white/10 p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-light disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand" : "bg-white/10",
          className
        )}
      >
        {/* Animates x directly with initial={false}: the knob starts at its final spot, and unlike a `layout`
            animation it is not thrown off when an ancestor is still sliding or scaling in. */}
        <motion.span
          initial={false}
          animate={{ x: checked ? 16 : 0 }}
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
          className="pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm"
        />
      </button>
    );
  }
);

Switch.displayName = "Switch";
