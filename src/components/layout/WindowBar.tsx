import React, { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  startDragging,
  toggleMaximizeWindow,
} from "@/lib/tauriWindow";
import { useAppVersion } from "@/lib/useAppVersion";
import { useI18n } from "@/i18n";
import { Tip } from "@/components/ui/tooltip";

interface WindowBarProps {
  onClose?: () => void;
  title?: string;
  badge?: string | null;
  showIcon?: boolean;
}

export const WindowBar: React.FC<WindowBarProps> = ({
  onClose,
  title,
  badge,
  showIcon = true,
}) => {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState<boolean>(false);
  const appVersion = useAppVersion();
  // `badge` undefined = show the running app version; `null` = hide the badge.
  const shownBadge = badge === undefined ? (appVersion ? `v${appVersion}` : null) : badge;

  useEffect(() => {
    isWindowMaximized().then(setMaximized);

    const checkState = async () => {
      const state = await isWindowMaximized();
      setMaximized(state);
    };

    window.addEventListener("resize", checkState);
    return () => window.removeEventListener("resize", checkState);
  }, []);

  const handleToggleMaximize = async () => {
    await toggleMaximizeWindow();
    const state = await isWindowMaximized();
    setMaximized(state);
  };

  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      startDragging();
    }
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      onDoubleClick={handleToggleMaximize}
      className="relative z-[100] flex h-9 w-full select-none items-center justify-between border-b border-white/10 bg-slate-950 px-3 text-xs font-medium text-slate-300"
    >
      {/* Left: App Brand & Enlarged Custom SVG Icon (24px / h-6 w-6) */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className="flex items-center gap-2.5 cursor-default"
      >
        {showIcon && (
          <img
            src="/focusite-icon.svg"
            alt="Focusite"
            className="h-6 w-6 shrink-0 object-contain drop-shadow"
          />
        )}
        <span className="font-bold tracking-wide text-slate-100 truncate max-w-md">
          {title || "Focusite Launcher"}
        </span>
        {shownBadge && (
          <span className="rounded bg-brand/20 px-1.5 py-0.2 text-3xs text-brand-light border border-brand-light/30 font-mono font-medium shrink-0">
            {shownBadge}
          </span>
        )}
      </div>

      {/* Center Drag Area */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className="flex-1 h-full cursor-default"
      />

      {/* Right: Window Controls */}
      <div
        className="flex items-center h-full -mr-3"
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Tip label={t.windowBar.minimize}>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              minimizeWindow();
            }}
            aria-label={t.windowBar.minimize}
            className="flex h-9 w-11 items-center justify-center text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </Tip>

        <Tip label={maximized ? t.windowBar.restore : t.windowBar.maximize}>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleMaximize();
            }}
            aria-label={maximized ? t.windowBar.restore : t.windowBar.maximize}
            className="flex h-9 w-11 items-center justify-center text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-colors"
          >
            {maximized ? (
              <Copy className="h-3 w-3 rotate-180" />
            ) : (
              <Square className="h-3 w-3" />
            )}
          </button>
        </Tip>

        <Tip label={t.windowBar.close}>
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              if (onClose) {
                onClose();
              } else {
                closeWindow();
              }
            }}
            aria-label={t.windowBar.close}
            className="flex h-9 w-11 items-center justify-center text-slate-400 hover:bg-danger-600 hover:text-on-solid transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>
    </header>
  );
};
