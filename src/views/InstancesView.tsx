import React, { useState } from "react";
import { motion } from "motion/react";
import {
  Box,
  Play,
  Square,
  Clock,
  Sparkles,
  Plus,
  FolderDown,
  FolderPlus,
  FolderOpen,
  Copy,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { convertFileSrc } from "@tauri-apps/api/core";
import { MinecraftInstance, RunningInstanceInfo } from "@/types/navigation";
import { instanceService } from "@/services/instanceService";

const getIconSrc = (path?: string) => {
  if (!path) return undefined;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      return convertFileSrc(path);
    } catch {
      return path;
    }
  }
  return path;
};

interface InstancesViewProps {
  instances: MinecraftInstance[];
  searchQuery: string;
  runningInstances?: Record<string, RunningInstanceInfo>;
  onSelectInstance: (instanceId: string) => void;
  onLaunchInstance: (instanceId: string) => void;
  onKillInstance?: (instanceId: string) => void;
  onCreateInstance: () => void;
  onImportInstance?: () => void;
  onCreateGroup?: () => void;
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
  onCreateInstance,
  onImportInstance,
  onCreateGroup,
  onInstanceDuplicated,
  onInstanceDeleted,
}) => {
  const [duplicateTarget, setDuplicateTarget] = useState<MinecraftInstance | null>(null);
  const [duplicateName, setDuplicateName] = useState<string>("");
  const [isDuplicating, setIsDuplicating] = useState<boolean>(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<MinecraftInstance | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const handleDuplicate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!duplicateTarget) return;
    const trimmed = duplicateName.trim();
    if (!trimmed) {
      setDuplicateError("實例名稱不可為空");
      return;
    }
    setIsDuplicating(true);
    setDuplicateError(null);
    try {
      const duplicated = await instanceService.duplicateInstance(duplicateTarget.id, trimmed);
      onInstanceDuplicated?.(duplicated);
      setDuplicateTarget(null);
    } catch (err: any) {
      setDuplicateError(err?.message || "複製失敗");
    } finally {
      setIsDuplicating(false);
    }
  };

  const filtered = instances.filter((it) =>
    it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    it.version.toLowerCase().includes(searchQuery.toLowerCase()) ||
    it.loader.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.2 }}
      className="space-y-6 max-w-6xl w-full"
    >
      {instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-400 mb-4">
            <Box className="h-8 w-8" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">尚未建立任何 Minecraft 實例</h3>
          <p className="text-xs text-slate-400 max-w-sm mb-6">
            點擊下方按鈕立即建立全新的原版或模組載入器實例，或導入現有 CurseForge / Modrinth 模組包。
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={onCreateInstance}
              className="gap-2 bg-[#3C8527] hover:bg-[#52A43A] text-white text-xs h-9 px-4 font-semibold"
            >
              <Plus className="h-4 w-4" />
              建立新實例
            </Button>
            {onImportInstance && (
              <Button
                variant="outline"
                onClick={onImportInstance}
                className="gap-2 border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs h-9 px-4"
              >
                <FolderDown className="h-4 w-4" />
                導入模組包
              </Button>
            )}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center rounded-2xl border border-white/10 bg-white/[0.02]">
          <p className="text-xs text-slate-400">沒有符合搜尋「{searchQuery}」的實例</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-300">所有實例 ({filtered.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={onCreateInstance}
                className="gap-1.5 bg-[#3C8527] hover:bg-[#469C2D] text-white text-xs h-8 px-3 font-semibold rounded-lg shadow-sm shadow-[#3C8527]/20"
              >
                <Plus className="h-3.5 w-3.5" />
                建立新實例
              </Button>
              {onImportInstance && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onImportInstance}
                  className="gap-1.5 border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs h-8 px-3 rounded-lg"
                >
                  <FolderDown className="h-3.5 w-3.5 text-[#52A43A]" />
                  導入模組包
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onCreateGroup}
                className="gap-1.5 border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 text-xs h-8 px-3 rounded-lg"
              >
                <FolderPlus className="h-3.5 w-3.5 text-[#52A43A]" />
                建立群組
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((inst) => (
            <Card
              key={inst.id}
              className="group relative overflow-hidden border-white/10 bg-white/5 hover:border-[#52A43A]/40 hover:bg-white/[0.07] transition-all cursor-pointer shadow-sm hover:shadow-lg hover:shadow-[#3C8527]/5"
              onClick={() => onSelectInstance(inst.id)}
            >
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 border border-white/10 text-[#52A43A] group-hover:scale-105 transition-transform shadow-inner overflow-hidden">
                      {inst.hasIcon && inst.iconPath ? (
                        <img
                          src={getIconSrc(inst.iconPath)}
                          alt={inst.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Box className="h-6 w-6" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-slate-100 group-hover:text-[#52A43A] transition-colors">
                        {inst.name}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {inst.loader}
                          {inst.loaderVersion ? ` (${inst.loaderVersion})` : ""}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                          MC {inst.version}
                        </Badge>
                      </div>
                      {inst.description && (
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-1 max-w-xs">
                          {inst.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => instanceService.openInstanceDirectory(inst.id, "root")}
                          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                          title="開啟資料夾"
                        >
                          <FolderOpen className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">開啟實例目錄</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            setDuplicateTarget(inst);
                            setDuplicateName(`${inst.name} (複製)`);
                            setDuplicateError(null);
                          }}
                          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                          title="複製實例"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">複製實例 (CAS 去重)</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(inst)}
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="刪除實例"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">刪除實例</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-2 space-y-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-white/5 pt-3">
                  <div className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    <span>{inst.modCount} 個 Mod (CAS 去重)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{inst.lastPlayed}</span>
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
                        強制終止 (PID: {runningInstances[inst.id].pid})
                      </span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLaunchInstance(inst.id);
                      }}
                      className="flex-1 gap-1.5 bg-[#3C8527] hover:bg-[#469C2D] text-white text-xs font-semibold h-8 rounded-lg shadow-sm shadow-[#3C8527]/25"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      <span>立即啟動</span>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectInstance(inst.id);
                    }}
                    className="text-xs h-8 rounded-lg border-white/10 hover:bg-white/10"
                  >
                    管理設定
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      )}

      {/* 複製實例 Dialog */}
      <Dialog
        open={!!duplicateTarget}
        onOpenChange={(open) => !open && setDuplicateTarget(null)}
      >
        <DialogContent onClose={() => setDuplicateTarget(null)} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4 text-[#52A43A]" />
              複製實例
            </DialogTitle>
          </DialogHeader>

          {duplicateError && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400">
              {duplicateError}
            </div>
          )}

          <form onSubmit={handleDuplicate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300">新實例名稱</label>
              <Input
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                placeholder="例如：生存伺服冒險 (副本)"
                autoFocus
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              複製將建立獨立的實例目錄並複製配置檔案，Mods 與大型資源將利用硬連結 (Hardlink) 瞬間完成且不佔用雙倍硬碟空間。
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDuplicateTarget(null)}
                className="text-xs"
              >
                取消
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isDuplicating}
                className="bg-[#3C8527] hover:bg-[#52A43A] text-white text-xs font-semibold"
              >
                {isDuplicating ? "正在複製..." : "確認複製"}
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
              確認刪除實例？
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-slate-300 leading-relaxed">
            即將永久刪除「<span className="font-semibold text-white">{deleteTarget?.name}</span>」資料夾及其存檔、模組檔案。此動作無法復原。
          </p>

          <div className="flex justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              className="text-xs"
            >
              取消
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
                  onInstanceDeleted?.(deleteTarget.id);
                  setDeleteTarget(null);
                } finally {
                  setIsDeleting(false);
                }
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
            >
              {isDeleting ? "正在刪除..." : "確定刪除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};
