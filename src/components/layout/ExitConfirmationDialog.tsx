import * as React from "react";
import { motion } from "motion/react";
import { AlertTriangle, Minimize2, Power, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

interface ExitConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runningCount: number;
  onHideToTray: () => void;
  onForceQuit: () => void;
}

export const ExitConfirmationDialog: React.FC<ExitConfirmationDialogProps> = ({
  open,
  onOpenChange,
  runningCount,
  onHideToTray,
  onForceQuit,
}) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/10 bg-slate-900 text-slate-100 shadow-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.2)]">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-100">
                {t.exit.title}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-slate-400">
                {t.exit.running(runningCount)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="my-2 rounded-xl border border-white/5 bg-slate-900/60 p-3.5 text-xs text-slate-300">
          <p className="leading-relaxed">
            {t.exit.warning}
          </p>
        </div>

        <DialogFooter className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="w-full border-white/10 bg-transparent text-xs text-slate-300 hover:bg-white/5 sm:w-auto"
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              {t.exit.cancel}
            </Button>
          </motion.div>

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              type="button"
              size="sm"
              onClick={onHideToTray}
              className="w-full bg-brand text-xs font-medium text-white shadow-[0_0_16px_color-mix(in_srgb,var(--fc-primary)_35%,transparent)] hover:bg-brand-light sm:w-auto"
            >
              <Minimize2 className="mr-1.5 h-3.5 w-3.5" />
              {t.exit.minimizeToTray}
            </Button>
          </motion.div>

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onForceQuit}
              className="w-full border border-red-500/30 bg-red-500/15 text-xs text-red-400 hover:bg-red-500/25 sm:w-auto"
            >
              <Power className="mr-1.5 h-3.5 w-3.5" />
              {t.exit.forceQuit}
            </Button>
          </motion.div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
