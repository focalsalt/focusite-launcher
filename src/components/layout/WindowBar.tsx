import React, { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  startDragging,
  toggleMaximizeWindow,
} from "@/lib/tauriWindow";

export const WindowBar: React.FC = () => {
  const [maximized, setMaximized] = useState<boolean>(false);

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
      className="relative z-50 flex h-9 w-full select-none items-center justify-between border-b border-white/10 bg-slate-950 px-3 text-xs font-medium text-slate-300"
    >
      {/* Left: App Brand & Enlarged Custom SVG Icon (24px / h-6 w-6) */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className="flex items-center gap-2.5 cursor-default"
      >
        <img
          src="/focusite-icon.svg"
          alt="Focusite"
          className="h-6 w-6 shrink-0 object-contain drop-shadow"
        />
        <span className="font-bold tracking-wide text-slate-100">
          Focusite Launcher
        </span>
        <span className="rounded bg-[#3C8527]/20 px-1.5 py-0.2 text-[10px] text-[#52A43A] border border-[#52A43A]/30 font-mono font-medium">
          v26.1.0
        </span>
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            minimizeWindow();
          }}
          title="最小化"
          className="flex h-9 w-11 items-center justify-center text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-colors"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleMaximize();
          }}
          title={maximized ? "向下還原" : "最大化"}
          className="flex h-9 w-11 items-center justify-center text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-colors"
        >
          {maximized ? (
            <Copy className="h-3 w-3 rotate-180" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeWindow();
          }}
          title="關閉"
          className="flex h-9 w-11 items-center justify-center text-slate-400 hover:bg-rose-600 hover:text-white transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
};
