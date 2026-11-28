import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DownloadCloud, CheckCircle2, Cpu, Package, Layers, FileCode } from "lucide-react";
import { listenSafe } from "@/lib/listenSafe";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export interface InstanceProvisionProgress {
  instance_id: string;
  step: "manifest" | "client_jar" | "libraries" | "assets" | "java" | "loader" | "done" | "error";
  message: string;
  current: number;
  total: number;
  percentage: number;
  speed_bytes_per_sec: number;
}

interface LaunchInstallModalProps {
  activeInstanceId: string | null;
}

const STEPS: {
  key: string;
  labelKey: "stepManifest" | "stepClient" | "stepLibraries" | "stepAssets" | "stepJava" | "stepLoader";
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "manifest", labelKey: "stepManifest", icon: FileCode },
  { key: "client_jar", labelKey: "stepClient", icon: DownloadCloud },
  { key: "libraries", labelKey: "stepLibraries", icon: Package },
  { key: "assets", labelKey: "stepAssets", icon: Layers },
  { key: "java", labelKey: "stepJava", icon: Cpu },
  { key: "loader", labelKey: "stepLoader", icon: Package },
];

export const LaunchInstallModal: React.FC<LaunchInstallModalProps> = ({
  activeInstanceId,
}) => {
  const { t } = useI18n();
  const [progress, setProgress] = useState<InstanceProvisionProgress | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    return listenSafe<InstanceProvisionProgress>("instance-install-progress", (event) => {
      const payload = event.payload;
      if (activeInstanceId && payload.instance_id !== activeInstanceId) {
        return;
      }

      if (payload.step === "error") {
        setIsOpen(false);
      } else if (payload.step === "done") {
        setProgress(payload);
        setTimeout(() => {
          setIsOpen(false);
        }, 600);
      } else {
        setProgress(payload);
        setIsOpen(true);
      }
    });
  }, [activeInstanceId]);

  // Keep the last progress after closing so the exit animation still has content to show.
  if (!progress) {
    return null;
  }

  const speedMb = (progress.speed_bytes_per_sec / (1024 * 1024)).toFixed(1);
  const currentStepIdx = STEPS.findIndex((s) => s.key === progress.step);

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-md border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DownloadCloud className="h-5 w-5 text-brand-light animate-pulse" />
            <DialogTitle className="text-base font-bold text-white">
              {t.install.title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-400 pt-1">
            {t.install.description}
          </DialogDescription>
        </DialogHeader>

        {/* 步驟指示器 */}
        <div className="grid grid-cols-5 gap-1.5 py-2">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isFinished = idx < currentStepIdx || progress.step === "done";
            const isCurrent = idx === currentStepIdx && progress.step !== "done";

            return (
              <div
                key={s.key}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-xl border text-center transition-all",
                  isCurrent ? "bg-brand/20 border-brand-light text-white" : isFinished ? "bg-white/[0.04] border-white/10 text-success-400" : "bg-white/[0.01] border-white/5 text-slate-400",
                )}
              >
                {isFinished ? (
                  <CheckCircle2 className="h-4 w-4 text-brand-light" />
                ) : (
                  <Icon className={cn("h-4 w-4", isCurrent && "text-brand-light animate-bounce")} />
                )}
                <span className="text-3xs font-medium leading-none">{t.install[s.labelKey]}</span>
              </div>
            );
          })}
        </div>

        {/* 進度資訊 */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between text-xs">
            <span role="status" className="text-slate-300 font-medium truncate max-w-[280px]">
              {progress.message}
            </span>
            <span className="font-mono text-brand-light font-bold">
              {progress.percentage.toFixed(0)}%
            </span>
          </div>

          {/* 自訂平滑進度條 */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-brand to-brand-light transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress.percentage))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-2xs text-slate-400 font-mono pt-1">
            <span>
              {progress.total > 0
                ? `${progress.current} / ${progress.total}`
                : t.install.processing}
            </span>
            {progress.speed_bytes_per_sec > 0 && <span>{speedMb} MB/s</span>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
