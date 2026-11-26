import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ask as askDialog, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FolderDown,
  FolderOpen,
  AlertTriangle,
  FileArchive,
  Search,
  Loader2,
  Globe,
  Check,
} from "lucide-react";
import {
  modpackService,
  newJobId,
  listenJobProgress,
  IMPORT_PROGRESS_EVENT,
  MissingModItem,
  ModpackImportResult,
  PackInspection,
  JobProgress,
} from "@/services/modpackService";
import { TransferProgress, type TransferStage } from "./TransferProgress";
import { MissingModsPanel } from "./MissingModsPanel";
import { formatBytes } from "@/lib/formatBytes";
import { workshopService, WorkshopProjectSummary, WorkshopCategory } from "@/services/workshopService";
import { FilterSidebar, Sort } from "@/components/workshop/FilterSidebar";
import { ProjectDetailPanel } from "@/components/workshop/ProjectDetailPanel";
import { useProjectDetail } from "@/components/workshop/useProjectDetail";
import { useVersionManifest } from "./VersionLoaderFields";
import { isCancelled, toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { ProjectRow } from "@/components/workshop/ProjectRow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n";

interface ImportModpackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (instanceId: string) => void;
}

export const ImportModpackDialog: React.FC<ImportModpackDialogProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const { t } = useI18n();
  const [packFilePath, setPackFilePath] = useState<string>("");
  const [source, setSource] = useState<"local" | "online">("local");
  const [onlineQuery, setOnlineQuery] = useState<string>("");
  const [onlineResults, setOnlineResults] = useState<WorkshopProjectSummary[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [selectedProject, setSelectedProject] = useState<WorkshopProjectSummary | null>(null);
  const [customName, setCustomName] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  // Set synchronously so a double click cannot start two imports before the state update lands.
  const importingRef = useRef<boolean>(false);
  const importIdRef = useRef<string>("");
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [inspection, setInspection] = useState<PackInspection | null>(null);
  const [inspectError, setInspectError] = useState<string>("");
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [sort, setSort] = useState<Sort>("relevance");
  const [gameVersion, setGameVersion] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<WorkshopCategory[]>([]);
  const [activeProject, setActiveProject] = useState<WorkshopProjectSummary | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<{ id: string; label: string } | null>(null);
  const { manifest } = useVersionManifest(isOpen);
  const mcVersions = useMemo(
    () => (manifest?.versions ?? []).filter((v) => v.type === "release").map((v) => v.id),
    [manifest],
  );
  const activeId = activeProject?.id;
  const { detail, versions, versionId, setVersionId, isLoading: isLoadingDetail } = useProjectDetail(
    activeId,
    gameVersion,
    undefined,
    activeId && selectedProject?.id === activeId ? selectedVersion?.id : undefined,
    (v) => v.filename.endsWith(".mrpack"),
  );
  const currentVersion = versions.find((v) => v.id === versionId);
  const [nameTouched, setNameTouched] = useState<boolean>(false);

  // 待補齊狀態
  const [importResult, setImportResult] = useState<ModpackImportResult | null>(null);
  const [missingMods, setMissingMods] = useState<MissingModItem[]>([]);

  // Describe the chosen file or folder before anything is imported, so problems show up early.
  useEffect(() => {
    const path = packFilePath.trim();
    if (source !== "local" || !path) {
      setInspection(null);
      setInspectError("");
      return;
    }
    let cancelled = false;
    setIsInspecting(true);
    const timer = window.setTimeout(() => {
      modpackService
        .inspectModpackFile(path, customName.trim() || undefined)
        .then((info) => {
          if (cancelled) return;
          setInspection(info);
          setInspectError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setInspection(null);
          setInspectError(toUserMessage(err));
        })
        .finally(() => !cancelled && setIsInspecting(false));
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, packFilePath, customName]);

  const nameInvalid = /[<>:"/\\|?*\u0000-\u001f]/.test(customName) || customName.trim().length > 64;

  const handleBrowseFile = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [
          {
            name: t.importPack.filterName,
            extensions: ["mrpack", "zip"],
          },
        ],
      });
      if (selected && typeof selected === "string") {
        setPackFilePath(selected);
        if (!nameTouched) {
          const filename = selected.split(/[\\/]/).pop() || "";
          const baseName = filename.replace(/\.(mrpack|zip)$/i, "");
          if (baseName) setCustomName(baseName);
        }
      }
    } catch (err) {
      console.error("Open file dialog error:", err);
      toast(t.errors.fileDialogFailed(toUserMessage(err)), "error");
    }
  };

  /** PCL version folder or Prism instance folder: its files are copied into a new instance. */
  const handleBrowseFolder = async () => {
    try {
      const selected = await openFileDialog({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setPackFilePath(selected);
        if (!nameTouched) {
          const folder = selected.split(/[\\/]/).filter(Boolean).pop() || "";
          if (folder) setCustomName(folder);
        }
      }
    } catch (err) {
      console.error("Open folder dialog error:", err);
      toast(t.errors.fileDialogFailed(toUserMessage(err)), "error");
    }
  };

  const searchOnline = async (query: string) => {
    setIsSearching(true);
    try {
      setOnlineResults(
        await workshopService.searchProjects(query, "modpack", gameVersion || undefined, undefined, 0, 30, {
          categories: [...picked],
          sort,
        }),
      );
    } catch (err) {
      toast(t.errors.onlineSearchFailed(toUserMessage(err)), "error");
    } finally {
      setIsSearching(false);
    }
  };

  // Search when the online source opens and whenever a filter changes.
  useEffect(() => {
    if (isOpen && source === "online") void searchOnline(onlineQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, source, sort, gameVersion, picked]);

  useEffect(() => {
    if (!isOpen || source !== "online" || categories.length > 0) return;
    workshopService
      .listCategories("modpack")
      .then(setCategories)
      .catch((err) => toast(toUserMessage(err), "error"));
  }, [isOpen, source, categories.length]);

  const toggleCategory = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const pickVersion = () => {
    if (!activeProject || !currentVersion) {
      toast(t.workshopWin.pickVersionFirst, "error");
      return;
    }
    setSelectedProject(activeProject);
    setSelectedVersion({ id: currentVersion.id, label: currentVersion.version_number });
    if (!nameTouched) setCustomName(activeProject.title);
  };

  const isPicked = !!activeProject && selectedProject?.id === activeProject.id && selectedVersion?.id === versionId;

  const handleStartImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (importingRef.current) return;
    if (source === "online") {
      if (!selectedProject) {
        toast(t.importPack.onlinePick, "error");
        return;
      }
    } else if (!packFilePath.trim()) {
      toast(t.importPack.pickPath, "error");
      return;
    } else if (inspectError || !inspection) {
      toast(inspectError || t.importPack.inspecting, "error");
      return;
    }
    if (nameInvalid) {
      toast(t.importPack.nameInvalid, "error");
      return;
    }

    // A file above 1 GiB is read into memory whole, so the user decides first.
    const large = source === "local" && !!inspection?.large;
    if (large) {
      const ok = await askDialog(t.importPack.largeConfirm(formatBytes(inspection?.sizeBytes ?? 0)), {
        title: t.importPack.largeConfirmTitle,
        kind: "warning",
        okLabel: t.importPack.largeConfirmOk,
        cancelLabel: t.common.cancel,
      });
      if (!ok) return;
    }

    importingRef.current = true;
    const importId = newJobId();
    importIdRef.current = importId;
    setProgress(null);
    setCancelling(false);
    setIsImporting(true);
    const unlisten = await listenJobProgress(IMPORT_PROGRESS_EVENT, importId, setProgress);
    try {
      const res =
        source === "online" && selectedProject
          ? await modpackService.importModrinthModpack(selectedProject.id, customName.trim() || undefined, selectedVersion?.id, importId)
          : await modpackService.importModpack(packFilePath.trim(), customName.trim() || undefined, importId, large);

      setImportResult(res);
      setMissingMods(res.missingMods);

      if (res.isCompleted) {
        const taken = res.imported.map((k) => t.importPack.importedItems[k as keyof typeof t.importPack.importedItems] ?? k);
        toast(t.importPack.doneToast(res.instanceName, taken), "success", 8000);
        onClose();
        onImportSuccess(res.instanceId);
      }
      // Otherwise the missing-mods view takes over.
    } catch (err: unknown) {
      if (isCancelled(err)) toast(t.importPack.cancelled, "info");
      else toast(toUserMessage(err), "error");
    } finally {
      unlisten();
      importingRef.current = false;
      setIsImporting(false);
      setCancelling(false);
    }
  };

  const handleCancelImport = async () => {
    setCancelling(true);
    await modpackService.cancelJob(importIdRef.current);
  };

  const handleFinish = () => {
    if (!importResult || missingMods.length > 0) return;
    onClose();
    onImportSuccess(importResult.instanceId);
  };

  const resetAll = () => {
    // Closing never cancels a running import; the dialog stays until it ends or is cancelled.
    if (importingRef.current) return;
    // The instance already exists on disk once the missing-mods view shows.
    if (importResult && missingMods.length > 0) toast(t.importPack.missingClosed(missingMods.length), "info", 6000);
    setInspection(null);
    setInspectError("");
    setPackFilePath("");
    setCustomName("");
    setSelectedProject(null);
    setSource("local");
    setNameTouched(false);
    setActiveProject(null);
    setSelectedVersion(null);
    setImportResult(null);
    setMissingMods([]);
    onClose();
  };

  // Running import: only the progress and the cancel button are left; nothing else can be picked.
  if (isImporting) {
    const isFolder = source === "local" && inspection?.format === "folder";
    const stageLabels = t.transfer.stages;
    const stages: TransferStage[] = (
      source === "online"
        ? ["download", "read", "overrides", "mods"]
        : isFolder
          ? ["read", "copy"]
          : inspection?.format === "focusite"
            ? ["read", "overrides"]
            : ["read", "overrides", "mods"]
    ).map((key) => ({ key, label: stageLabels[key as keyof typeof stageLabels] }));
    return (
      <Dialog open={isOpen} onOpenChange={() => {}} preventBackdropClose>
        <DialogContent className="max-w-lg border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">{t.importPack.importingTitle}</DialogTitle>
            <DialogDescription className="truncate text-xs text-slate-400">
              {customName.trim() || selectedProject?.title || inspection?.name || ""}
            </DialogDescription>
          </DialogHeader>
          <TransferProgress stages={stages} progress={progress} cancelling={cancelling} onCancel={handleCancelImport} />
        </DialogContent>
      </Dialog>
    );
  }

  // Missing-mods view: some files have to be downloaded by hand before the import is complete.
  if (importResult && !importResult.isCompleted) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && resetAll()}>
        <DialogContent onClose={resetAll} className="max-w-2xl border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl">
          <MissingModsPanel
            result={importResult}
            missingMods={missingMods}
            onMissingModsChange={setMissingMods}
            onFinish={handleFinish}
          />
        </DialogContent>
      </Dialog>
    );
  }

  const hasActiveFilters = picked.size > 0 || sort !== "relevance" || gameVersion !== "";
  const resetFilters = () => {
    setPicked(new Set());
    setSort("relevance");
    setGameVersion("");
  };

  // Import picker: fixed-height layout so the list scrolls and the footer is always reachable.
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && resetAll()}>
      <DialogContent
        onClose={resetAll}
        className="max-w-7xl overflow-hidden border-white/10 bg-slate-900/98 p-0 text-slate-100 shadow-2xl backdrop-blur-2xl"
      >
        <form onSubmit={handleStartImport} className="flex h-[min(86vh,780px)] flex-col select-none">
          <DialogHeader className="flex h-16 shrink-0 flex-row items-center justify-between gap-4 border-b border-white/10 px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-tr from-brand to-brand-dark text-white shadow-md shadow-brand/20">
                <FolderDown className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-100">{t.importPack.title}</DialogTitle>
                <DialogDescription className="text-xs text-slate-400">{t.importPack.desc}</DialogDescription>
              </div>
            </div>
            {/* Dropdown so further sources (e.g. CurseForge) can be added later. */}
            <div className="mr-8 w-60 shrink-0">
              <Select value={source} onValueChange={(v) => setSource(v as "local" | "online")}>
                <SelectTrigger className="h-9">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      {source === "local" ? (
                        <FolderOpen className="h-3.5 w-3.5 text-brand-light" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-brand-light" />
                      )}
                      {source === "local" ? t.importPack.sourceLocal : t.importPack.sourceOnline}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">{t.importPack.sourceLocal}</SelectItem>
                  <SelectItem value="online">{t.importPack.sourceOnline}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </DialogHeader>

          <AnimatePresence mode="popLayout" initial={false}>
            {source === "local" ? (
              <motion.div
                key="local"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="flex min-h-0 flex-1 flex-col justify-center gap-5 px-6"
              >
                <div className="mx-auto w-full max-w-xl space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">{t.importPack.pathLabel}</label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={packFilePath}
                      onChange={(e) => setPackFilePath(e.target.value)}
                      placeholder={t.importPack.pathPlaceholder}
                      className="h-9 flex-1 bg-black/30 font-mono"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={handleBrowseFile} className="h-9 shrink-0">
                      <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                      {t.inst.browseEllipsis}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleBrowseFolder} className="h-9 shrink-0">
                      <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                      {t.importPack.pickFolder}
                    </Button>
                  </div>
                </div>
                {packFilePath.trim() && (
                  <div className="mx-auto w-full max-w-xl rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
                    {isInspecting && !inspection && !inspectError ? (
                      <div className="flex items-center gap-2 text-slate-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-light" />
                        {t.importPack.inspecting}
                      </div>
                    ) : inspectError ? (
                      <div className="flex items-start gap-2 text-red-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                        <span className="leading-relaxed">{inspectError}</span>
                      </div>
                    ) : (
                      inspection && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-white">{inspection.name}</span>
                            <Badge variant="outline" className="border-white/10 font-mono text-3xs">
                              {inspection.loader} {inspection.version}
                            </Badge>
                            <Badge variant="outline" className="border-brand-light/30 text-3xs text-brand-light">
                              {t.importPack.formats[inspection.format]}
                            </Badge>
                          </div>
                          <p className="text-2xs text-slate-400">
                            {t.importPack.summary(inspection.fileCount, formatBytes(inspection.sizeBytes))}
                            {inspection.folderName !== inspection.name && ` · ${t.importPack.willCreateAs(inspection.folderName)}`}
                          </p>
                          {inspection.large && (
                            <p className="flex items-start gap-1.5 text-2xs text-amber-300">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              {t.importPack.largeNote(formatBytes(inspection.sizeBytes))}
                            </p>
                          )}
                          {inspection.imported.length > 0 && (
                            <p className="text-2xs text-slate-400">
                              {t.importPack.willImport}
                              {inspection.imported
                                .map((k) => t.importPack.importedItems[k as keyof typeof t.importPack.importedItems] ?? k)
                                .join("、")}
                            </p>
                          )}
                          {inspection.missingCurseforgeKey && (
                            <p className="flex items-start gap-1.5 text-2xs text-amber-300">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              {t.importPack.noCurseforgeKey}
                            </p>
                          )}
                        </div>
                      )
                    )}
                  </div>
                )}
                <div className="mx-auto w-full max-w-xl space-y-1 rounded-xl border border-white/5 bg-black/20 p-3 text-2xs leading-relaxed text-slate-400">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-300">
                    <FileArchive className="h-3.5 w-3.5 text-brand-light" />
                    <span>{t.importPack.formatEngine}</span>
                  </div>
                  <p>
                    • <strong className="text-slate-200">.mrpack</strong>
                    {t.importPack.mrpackNote}
                  </p>
                  <p>
                    • <strong className="text-slate-200">.zip</strong>
                    {t.importPack.zipNote}
                  </p>
                  <p>
                    • <strong className="text-slate-200">PCL / Prism Launcher</strong>
                    {t.importPack.launcherNote}
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="online"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="flex min-h-0 flex-1"
              >
                <FilterSidebar
                  sort={sort}
                  onSort={setSort}
                  gameVersion={gameVersion}
                  onGameVersion={setGameVersion}
                  mcVersions={mcVersions}
                  categories={categories}
                  picked={picked}
                  onToggleCategory={toggleCategory}
                  onReset={resetFilters}
                  hasActive={hasActiveFilters}
                />

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-4">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={onlineQuery}
                        onChange={(e) => setOnlineQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void searchOnline(onlineQuery);
                          }
                        }}
                        placeholder={t.importPack.onlineSearchPlaceholder}
                        className="h-8 bg-black/30 pl-9"
                      />
                    </div>
                    <Button type="button" size="sm" disabled={isSearching} onClick={() => void searchOnline(onlineQuery)}>
                      {t.importPack.onlineSearch}
                    </Button>
                  </div>

                  <ScrollArea className="min-h-0 flex-1" viewportClassName="p-4">
                    {isSearching ? (
                      <div className="flex h-64 items-center justify-center gap-2 text-xs text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin text-brand-light" />
                        {t.importPack.onlineSearching}
                      </div>
                    ) : onlineResults.length === 0 ? (
                      <div className="flex h-64 items-center justify-center text-xs text-slate-500">
                        {t.importPack.onlineNoResults}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {onlineResults.map((proj) => (
                          <ProjectRow
                            key={proj.id}
                            project={proj}
                            active={activeProject?.id === proj.id}
                            checked={selectedProject?.id === proj.id}
                            onSelect={setActiveProject}
                          />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>

                <AnimatePresence initial={false}>
                  {activeProject && (
                    <ProjectDetailPanel
                      key="detail"
                      project={activeProject}
                      projectType="modpack"
                      detail={detail}
                      versions={versions}
                      versionId={versionId}
                      onVersionChange={setVersionId}
                      isLoading={isLoadingDetail}
                      onClose={() => setActiveProject(null)}
                      action={
                        <Button
                          type="button"
                          size="sm"
                          variant={isPicked ? "outline" : "default"}
                          disabled={!currentVersion}
                          onClick={pickVersion}
                          className="w-full"
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          {isPicked ? t.importPack.picked : t.importPack.pickThis}
                        </Button>
                      }
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          <DialogFooter className="flex h-16 shrink-0 flex-row items-center gap-3 space-x-0 border-t border-white/10 bg-black/20 px-6 pt-0">
            {source === "online" && selectedProject && selectedVersion && (
              <Badge variant="outline" className="max-w-xs shrink-0 truncate border-brand-light/40 px-2.5 py-1 text-brand-light">
                {selectedProject.title} · {selectedVersion.label}
              </Badge>
            )}
            <Input
              value={customName}
              onChange={(e) => {
                setCustomName(e.target.value);
                setNameTouched(true);
              }}
              placeholder={t.importPack.customNamePlaceholder}
              aria-label={t.importPack.customNameLabel}
              aria-invalid={nameInvalid}
              className={`h-9 flex-1 bg-black/30 ${nameInvalid ? "border-red-500/60" : ""}`}
            />
            <Button type="button" variant="glass" size="sm" onClick={resetAll} className="shrink-0">
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={nameInvalid || (source === "local" && (isInspecting || !inspection))}
              className="shrink-0 px-4"
            >
              {t.importPack.startImport}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
