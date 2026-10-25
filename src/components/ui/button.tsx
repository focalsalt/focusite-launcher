import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-xs font-semibold select-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#52A43A] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-[#3C8527] text-white shadow-md shadow-[#3C8527]/25 hover:bg-[#469C2D]",
        destructive:
          "bg-rose-600 text-white shadow-sm hover:bg-rose-500",
        outline:
          "border border-white/10 bg-white/5 text-slate-200 backdrop-blur-sm shadow-sm hover:bg-white/10 hover:text-white",
        secondary:
          "bg-white/10 text-slate-200 shadow-sm hover:bg-white/15 hover:text-white",
        ghost:
          "hover:bg-white/10 text-slate-300 hover:text-white",
        link:
          "text-[#52A43A] underline-offset-4 hover:underline",
        glass:
          "bg-white/10 backdrop-blur-md border border-white/15 text-slate-100 hover:bg-white/15 shadow-sm",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-7 text-sm font-bold",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref">,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, disabled, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        whileHover={disabled ? undefined : { scale: 1.02 }}
        whileTap={disabled ? undefined : { scale: 0.98 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { buttonVariants };
