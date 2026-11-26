import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Small text on the right of the option (e.g. the folder name). */
  hint?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
  className?: string;
  /** Id of the visible label. */
  labelledBy?: string;
}

/** Select-like dropdown with checkable options; chosen items show as removable badges in the field. */
export const MultiSelect: React.FC<MultiSelectProps> = ({ options, value, onChange, placeholder, className, labelledBy }) => {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<boolean>(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (v: string) => {
    const next = new Set(value);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  };

  const chosen = options.filter((o) => value.has(o.value));

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <div
        role="combobox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // Keys pressed on a badge's remove button belong to that button.
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className={cn(
          "flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border bg-white/5 px-3 py-1.5 text-xs text-slate-100 shadow-sm transition-colors",
          open ? "border-brand-light/60 ring-1 ring-brand-light" : "border-white/10 hover:bg-white/10",
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {chosen.length === 0 ? (
            <span className="text-slate-400">{placeholder}</span>
          ) : (
            <AnimatePresence initial={false}>
              {chosen.map((o) => (
                <motion.div
                  key={o.value}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                >
                  <Badge variant="outline" className="gap-1 border-brand-light/40 bg-brand/10 py-0.5 pl-2 pr-1 text-2xs text-brand-light">
                    <span className="max-w-[10rem] truncate">{o.label}</span>
                    <button
                      type="button"
                      aria-label={`${t.common.remove} ${o.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(o.value);
                      }}
                      className="rounded p-0.5 hover:bg-white/15"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-multiselectable
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.12 }}
            style={{ transformOrigin: "top" }}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-white/15 bg-slate-900/98 p-1.5 text-xs text-slate-100 shadow-2xl backdrop-blur-2xl [scrollbar-width:none]"
          >
            {options.map((opt) => {
              const on = value.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    "flex w-full select-none items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition-colors",
                    on ? "bg-brand/25 font-semibold text-brand-light" : "text-slate-200 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    {on ? <Check className="h-3.5 w-3.5 shrink-0 text-brand-light" /> : <span className="w-3.5 shrink-0" />}
                    <span className="truncate">{opt.label}</span>
                  </div>
                  {opt.hint && <span className="ml-2 shrink-0 font-mono text-3xs text-slate-400">{opt.hint}</span>}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
