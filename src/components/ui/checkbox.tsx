import * as React from "react";
import { Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked, onCheckedChange, disabled = false, className, id }, ref) => {
    return (
      <button
        ref={ref}
        id={id}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded border border-white/20 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#52A43A] disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center",
          checked
            ? "bg-[#3C8527] border-[#52A43A] text-white shadow-sm shadow-[#3C8527]/30"
            : "bg-white/5 hover:bg-white/10 text-transparent",
          className
        )}
      >
        <AnimatePresence>
          {checked && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <Check className="h-3 w-3 stroke-[2.5]" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>
    );
  }
);

Checkbox.displayName = "Checkbox";
