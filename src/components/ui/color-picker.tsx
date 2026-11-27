import * as React from "react";
import { hexToHsv, hsvToHex, isHexColor, type Hsv } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const PANEL_WIDTH = 224;
const PANEL_HEIGHT = 220;
const GAP = 4;
const HUE_TRACK = "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

interface ColorPickerProps {
  /** `#rrggbb`. */
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the trigger. */
  label: string;
  id?: string;
  className?: string;
}

/** Swatch button opening a saturation/brightness area, a hue slider and a hex field. */
export const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange, label, id, className }) => {
  const { t } = useI18n();
  const panelId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const areaRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<Hsv>(() => hexToHsv(value));
  const [draft, setDraft] = React.useState<string | null>(null);

  // Hue and saturation cannot be read back from greys or black, so keep what was picked while it still matches.
  const hsv = hsvToHex(picked) === value.toLowerCase() ? picked : hexToHsv(value);
  const pick = (patch: Partial<Hsv>) => {
    const next = { ...hsv, ...patch };
    setPicked(next);
    onChange(hsvToHex(next));
  };

  // The native popover sits in the top layer (never clipped) and handles Escape and outside clicks.
  const place = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!rect || !panel) return;
    // Anchor by the bottom edge when flipped, so the gap does not depend on the exact height.
    const flipped = rect.bottom + GAP + PANEL_HEIGHT > window.innerHeight && rect.top > PANEL_HEIGHT;
    panel.style.top = flipped ? "auto" : `${rect.bottom + GAP}px`;
    panel.style.bottom = flipped ? `${window.innerHeight - rect.top + GAP}px` : "auto";
    panel.style.left = `${Math.max(GAP, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - GAP))}px`;
  }, []);

  React.useEffect(() => {
    if (!open) return;
    areaRef.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const pickAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pick({ s: clamp((e.clientX - rect.left) / rect.width), v: 1 - clamp((e.clientY - rect.top) / rect.height) });
  };

  const handleKeys = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const patch = {
      ArrowLeft: { s: clamp(hsv.s - step) },
      ArrowRight: { s: clamp(hsv.s + step) },
      ArrowUp: { v: clamp(hsv.v + step) },
      ArrowDown: { v: clamp(hsv.v - step) },
    }[e.key];
    if (!patch) return;
    e.preventDefault();
    pick(patch);
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        popoverTarget={panelId}
        aria-label={`${label}: ${value}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-2xs text-slate-200 transition-colors hover:border-white/20",
          className
        )}
      >
        <span className="h-4 w-6 rounded border border-white/20" style={{ backgroundColor: value }} />
        {value.toLowerCase()}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label={label}
        onBeforeToggle={(e) => {
          if (e.newState === "open") place();
        }}
        onToggle={(e) => {
          setOpen(e.newState === "open");
          setDraft(null);
        }}
        className="fixed inset-auto m-0 rounded-xl border border-white/15 bg-slate-900 p-3 text-slate-100 shadow-2xl"
        style={{ width: PANEL_WIDTH }}
      >
        <div className="space-y-3">
          <div
            ref={areaRef}
            role="slider"
            tabIndex={0}
            aria-label={t.settings.colorArea}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={t.settings.colorAreaValue(Math.round(hsv.s * 100), Math.round(hsv.v * 100))}
            onKeyDown={handleKeys}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pickAt(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e);
            }}
            className="relative h-28 cursor-crosshair touch-none rounded-lg"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`,
            }}
          >
            <span
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_#fff,0_0_0_3px_rgb(0_0_0/0.6)]"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={360}
            value={Math.round(hsv.h)}
            onChange={(e) => pick({ h: Number(e.target.value) })}
            aria-label={t.settings.colorHue}
            className="block h-3 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-on-solid [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
            style={{ background: HUE_TRACK }}
          />
          <input
            value={draft ?? value.toLowerCase()}
            onChange={(e) => {
              const text = e.target.value.trim();
              setDraft(text);
              const hex = `#${text.replace(/^#/, "").toLowerCase()}`;
              if (isHexColor(hex)) onChange(hex);
            }}
            onBlur={() => setDraft(null)}
            maxLength={7}
            spellCheck={false}
            aria-label={t.settings.colorHex}
            className="h-8 w-full rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-xs text-slate-100"
          />
        </div>
      </div>
    </>
  );
};
