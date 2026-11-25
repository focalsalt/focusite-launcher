import { clearCachedFiles } from "@/lib/instanceFilesCache";
import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Box,
  AlertTriangle,
  Play,
  Square,
  Clock,
  Hourglass,
  FolderPlus,
  FolderOpen,
  Copy,
  Trash2,
  ChevronDown,
  Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MultiSelect } from "@/components/ui/multi-select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toAssetSrc } from "@/lib/assetUrl";
import { MinecraftInstance, RunningInstanceInfo } from "@/types/navigation";
import { instanceService } from "@/services/instanceService";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useLastValue } from "@/lib/useExitMount";

interface InstancesViewProps {
  instances: MinecraftInstance[];
  searchQuery: string;
  runningInstances?: Record<string, RunningInstanceInfo>;
  onSelectInstance: (instanceId: string) => void;
  onLaunchInstance: (instanceId: string) => void;
  onKillInstance?: (instanceId: string) => void;
  onInstancesChanged?: () => void;
  onInstanceDuplicated?: (newInstance: MinecraftInstance) => void;
  onInstanceDeleted?: (id: string) => void;
}

export const InstancesView: React.FC<InstancesViewProps> = ({
  instances,
  searchQuery,
  runningInstances = {},
  onSelectInstance,
  onLaunchInstance,
  onKillInstance,
  onInstancesChanged,
  onInstanceDuplicated,
  onInstanceDeleted,
}) => {
  const { t, language } = useI18n();

  const formatLastLaunched = (ms?: number): string =>
    ms ? new Date(ms).toLocaleString(language) : t.instances.neverPlayed;

  const formatPlayTime = (ms?: number): string => {
    if (!ms) return t.instances.playTimeNone;
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 1) return t.instances.durationLtMinute;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return h > 0 ? t.instances.durationHM(h, m) : t.instances.durationM(m);
  };

  // Create-group dialog: a group is the label on its member instances, so pick members now.
  const [groupDialogOpen, setGroupDialogOpen] = useState<boolean>(false);
  const [groupName, setGroupName] = useState<string>("");
  const [groupMembers, setGroupMembers] = useState<Set<string>>(new Set());
  const setGroupError = (msg: string) => toast(msg, "error");
  const [isCreatingGroup, setIsCreatingGroup] = useState<boolean>(false);

  const openGroupDialog = () => {
    setGroupName("");
    setGroupMembers(new Set());
    setGroupDialogOpen(true);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = groupName.trim();
    if (!name) {
      setGroupError(t.instances.groupNameRequired);
      return;
    }
    if (groupMembers.size === 0) {
      setGroupError(t.instances.groupPickRequired);
      return;
    }
    setIsCreatingGroup(true);
    try {
      for (const id of groupMembers) {
        await instanceService.updateInstanceSettings(id, { group: name });
      }
      setGroupDialogOpen(false);
      onInstancesChanged?.();
    } catch (err) {
      setGroupError(t.errors.groupFailed(toUserMessage(err)));
    } finally {
      setIsCreatingGroup(false);
    }
  };
  const [duplicateTarget, setDuplicateTarget] = useState<MinecraftInstance | null>(null);
  const [duplicateName, setDuplicateName] = useState<string>("");
  const [isDuplicating, setIsDuplicating] = useState<boolean>(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<MinecraftInstance | null>(null);
  const shownDeleteTarget = useLastValue(deleteTarget);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const handleDuplicate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!duplicateTarget) return;
    const trimmed = duplicateName.trim();
    if (!trimmed) {
      setDuplicateError(t.instances.dupNameEmpty);
      return;
    }
    setIsDuplicating(true);
    setDuplicateError(null);
    try {
      const duplicated = await instanceService.duplicateInstance(duplicateTarget.id, trimmed);
      onInstanceDuplicated?.(duplicated);
      setDuplicateTarget(null);
    } catch (err: any) {
      setDuplicateError(err?.message || t.instances.dupFailed);
    } finally {
      setIsDuplicating(false);
    }
  };

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  const filtered = instances.filter((it) =>
    it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    it.version.toLowerCase().includes(searchQuery.toLowerCase()) ||
    it.loader.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (it.group && it.group.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const groupedInstances = useMemo(() => {
    const groups: Record<string, MinecraftInstance[]> = {};
    for (const inst of filtered) {
      const g = inst.needsSetup ? t.common.unknown : inst.group?.trim() || t.instances.ungrouped;
      if (!groups[g]) groups[g] = [];
      groups[g].push(inst);
    }
    // Instances that still need setup always form the last group.
    const unknown = groups[t.common.unknown];
    if (unknown) {
      delete groups[t.common.unknown];
      groups[t.common.unknown] = unknown;
    }
    return groups;
  }, [filtered]);

  return (
    <motion.div
      className="space-y-6 w-full"
    >
      {instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-400 mb-4">
            <Box className="h-8 w-8" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">{t.home.noInstanceYet}</h3>
          <p className="text-xs text-slate-400 max-w-sm mb-6">
            {t.instances.emptyDesc}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-white/10 bg-white/[0.02]">
          <p className="text-xs text-slate-400">{t.instances.noMatch(searchQuery)}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300">{t.instances.allInstances(filtered.length)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={openGroupDialog}
                className="gap-1.5 border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs h-8 px-3 rounded-lg"
              >
                <FolderPlus className="h-3.5 w-3.5 text-brand-light" />
                {t.instances.createGroup}
              </Button>
            </div>
          </div>

          <div className="space-y-6">
            {Object.entries(groupedInstances).map(([groupName, groupItems]) => {
              const isCollapsed = collapsedGroups[groupName];
              return (
                <div key={groupName} className="space-y-3">
                  <div
                    onClick={() => toggleGroupCollapse(groupName)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-brand-light" />
                      <span className="text-xs font-bold text-white tracking-wide">
                        {groupName}
                      </span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-white/10 text-white/50">
                        {groupItems.length}
                      </Badge>
                    </div>

                    <motion.div
                      className="text-white/40"
                      animate={{ rotate: isCollapsed ? 0 : 180 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </motion.div>
                  </div>

                  <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      key="group-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden -mx-1 px-1 -my-1 py-1"
                    >
                    {/* At least 3 per row; wider windows fit more (each card is at least 380px unless that would drop below 3 columns). */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(380px,calc((100%-2.5rem)/3)),1fr))] gap-5">
                      {groupItems.map((inst) => (
            <Card
              key={inst.id}
              className="group relative flex h-full flex-col overflow-hidden border-white/10 bg-white/5 hover:border-brand-light/40 hover:bg-white/[0.07] transition-all cursor-pointer shadow-sm hover:shadow-lg hover:shadow-brand/5"
              onClick={() => onSelectInstance(inst.id)}
            >
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 border border-white/10 text-brand-light group-hover:scale-105 transition-transform shadow-inner overflow-hidden">
                      {inst.hasIcon && inst.iconPath ? (
                        <img
                          src={toAssetSrc(inst.iconPath, inst.iconUpdatedAt)}
                          alt={inst.name}
                          className="h-full w-full object-cover"
                        />
                      ) : inst.needsSetup ? (
                        <AlertTriangle className="h-6 w-6 text-amber-400" />
                      ) : (
                        <Box className="h-6 w-6" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-slate-100 group-hover:text-brand-light transition-colors">
                        {inst.name}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {inst.needsSetup ? (
                          <Badge variant="outline" className="whitespace-nowrap border-amber-500/40 text-[10px] py-0 px-1.5 text-amber-400">
                            {t.common.unknown}
                          </Badge>
                        ) : (
                          <>
                            <Badge variant="outline" className="whitespace-nowrap text-[10px] py-0 px-1.5">
                              {inst.loader}
                              {inst.loaderVersion ? ` ${inst.loaderVersion}` : ""}
                            </Badge>
                            <Badge variant="secondary" className="whitespace-nowrap text-[10px] py-0 px-1.5">
                              MC {inst.version}
                            </Badge>
                          </>
                        )}
                      </div>
                      {inst.description && (
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-1 max-w-xs">
                          {inst.description}
                        </p>
                      )}
                    </div>
                  </div>

                </div>
              </CardHeader>

              <CardContent className="mt-auto p-5 pt-2 space-y-4">
                <div className="space-y-1.5 border-t border-white/5 pt-3 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {t.instances.lastLaunched}
                    </span>
                    <span className="font-mono text-slate-300">{formatLastLaunched(inst.lastPlayedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1">
                      <Hourglass className="h-3 w-3" />
                      {t.instances.totalPlayTime}
                    </span>
                    <span className="font-mono text-slate-300">{formatPlayTime(inst.totalPlayTimeMs)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {runningInstances[inst.id] ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onKillInstance?.(inst.id);
                      }}
                      className="flex-1 gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold h-8 rounded-lg shadow-sm shadow-rose-900/30"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      <span>
                        {t.common.forceStop(runningInstances[inst.id].pid)})
                      </span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLaunchInstance(inst.id);
                      }}
                      className="flex-1 gap-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-semibold h-8 rounded-lg shadow-sm shadow-brand/25"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>{t.instances.launchNow}</span>
                    </Button>
                  )}
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => instanceService.openInstanceDirectory(inst.id, "root")}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <FolderOpen className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t.instances.openDir}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            setDuplicateTarget(inst);
                            setDuplicateName(t.inst.copySuffix(inst.name));
                            setDuplicateError(null);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t.instances.duplicate}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(inst)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t.instances.delete}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </CardContent>
            </Card>
                      ))}
                    </div>
                    </motion.div>
                  )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
      </div>
      )}

      {/* Create group dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={(open) => !open && !isCreatingGroup && setGroupDialogOpen(false)}>
        <DialogContent onClose={() => setGroupDialogOpen(false)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-4 w-4 text-brand-light" />
              {t.instances.groupDialogTitle}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateGroup} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300">{t.instances.groupNameLabel}</label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t.instances.groupNamePlaceholder}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-300">{t.instances.groupPickInstances}</label>
              <MultiSelect
                options={instances.map((inst) => ({ value: inst.id, label: inst.name, hint: inst.id }))}
                value={groupMembers}
                onChange={setGroupMembers}
                placeholder={t.instances.groupSelectPlaceholder}
              />
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">{t.instances.groupHint}</p>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setGroupDialogOpen(false)} className="text-xs">
                {t.common.cancel}
              </Button>
              <Button type="submit" size="sm" disabled={isCreatingGroup} className="bg-brand hover:bg-brand-light text-white text-xs font-semibold">
                {isCreatingGroup ? t.instances.groupCreating : t.instances.groupCreate}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 複製實例 Dialog */}
      <Dialog
        open={!!duplicateTarget}
        onOpenChange={(open) => !open && setDuplicateTarget(null)}
      >
        <DialogContent onClose={() => setDuplicateTarget(null)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4 text-brand-light" />
              {t.inst.duplicateTitle}
            </DialogTitle>
          </DialogHeader>

          {duplicateError && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400">
              {duplicateError}
            </div>
          )}

          <form onSubmit={handleDuplicate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300">{t.inst.newInstanceName}</label>
              <Input
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                placeholder={t.inst.dupPlaceholder}
                autoFocus
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t.inst.dupHint}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDuplicateTarget(null)}
                className="text-xs"
              >
                {t.common.cancel}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isDuplicating}
                className="bg-brand hover:bg-brand-light text-white text-xs font-semibold"
              >
                {isDuplicating ? t.inst.duplicating : t.inst.confirmDuplicate}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 刪除實例確認 Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent onClose={() => setDeleteTarget(null)} className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-400">
              <Trash2 className="h-4 w-4 text-rose-400" />
              {t.instances.confirmDeleteTitle}
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-slate-300 leading-relaxed">
            {t.instances.deleteNotice(shownDeleteTarget?.name ?? "")}
          </p>
          {shownDeleteTarget?.needsSetup && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-300">
              {t.instances.deleteForeignNotice}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              className="text-xs"
            >
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={async () => {
                if (!deleteTarget) return;
                setIsDeleting(true);
                try {
                  await instanceService.deleteInstance(deleteTarget.id);
                  clearCachedFiles(deleteTarget.id);
                  onInstanceDeleted?.(deleteTarget.id);
                  setDeleteTarget(null);
                } catch (err) {
                  toast(toUserMessage(err), "error");
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
            >
              {isDeleting ? t.inst.deleting : t.instances.confirmDeleteBtn}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};
