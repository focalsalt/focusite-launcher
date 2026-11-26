import React from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/formatBytes";
import { useI18n } from "@/i18n";
import type { JobProgress } from "@/services/modpackService";

export interface TransferStage {
  key: string;
  label: string;
}

interface TransferProgressProps {
  stages: TransferStage[];
  progress: JobProgress | null;
  /** Shown while a cancel is pending; the button stays disabled. */
  cancelling: boolean;
  onCancel: () => void;
}

/** Steps that report bytes; the others report a count of files. */
const BYTE_STEPS = new Set(["download", "read", "copy", "pack"]);

/** Stage list with a bar for the running stage; shared by the import and export dialogs. */
export const TransferProgress: React.FC<TransferProgressProps> = ({ stages, progress, cancelling, onCancel }) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = React.useState<boolean>(false);

  // A first click only asks; the second click within a few seconds cancels.
  React.useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirming]);

  const finished = progress?.step === "done";
  const found = progress ? stages.findIndex((s) => s.key === progress.step) : -1;
  const activeIdx = finished ? stages.length : Math.max(found, 0);
  const total = progress?.total ?? 0;
  const current = progress?.current ?? 0;
  const known = total > 0;
  const percent = known ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const bytes = !!progress && BYTE_STEPS.has(progress.step);

  return (
    <div className="space-y-4">
      <ol className="space-y-2.5">
        {stages.map((stage, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <li key={stage.key} className="space-y-1.5">
              <div className="flex items-center gap-2.5 text-sm">
                {done ? (
                  <Check className="h-4 w-4 shrink-0 text-brand-light" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-light" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-slate-600" />
                )}
                <span aria-live="polite" className={done ? "text-slate-400" : active ? "font-semibold text-white" : "text-slate-400"}>
                  {stage.label}
                </span>
                {active && known && (
                  <span className="ml-auto font-mono text-xs text-slate-300">
                    {bytes ? `${formatBytes(current)} / ${formatBytes(total)}` : `${current} / ${total}`}
                  </span>
                )}
              </div>
              {active && (
                <div className="ml-[26px] space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    {known ? (
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand to-brand-light transition-[width] duration-200"
                        style={{ width: `${percent}%` }}
                      />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-brand/70" />
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-2xs text-slate-400">
                    <span className="min-w-0 truncate font-mono">
                      {progress?.retry ? `${t.transfer.retrying(progress.retry)} · ` : ""}
                      {progress?.message}
                    </span>
                    {bytes && !!progress?.speedBytesPerSec && (
                      <span className="shrink-0 font-mono">{formatBytes(progress.speedBytesPerSec)}/s</span>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex justify-center pt-1">
        <Button
          type="button"
          variant="glass"
          size="sm"
          disabled={cancelling || finished}
          onClick={() => {
            if (confirming) {
              setConfirming(false);
              onCancel();
            } else {
              setConfirming(true);
            }
          }}
        >
          {cancelling ? t.transfer.cancelling : confirming ? t.transfer.cancelConfirm : t.transfer.cancel}
        </Button>
      </div>
    </div>
  );
};
