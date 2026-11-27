import React, { useEffect, useRef, useState } from "react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { downloadDir, join } from "@tauri-apps/api/path";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, PackageOpen } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  modpackService,
  newJobId,
  listenJobProgress,
  EXPORT_PROGRESS_EVENT,
  type ExportEntry,
  type JobProgress,
} from "@/services/modpackService";
import { TransferProgress, type TransferStage } from "./TransferProgress";
import { formatBytes } from "@/lib/formatBytes";
import { isCancelled, toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";

/** Import reads a whole archive into memory and asks for confirmation above this size (mirrors MAX_PACK_BYTES). */
const IMPORT_CONFIRM_BYTES = 1024 * 1024 * 1024;
/** Import refuses archives above this size (mirrors HARD_MAX_PACK_BYTES). */
const IMPORT_HARD_BYTES = 4 * 1024 * 1024 * 1024;

interface ExportInstanceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId: string;
  instanceName: string;
}

const isUnder = (path: string, ancestor: string) => path === ancestor || path.startsWith(`${ancestor}/`);

/** Picks what to pack, where to save it, and shows the progress of the export. */
export const ExportInstanceDialog: React.FC<ExportInstanceDialogProps> = ({ isOpen, onClose, instanceId, instanceName }) => {
  const { t } = useI18n();
  // Folder path ("" = top level) -> its listed entries. A selected path stands for everything below it.
  const [children, setChildren] = useState<Record<string, ExportEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(false);
  const [destPath, setDestPath] = useState<string>("");
  const [exporting, setExporting] = useState<boolean>(false);
  const exportingRef = useRef<boolean>(false);
  const exportIdRef = useRef<string>("");
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [cancelling, setCancelling] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setDestPath("");
    setChildren({});
    setExpanded(new Set());
    modpackService
      .listExportEntries(instanceId)
      .then((list) => {
        if (cancelled) return;
        setChildren({ "": list });
        setSelected(new Set(list.filter((e) => e.defaultIncluded).map((e) => e.path)));
      })
      .catch((err) => !cancelled && toast(`${t.exportInst.loadFailed}: ${toUserMessage(err)}`, "error"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, instanceId]);

  const rootEntries = children[""] ?? [];
  const isChecked = (path: string) => [...selected].some((s) => isUnder(path, s));
  const isPartial = (path: string) => !isChecked(path) && [...selected].some((s) => s.startsWith(`${path}/`));

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const owner = [...prev].find((s) => isUnder(path, s));
      if (!owner) {
        for (const s of prev) if (s.startsWith(`${path}/`)) next.delete(s);
        next.add(path);
        return next;
      }
      // Unticking something inside a ticked folder: keep its listed siblings, drop only this one.
      next.delete(owner);
      let cur = owner;
      for (const part of path.slice(owner.length).split("/").filter(Boolean)) {
        const down = `${cur}/${part}`;
        for (const sib of children[cur] ?? []) if (sib.path !== down) next.add(sib.path);
        cur = down;
      }
      return next;
    });

  const toggleExpand = async (path: string) => {
    const open = expanded.has(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
    if (open || children[path] || loadingDirs.has(path)) return;
    setLoadingDirs((prev) => new Set(prev).add(path));
    try {
      const list = await modpackService.listExportEntries(instanceId, path);
      setChildren((prev) => ({ ...prev, [path]: list }));
    } catch (err) {
      toast(`${t.exportInst.loadFailed}: ${toUserMessage(err)}`, "error");
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  };

  const sizeOf = new Map(Object.values(children).flat().map((e) => [e.path, e.sizeBytes]));
  const selectedSize = [...selected].reduce((sum, p) => sum + (sizeOf.get(p) ?? 0), 0);

  const renderRows = (dir: string, depth: number): React.ReactNode =>
    (children[dir] ?? []).map((e) => (
      <React.Fragment key={e.path}>
        <div className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs hover:bg-white/5" style={{ paddingLeft: 8 + depth * 16 }}>
          {e.expandable ? (
            <button type="button" onClick={() => toggleExpand(e.path)} className="shrink-0 text-slate-400 hover:text-white">
              {expanded.has(e.path) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={isChecked(e.path)}
              ref={(el) => {
                if (el) el.indeterminate = isPartial(e.path);
              }}
              onChange={() => toggle(e.path)}
              className="h-3.5 w-3.5 accent-[var(--color-brand,#4ade80)]"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-slate-200">
              {e.name}
              {e.isDir ? "/" : ""}
            </span>
            <span className="shrink-0 font-mono text-2xs text-slate-400">{formatBytes(e.sizeBytes)}</span>
          </label>
        </div>
        {expanded.has(e.path) &&
          (loadingDirs.has(e.path) ? (
            <div className="flex items-center py-1" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
              <Loader2 className="h-3 w-3 animate-spin text-brand-light" />
            </div>
          ) : (
            renderRows(e.path, depth + 1)
          ))}
      </React.Fragment>
    ));

  const pickDest = async () => {
    try {
      const safe = instanceName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
      // Start in the Downloads folder; fall back to the dialog's own default if it cannot be resolved.
      const defaultPath = await (async () => join(await downloadDir(), `${safe}.zip`))().catch(() => `${safe}.zip`);
      const path = await saveFileDialog({
        defaultPath,
        filters: [{ name: t.exportInst.filterName, extensions: ["zip"] }],
      });
      if (path) setDestPath(path);
    } catch (err) {
      toast(t.errors.fileDialogFailed(toUserMessage(err)), "error");
    }
  };

  const start = async () => {
    if (exportingRef.current) return;
    if (!destPath) {
      toast(t.exportInst.noDest, "error");
      return;
    }
    exportingRef.current = true;
    const exportId = newJobId();
    exportIdRef.current = exportId;
    setProgress(null);
    setCancelling(false);
    setExporting(true);
    const unlisten = await listenJobProgress(EXPORT_PROGRESS_EVENT, exportId, setProgress);
    try {
      const written = await modpackService.exportInstance(instanceId, destPath, [...selected], exportId);
      toast(t.exportInst.done(written), "success", 8000);
      onClose();
    } catch (err) {
      if (isCancelled(err)) toast(t.exportInst.cancelled, "info");
      else toast(toUserMessage(err), "error");
    } finally {
      unlisten();
      exportingRef.current = false;
      setExporting(false);
      setCancelling(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    await modpackService.cancelJob(exportIdRef.current);
  };

  if (exporting) {
    const stages: TransferStage[] = [
      { key: "scan", label: t.transfer.stages.scan },
      { key: "pack", label: t.transfer.stages.pack },
    ];
    return (
      <Dialog open={isOpen} onOpenChange={() => {}} preventBackdropClose>
        <DialogContent className="max-w-lg border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">{t.exportInst.exporting}</DialogTitle>
            <DialogDescription className="truncate text-xs text-slate-400">{instanceName}</DialogDescription>
          </DialogHeader>
          <TransferProgress stages={stages} progress={progress} cancelling={cancelling} onCancel={cancel} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent onClose={onClose} className="max-w-xl border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5 shrink-0 text-brand-light" />
            <DialogTitle className="text-base font-bold text-white">{t.exportInst.title}</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-xs leading-relaxed text-slate-400">{t.exportInst.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">{t.exportInst.content}</span>
            <div className="flex items-center gap-3 text-2xs text-slate-400">
              <button type="button" className="hover:text-white" onClick={() => setSelected(new Set(rootEntries.map((e) => e.path)))}>
                {t.exportInst.selectAll}
              </button>
              <button type="button" className="hover:text-white" onClick={() => setSelected(new Set())}>
                {t.exportInst.selectNone}
              </button>
            </div>
          </div>
          <div className="h-64 overflow-hidden rounded-xl border border-white/10 bg-black/30">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-brand-light" />
              </div>
            ) : (
              <ScrollArea className="h-full w-full" viewportClassName="p-2">
                {renderRows("", 0)}
              </ScrollArea>
            )}
          </div>
          <p className="text-2xs text-slate-400">{t.exportInst.always}</p>
          <p className="text-2xs text-slate-400">{t.exportInst.selected(selected.size, formatBytes(selectedSize))}</p>
          {selectedSize > IMPORT_CONFIRM_BYTES && (
            <p className="flex items-start gap-1.5 text-2xs text-warning-300">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {selectedSize > IMPORT_HARD_BYTES ? t.exportInst.tooLargeHard : t.exportInst.tooLarge}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="export-destination" className="text-xs font-semibold text-slate-300">{t.exportInst.dest}</label>
          <div className="flex items-center gap-2">
            <Input id="export-destination" readOnly value={destPath} placeholder={t.exportInst.destPlaceholder} className="h-9 flex-1 bg-black/30 font-mono" />
            <Button type="button" variant="outline" size="sm" onClick={pickDest} className="h-9 shrink-0">
              {t.exportInst.pickDest}
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="glass" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="button" size="sm" disabled={loading || !destPath} onClick={start} className="px-4">
            {t.exportInst.start}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
