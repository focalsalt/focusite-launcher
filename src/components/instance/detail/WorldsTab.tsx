import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { instanceService } from "@/services/instanceService";
import { Archive, FolderOpen, HardDrive, Package, Pencil, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MinecraftInstance } from "@/types/navigation";
import type { WorldSummary } from "@/services/instanceService";
import { FramelessEmptyState, tabContentVariants } from "./shared";
import { DatapacksPanel } from "./DatapacksPanel";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { useLastValue } from "@/lib/useExitMount";
import { Tip } from "@/components/ui/tooltip";

/** Datapacks exist since 1.13; unknown formats (snapshots, custom) are assumed to support them. */
function supportsDatapacks(version: string): boolean {
  const v = version.trim();
  const m = v.match(/^1\.(\d+)/);
  if (m) return parseInt(m[1], 10) >= 13;
  return !/^(a|b|c|rd-|inf-)/.test(v);
}

interface WorldsTabProps {
  instance: MinecraftInstance;
  worlds: WorldSummary[];
  onLaunch: (id: string, quickPlayType?: "singleplayer" | "multiplayer", quickPlayTarget?: string) => void;
  isLaunching: boolean;
  isRunning: boolean;
  refreshInstanceFiles: () => void;
  tabDirection: number;
  ref?: React.Ref<HTMLDivElement>;
}

