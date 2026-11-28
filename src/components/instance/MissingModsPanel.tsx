import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { instanceService } from "@/services/instanceService";
import {
  modpackService,
  newJobId,
  listenJobProgress,
  IMPORT_PROGRESS_EVENT,
  JobProgress,
  MissingModItem,
  ModpackImportResult,
} from "@/services/modpackService";
import { cn } from "@/lib/utils";

interface MissingModsPanelProps {
  result: ModpackImportResult;
  missingMods: MissingModItem[];
  onMissingModsChange: (mods: MissingModItem[]) => void;
  onFinish: () => void;
}

/** Dialog body listing the files still missing; finishing stays disabled until the list is empty. */
export const MissingModsPanel: React.FC<MissingModsPanelProps> = ({
  result,
  missingMods,
  onMissingModsChange,
  onFinish,
}) => {
  const { t } = useI18n();
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [isRescanning, setIsRescanning] = useState<boolean>(false);
  const isReady = missingMods.length === 0;

  const handleRetryDownloads = async () => {
    const importId = newJobId();
    setProgress(null);
    setIsRetrying(true);
    const unlisten = await listenJobProgress(IMPORT_PROGRESS_EVENT, importId, setProgress);
    try {
      const remaining = await modpackService.retryPackDownloads(result.instanceId, importId);
      onMissingModsChange(remaining);
    } catch (err) {
      toast(toUserMessage(err), "error");
    } finally {
      unlisten();
      setIsRetrying(false);
    }
  };

  const handleOpenAllPages = async () => {
    const urls = missingMods.map((m) => m.webUrl).filter(Boolean);
    if (urls.length > 0) {
      await modpackService.openExternalUrls(urls);
    }
  };

  const handleOpenModsFolder = async () => {
    await instanceService.openInstanceDirectory(result.instanceId, "mods");
  };

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      const remaining = await modpackService.rescanMissingMods(
        result.instanceId,
        missingMods
      );
      onMissingModsChange(remaining);
    } catch (err) {
      console.error("Rescan failed:", err);
      toast(t.errors.rescanFailed(toUserMessage(err)), "error");
    } finally {
      setIsRescanning(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning-400 shrink-0" />
          <DialogTitle className="text-base font-bold text-white">
            {t.importPack.missingTitle}
          </DialogTitle>
        </div>
        <DialogDescription className="text-xs text-slate-400 leading-relaxed pt-1">
          {t.importPack.missingDesc}
          {t.importPack.missingHint}
        </DialogDescription>
      </DialogHeader>

      {/* Status banner */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{t.importPack.instanceName}</span>
          <span className="font-semibold text-white">{result.instanceName}</span>
          <Badge variant="outline" className="text-3xs font-mono border-white/10">
            {result.loader} {result.version}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">{t.importPack.remaining}</span>
          <Badge
            variant={isReady ? "success" : "outline"}
            className={cn(
              "text-3xs font-mono font-bold",
              !isReady && "border-warning-500/50 text-warning-400 bg-warning-500/10",
            )}
          >
            {t.importPack.itemCount(missingMods.length)}
          </Badge>
        </div>
      </div>

      {/* Missing files, deliberately without per-item buttons */}
      <div className="space-y-1.5">
        <span className="text-xs font-semibold text-slate-300">{t.importPack.missingList}</span>
        <div className="h-64 rounded-xl border border-white/10 bg-black/30 overflow-hidden">
          <ScrollArea className="h-full w-full" viewportClassName="p-3">
            {missingMods.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-brand-light" />
                <p className="text-sm font-semibold text-white">{t.importPack.allDone}</p>
                <p className="text-xs text-slate-400">{t.importPack.finishHint}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {missingMods.map((mod, idx) => (
                  <div
                    key={`${mod.projectId}-${mod.fileId}-${mod.relPath ?? mod.fileName}`}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">
                          {idx + 1}. {mod.name}
                        </span>
                        {mod.projectId !== 0 && (
                          <Badge variant="outline" className="text-[9px] font-mono text-slate-400">
                            ID: {mod.projectId}
                          </Badge>
                        )}
                      </div>
                      <p className="text-2xs font-mono text-slate-400">
                        {t.importPack.targetFile(mod.fileName)}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-3xs border-warning-500/30 text-warning-400 bg-warning-950/20">
                      {t.importPack.waitingManual}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Footer actions; finish is disabled while anything is missing */}
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenAllPages}
            disabled={isReady}
            className="gap-1.5 text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
          >
            <ExternalLink className="h-3.5 w-3.5 text-brand-light" />
            {t.importPack.openAllPages}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenModsFolder}
            className="gap-1.5 text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
          >
            <FolderOpen className="h-3.5 w-3.5 text-brand-light" />
            {t.importPack.openModsFolder}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetryDownloads}
            disabled={isReady || isRetrying || isRescanning}
            className="gap-1.5 text-xs h-8 border-white/10"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRetrying && "animate-spin text-brand-light")} />
            {isRetrying && progress && progress.total > 0
              ? `${t.importPack.retryDownloads} ${progress.current}/${progress.total}`
              : t.importPack.retryDownloads}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRescan}
            disabled={isRescanning || isRetrying}
            className="gap-1.5 text-xs h-8 border-white/10"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRescanning && "animate-spin text-brand-light")} />
            {t.importPack.rescan}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isReady}
            onClick={onFinish}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-on-solid text-xs font-semibold h-8 px-4"
          >
            {t.importPack.finish}
          </Button>
        </div>
      </div>
    </>
  );
};
