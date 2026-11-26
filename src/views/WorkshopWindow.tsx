import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { Search, Plus, Minus, Loader2, FileBox } from "lucide-react";
import { WindowBar } from "@/components/layout/WindowBar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { InstallListBar } from "@/components/workshop/InstallListBar";
import { useInstallPlan } from "@/components/workshop/useInstallPlan";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/Toaster";
import { instanceService } from "@/services/instanceService";
import { MinecraftInstance } from "@/types/navigation";
import {
  workshopService,
  WorkshopProjectSummary,
  WorkshopCategory,
} from "@/services/workshopService";
import { InstallPlanConfirmDialog } from "@/components/workshop/InstallPlanConfirmDialog";
import { ProjectRow } from "@/components/workshop/ProjectRow";
import { FilterSidebar, Sort, Env } from "@/components/workshop/FilterSidebar";
import { ProjectDetailPanel } from "@/components/workshop/ProjectDetailPanel";
import { useProjectDetail } from "@/components/workshop/useProjectDetail";
import { useVersionManifest } from "@/components/instance/VersionLoaderFields";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { revealCurrentWindow } from "@/lib/tauriWindow";
import { useI18n } from "@/i18n";

type ProjectType = "mod" | "resourcepack" | "shader";

interface SelectedEntry {
  versionId: string;
  title: string;
  versionNumber: string;
}

const PAGE_SIZE = 30;

function readParam(key: string): string {
  try {
    const hash = window.location.hash;
    const q = hash.indexOf("?");
    const fromHash = q !== -1 ? new URLSearchParams(hash.substring(q)).get(key) : null;
    return fromHash ?? new URLSearchParams(window.location.search).get(key) ?? "";
  } catch {
    return "";
  }
}