export const WorldsTab: React.FC<WorldsTabProps> = ({ instance, worlds, onLaunch, isLaunching, isRunning, refreshInstanceFiles, tabDirection, ref }: WorldsTabProps) => {
  const { t } = useI18n();
  const [renameWorldTarget, setRenameWorldTarget] = useState<WorldSummary | null>(null);
  const [newWorldName, setNewWorldName] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<WorldSummary | null>(null);
  const shownDeleteTarget = useLastValue(deleteTarget);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [datapackWorld, setDatapackWorld] = useState<WorldSummary | null>(null);

  const confirmDeleteWorld = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await instanceService.deleteInstanceWorld(instance.id, deleteTarget.folder_name);
      setDeleteTarget(null);
      refreshInstanceFiles();
    } catch (err) {
      toast(t.errors.deleteFailed(toUserMessage(err)), "error");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
              <motion.div
                key="saves"
                custom={tabDirection}
                ref={ref}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              >
              <AnimatePresence mode="wait" initial={false}>
              {datapackWorld ? (
                <motion.div
                  key="datapacks"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.15 }}
                >
                  <DatapacksPanel instanceId={instance.id} world={datapackWorld} onBack={() => setDatapackWorld(null)} />
                </motion.div>
              ) : (
              <motion.div
                key="world-list"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <div>
                    <h2 className="text-sm font-bold text-white">{t.worlds.title(worlds.length)}</h2>
                    <p className="text-xs text-slate-400">
                      {t.worlds.desc}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => instanceService.openInstanceDirectory(instance.id, "saves")}
                    className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                    {t.worlds.openSaves}
                  </Button>
                </div>

                {worlds.length === 0 ? (
                  <FramelessEmptyState
                    icon={HardDrive}
                    title={t.worlds.emptyTitle}
                    description={t.worlds.emptyDesc}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {worlds.map((world) => {
                      const gameModeText =
                        world.game_mode === 1
                          ? t.worlds.gmCreative
                          : world.game_mode === 2
                          ? t.worlds.gmAdventure
                          : world.game_mode === 3
                          ? t.worlds.gmSpectator
                          : world.is_hardcore
                          ? t.worlds.gmHardcore
                          : t.worlds.gmSurvival;

                      const lastPlayedStr =
                        world.last_played > 0
                          ? new Date(world.last_played).toLocaleDateString("zh-TW")
                          : t.worlds.unknownTime;

                      return (
                        <div
                          key={world.folder_name}
                          className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] p-3.5 transition-all"
                        >
                          <div className="flex items-start gap-3">
                            {world.icon_base64 ? (
                              <img
                                src={world.icon_base64}
                                alt={world.name}
                                className="h-12 w-12 rounded-lg object-cover bg-black/40 border border-white/10 shrink-0"
                              />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-brand-light shrink-0">
                                <HardDrive className="h-6 w-6" />
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-white text-sm truncate">
                                  {world.name}
                                </h4>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] py-0 px-1.5 ${
                                    world.is_hardcore
                                      ? "border-red-500/40 text-red-400"
                                      : "border-emerald-500/30 text-emerald-400"
                                  }`}
                                >
                                  {gameModeText}
                                </Badge>
                              </div>
                              <p className="text-xs text-white/40 font-mono mt-0.5 truncate">
                                {world.folder_name} • {world.version_name}
                              </p>
                              <p className="text-[11px] text-white/50 mt-1">
                                {t.worlds.seedLabel}<span className="font-mono text-white/70">{world.seed}</span> • {t.worlds.playedLabel}{lastPlayedStr}
                              </p>
                            </div>
                          </div>

                          <div className="mt-3.5 pt-2.5 border-t border-white/5 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <Tip label={t.worlds.renameAttr}>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setRenameWorldTarget(world);
                                    setNewWorldName(world.name);
                                  }}
                                  className="h-7 px-2 text-white/60 hover:text-white"
                                >
                                  <Pencil className="w-3.5 h-3.5 mr-1" />
                                  {t.worlds.rename}
                                </Button>
                              </Tip>

                              <Tip label={t.worlds.backupAttr}>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    try {
                                      const selectedPath = await saveFileDialog({
                                        defaultPath: `${world.name}_backup.zip`,
                                        filters: [{ name: t.worlds.zipFilter, extensions: ["zip"] }],
                                      });
                                      if (selectedPath) {
                                        await instanceService.backupInstanceWorld(
                                          instance.id,
                                          world.folder_name,
                                          selectedPath
                                        );
                                        toast(t.worlds.backupOk, "success");
                                      }
                                    } catch (err: any) {
                                      toast(t.errors.backupFailed(toUserMessage(err)), "error");
                                    }
                                  }}
                                  className="h-7 px-2 text-white/60 hover:text-white"
                                >
                                  <Archive className="w-3.5 h-3.5 mr-1" />
                                  {t.worlds.backup}
                                </Button>
                              </Tip>

                              {supportsDatapacks(instance.version) && (
                                <Tip label={t.worlds.datapackAttr}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setDatapackWorld(world)}
                                    className="h-7 px-2 text-white/60 hover:text-white"
                                  >
                                    <Package className="w-3.5 h-3.5 mr-1" />
                                    {t.worlds.datapack}
                                  </Button>
                                </Tip>
                              )}

                              <Tip label={t.worlds.deleteAttr}>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeleteTarget(world)}
                                  className="h-7 px-2 text-white/60 hover:text-red-400"
                                  aria-label={t.worlds.deleteAttr}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </Tip>
                            </div>

                            <Button
                              size="sm"
                              onClick={() => onLaunch(instance.id, "singleplayer", world.folder_name)}
                              disabled={isLaunching || isRunning}
                              className="bg-brand hover:bg-brand-light text-white font-medium h-7 px-3 text-xs shadow-sm shadow-brand/30"
                            >
                              <Play className="w-3.5 h-3.5 mr-1 fill-white" />
                              {t.worlds.quickPlay}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
              )}
              </AnimatePresence>
              </motion.div>
        {/* 重新命名世界存檔對話框 */}
        <Dialog open={!!renameWorldTarget} onOpenChange={(open) => !open && setRenameWorldTarget(null)}>
          <DialogContent className="max-w-md bg-slate-900 border-white/10 text-white">
            <DialogHeader>
              <DialogTitle className="text-sm font-bold flex items-center gap-2">
                <Pencil className="w-4 h-4 text-brand-light" />
                {t.worlds.renameDialogTitle}
              </DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <label className="text-xs text-white/60 mb-1.5 block">{t.worlds.nameLabel}</label>
              <Input
                value={newWorldName}
                onChange={(e) => setNewWorldName(e.target.value)}
                className="bg-white/5 border-white/10 text-xs"
                placeholder={t.worlds.newNamePlaceholder}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setRenameWorldTarget(null)} className="border-white/10 text-xs">
                {t.common.cancel}
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  if (!renameWorldTarget || !newWorldName.trim()) return;
                  await instanceService.renameInstanceWorld(instance.id, renameWorldTarget.folder_name, newWorldName.trim());
                  setRenameWorldTarget(null);
                  refreshInstanceFiles();
                }}
                className="bg-brand hover:bg-brand-light text-white text-xs"
              >
                {t.worlds.confirmRename}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md bg-slate-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" />
              {t.worlds.deleteDialogTitle}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-300 leading-relaxed py-2">
            {t.worlds.deleteConfirm(shownDeleteTarget?.name ?? "")}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" disabled={isDeleting} onClick={() => setDeleteTarget(null)} className="border-white/10 text-xs">
              {t.common.cancel}
            </Button>
            <Button size="sm" disabled={isDeleting} onClick={confirmDeleteWorld} className="bg-rose-600 hover:bg-rose-500 text-white text-xs">
              {isDeleting ? t.worlds.deleting : t.worlds.deleteForever}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
