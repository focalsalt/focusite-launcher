import React from "react";
import { motion } from "motion/react";

/**
 * MainBootOverlay seamlessly bridges the visual gap between splash dismissal
 * and the first rasterized frame of the main 1280x720 workspace canvas.
 * Positioned right below the draggable WindowBar (top-9 / 36px) with z-50.
 */
export const MainBootOverlay: React.FC = () => {
  return (
    <motion.div
      key="main-boot-overlay"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{
        opacity: 0,
        scale: 1.012,
        transition: { duration: 0.22, ease: "easeOut" },
      }}
      className="absolute inset-0 top-9 z-50 flex flex-col items-center justify-center bg-[#0a0f1d] select-none overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 50% 45%, rgba(60, 133, 39, 0.18) 0%, rgba(10, 15, 29, 0.98) 72%)",
      }}
      data-tauri-drag-region
    >
      <div
        className="relative z-10 flex flex-col items-center justify-center space-y-4"
        data-tauri-drag-region
      >
        <div
          data-tauri-drag-region
          className="relative flex items-center justify-center animate-pulse duration-1000"
        >
          <svg
            className="drop-shadow-[0_0_24px_rgba(82,164,58,0.45)]"
            width="68"
            height="68"
            viewBox="0 0 512 512"
            fill="none"
          >
            <polygon points="256,72 416,164 256,256 96,164" fill="#52A43A" />
            <polygon points="96,164 256,256 256,440 96,348" fill="#3C8527" />
            <polygon points="256,256 416,164 416,348 256,440" fill="#2E6B1D" />
            <g
              stroke="#FFFFFF"
              strokeWidth="16"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            >
              <path d="M 216,216 L 216,196 L 236,196" />
              <path d="M 276,196 L 296,196 L 296,216" />
              <path d="M 216,296 L 216,316 L 236,316" />
              <path d="M 276,316 L 296,316 L 296,296" />
            </g>
            <polygon points="256,238 274,256 256,274 238,256" fill="#FFFFFF" />
          </svg>
        </div>

        <div
          className="text-center flex flex-col items-center"
          data-tauri-drag-region
        >
          <div
            data-tauri-drag-region
            className="text-base font-bold tracking-wide text-slate-100 drop-shadow"
          >
            Focusite Launcher
          </div>
          <div
            data-tauri-drag-region
            className="mt-2 flex items-center gap-2"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.9)] animate-ping" />
            <span
              data-tauri-drag-region
              className="text-xs text-slate-400 tracking-wide"
            >
              正在準備工作區畫布...
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