export const WorkshopWindow: React.FC = () => {
  const { t } = useI18n();
  const [instanceId] = useState<string>(() => readParam("instanceId"));
  const [projectType] = useState<ProjectType>(() => {
    const v = readParam("type");
    return v === "resourcepack" || v === "shader" ? v : "mod";
  });

  const [instance, setInstance] = useState<MinecraftInstance | null>(null);
  const [instanceReady, setInstanceReady] = useState<boolean>(!instanceId);

  // Filters
  const [queryInput, setQueryInput] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [sort, setSort] = useState<Sort>("relevance");
  const [env, setEnv] = useState<Env | null>(null);
  const [gameVersion, setGameVersion] = useState<string>("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<WorkshopCategory[]>([]);
  const { manifest } = useVersionManifest(true);

  // Results
  const [projects, setProjects] = useState<WorkshopProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Detail panel
  const [activeProject, setActiveProject] = useState<WorkshopProjectSummary | null>(null);

  // Install list + dependency confirmation
  const [selected, setSelected] = useState<Map<string, SelectedEntry>>(new Map());
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => void revealCurrentWindow()));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!instanceId) return;
    instanceService
      .getInstance(instanceId)
      .then((inst) => {
        if (!inst) return;
        setInstance(inst);
        // Default the version filter to the instance's own version.
        if (inst.version !== "Custom") setGameVersion(inst.version);
      })
      .catch((err) => toast(toUserMessage(err), "error"))
      .finally(() => setInstanceReady(true));
  }, [instanceId]);

  useEffect(() => {
    workshopService
      .listCategories(projectType)
      .then(setCategories)
      .catch((err) => toast(toUserMessage(err), "error"));
  }, [projectType]);

  // Authors often leave game versions un-updated, so other versions stay selectable (with a warning).
  const instanceVersion = instance && instance.version !== "Custom" ? instance.version : undefined;

  // Mods are always filtered by the instance's loader; other pack types have none.
  const loader = projectType === "mod" && instance?.loader ? String(instance.loader) : undefined;

  const mcVersions = useMemo(() => {
    const ids = (manifest?.versions ?? []).filter((v) => v.type === "release").map((v) => v.id);
    if (instance && instance.version !== "Custom" && !ids.includes(instance.version)) ids.unshift(instance.version);
    return ids;
  }, [manifest, instance]);

  const searchSeq = useRef(0);
  const runSearch = useCallback(
    async (offset: number) => {
      const seq = ++searchSeq.current;
      if (offset === 0) setIsLoading(true);
      else setIsLoadingMore(true);
      try {
        const results = await workshopService.searchProjects(
          query,
          projectType,
          gameVersion || undefined,
          loader,
          offset,
          PAGE_SIZE,
          { categories: [...picked], environment: env ?? undefined, sort },
        );
        if (seq !== searchSeq.current) return;
        setProjects((prev) => (offset === 0 ? results : [...prev, ...results]));
        setHasMore(results.length === PAGE_SIZE);
      } catch (err) {
        if (seq === searchSeq.current) toast(toUserMessage(err, t.workshopWin.searchFailed), "error");
      } finally {
        if (seq === searchSeq.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [query, projectType, gameVersion, loader, picked, env, sort, t],
  );

  // Any filter change restarts the search from the first page.
  useEffect(() => {
    if (!instanceReady) return;
    void runSearch(0);
  }, [instanceReady, runSearch]);

  const activeId = activeProject?.id;
  const { detail, versions, versionId, setVersionId, isLoading: isLoadingDetail } = useProjectDetail(
    activeId,
    gameVersion,
    loader,
    activeId ? selected.get(activeId)?.versionId : undefined,
    undefined,
    instanceVersion,
  );

  const currentVersion = versions.find((v) => v.id === versionId);
  const isSelected = activeId ? selected.has(activeId) : false;

  const toggleSelected = () => {
    if (!activeProject) return;
    const next = new Map(selected);
    if (isSelected) {
      next.delete(activeProject.id);
    } else {
      if (!currentVersion) {
        toast(t.workshopWin.pickVersionFirst, "error");
        return;
      }
      next.set(activeProject.id, {
        versionId: currentVersion.id,
        title: activeProject.title,
        versionNumber: currentVersion.version_number,
      });
      toast(t.workshopWin.addedToast(activeProject.title), "success");
    }
    setSelected(next);
  };

  const changeVersion = (id: string) => {
    setVersionId(id);
    const v = versions.find((x) => x.id === id);
    const prev = activeId ? selected.get(activeId) : undefined;
    if (activeId && v && prev) {
      setSelected(new Map(selected).set(activeId, { ...prev, versionId: v.id, versionNumber: v.version_number }));
    }
  };

  const installFlow = useInstallPlan(instanceId, projectType, selected, () => setSelected(new Map()));

  const typeName =
    projectType === "mod"
      ? t.workshop.filterMods
      : projectType === "resourcepack"
        ? t.workshop.filterResourcePacks
        : t.workshopWin.typeShader;

  const toggleCategory = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const defaultVersion = instance && instance.version !== "Custom" ? instance.version : "";
  const hasActiveFilters = picked.size > 0 || env !== null || sort !== "relevance" || gameVersion !== defaultVersion;
  const resetFilters = () => {
    setPicked(new Set());
    setEnv(null);
    setSort("relevance");
    setGameVersion(defaultVersion);
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-canvas text-slate-100 select-none">
      <WindowBar title={t.workshopWin.windowTitle(instance?.name || t.workshopWin.unknownInstance, typeName)} />

      <div className="flex min-h-0 flex-1">
        <FilterSidebar
          sort={sort}
          onSort={setSort}
          gameVersion={gameVersion}
          onGameVersion={setGameVersion}
          mcVersions={mcVersions}
          env={env}
          onEnv={projectType === "mod" ? setEnv : undefined}
          categories={categories}
          picked={picked}
          onToggleCategory={toggleCategory}
          onReset={resetFilters}
          hasActive={hasActiveFilters}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-4">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder={t.workshopWin.searchPlaceholder(typeName)}
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setQuery(queryInput.trim())}
                className="h-8 pl-9"
              />
            </div>
            <Button size="sm" onClick={() => setQuery(queryInput.trim())} disabled={isLoading}>
              {t.workshopWin.search}
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1" viewportClassName="p-4">
            {isLoading ? (
              <div className="flex h-64 flex-col items-center justify-center text-slate-400">
                <Loader2 className="mb-3 h-8 w-8 animate-spin text-brand-light" />
                <p className="text-sm">{t.workshopWin.loading}</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-slate-400">
                <FileBox className="mb-3 h-12 w-12 text-slate-600" />
                <p className="text-sm">{t.workshopWin.noResults}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {projects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    active={p.id === activeId}
                    checked={selected.has(p.id)}
                    onSelect={setActiveProject}
                  />
                ))}
                {hasMore && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isLoadingMore}
                    onClick={() => void runSearch(projects.length)}
                    className="mx-auto mt-2 flex"
                  >
                    {isLoadingMore ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        {t.workshopWin.loadingMore}
                      </>
                    ) : (
                      t.workshopWin.loadMore
                    )}
                  </Button>
                )}
              </div>
            )}
          </ScrollArea>
        </main>

        <AnimatePresence initial={false}>
          {activeProject && (
            <ProjectDetailPanel
              key="detail"
              project={activeProject}
              projectType={projectType}
              detail={detail}
              versions={versions}
              versionId={versionId}
              warnGameVersion={instanceVersion}
              onVersionChange={changeVersion}
              isLoading={isLoadingDetail}
              onClose={() => setActiveProject(null)}
              action={
                <Button
                  size="sm"
                  variant={isSelected ? "outline" : "default"}
                  disabled={!isSelected && !currentVersion}
                  onClick={toggleSelected}
                  className="w-full"
                >
                  {isSelected ? (
                    <>
                      <Minus className="mr-1.5 h-3.5 w-3.5" />
                      {t.workshopWin.removeFromList}
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      {t.workshopWin.addToList}
                    </>
                  )}
                </Button>
              }
            />
          )}
        </AnimatePresence>
      </div>

      <InstallListBar
        entries={[...selected.values()]}
        isResolving={installFlow.isResolvingPlan}
        onClear={() => setSelected(new Map())}
        onReview={installFlow.openPlanDialog}
      />

      <InstallPlanConfirmDialog
        open={installFlow.planDialogOpen}
        onOpenChange={installFlow.setPlanDialogOpen}
        plan={installFlow.installPlan}
        onConfirm={installFlow.executeInstall}
        isInstalling={installFlow.isInstalling}
      />
      <Toaster />
    </div>
  );
};
