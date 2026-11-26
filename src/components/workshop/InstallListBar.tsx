import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

interface InstallListBarProps {
  entries: { title: string; versionNumber: string }[];
  isResolving: boolean;
  onClear: () => void;
  onReview: () => void;
}

/** Footer of the workshop window: what is selected for install. */
export const InstallListBar: React.FC<InstallListBarProps> = ({ entries, isResolving, onClear, onReview }) => {
  const { t } = useI18n();
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-t border-white/10 bg-slate-950/80 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Badge variant="outline" className="shrink-0 border-brand-light/40 px-2.5 py-1 text-brand-light">
          {t.workshopWin.selectedCount(entries.length)}
        </Badge>
        <span className="truncate text-2xs text-slate-400">
          {entries.map((e) => `${e.title} ${e.versionNumber}`).join(" · ")}
        </span>
        <AnimatePresence>
          {entries.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
              className="shrink-0"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                className="h-7 px-2 text-xs text-slate-400 hover:text-danger-400"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t.workshopWin.clearSelection}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Button disabled={entries.length === 0 || isResolving} onClick={onReview}>
        {isResolving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t.workshopWin.resolving}
          </>
        ) : (
          <>
            <Sparkles className="mr-1.5 h-4 w-4" />
            {t.workshopWin.reviewInstall(entries.length)}
          </>
        )}
      </Button>
    </div>
  );
};
