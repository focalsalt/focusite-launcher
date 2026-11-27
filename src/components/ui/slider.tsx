import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
}

export const Slider = React.forwardRef<HTMLDivElement, SliderProps>(
  ({ value, min, max, step = 1, onChange, className, disabled = false }, ref) => {
    const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex w-full touch-none select-none items-center py-2",
          disabled && "opacity-50 pointer-events-none",
          className
        )}
      >
        <div className="relative h-2 w-full grow overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-brand to-brand-light transition-all duration-75"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
        />
        <div
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 rounded-full border-2 border-on-solid bg-brand-light shadow-md shadow-brand/50 transition-all duration-75"
          style={{ left: `${percentage}%` }}
        />
      </div>
    );
  }
);

Slider.displayName = "Slider";
