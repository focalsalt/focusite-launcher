import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Copy, Info, X } from "lucide-react";
import { dismissToast, subscribeToasts, ToastItem, ToastKind } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { SPRING_TOAST } from "@/lib/motion";

const STYLES: Record<ToastKind, string> = {
  success: "border-success-500/30 bg-success-950/90 text-success-200",
  error: "border-danger-500/30 bg-danger-950/90 text-danger-200",
  info: "border-white/15 bg-slate-900/95 text-slate-200",
};

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-success-400" />,
  error: <AlertTriangle className="h-4 w-4 shrink-0 text-danger-400" />,
  info: <Info className="h-4 w-4 shrink-0 text-slate-400" />,
};

export const Toaster: React.FC = () => {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
      {items.map((item) => (
        <motion.div
          key={item.id}
          layout
          initial={{ opacity: 0, x: 16, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 48, scale: 0.96 }}
          transition={SPRING_TOAST}
          className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-2xl backdrop-blur-xl ${STYLES[item.kind]}`}
        >
          {ICONS[item.kind]}
          <span className="flex-1 leading-relaxed">{item.message}</span>
          {item.kind === "error" && (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(item.message).catch(() => {})}
              aria-label="Copy"
              className="text-slate-400 hover:text-white"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissToast(item.id)}
            aria-label={t.common.closeNotice}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      ))}
      </AnimatePresence>
    </div>
  );
};
