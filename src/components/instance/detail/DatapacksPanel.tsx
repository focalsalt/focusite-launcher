import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FolderOpen, Package, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { instanceService, type DatapackEntry, type WorldSummary } from "@/services/instanceService";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useLastValue } from "@/lib/useExitMount";
import { useI18n } from "@/i18n";
import { FramelessEmptyState, PackItem, TabSkeleton } from "./shared";

interface DatapacksPanelProps {
  instanceId: string;
  world: WorldSummary;
  onBack: () => void;
}

/** Datapacks of one world, laid out like the resource-pack page. */
export const DatapacksPanel: React.FC<DatapacksPanelProps> = ({ instanceId, world, onBack }) => {
  const { t } = useI18n();
  const [packs, setPacks] = useState<DatapackEntry[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatapackEntry | null>(null);
  const shownTarget = useLastValue(deleteTarget);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(() => {
    instanceService
      .listWorldDatapacks(instanceId, world.folder_name)
      .then(setPacks)
      .catch((err) => {
        setPacks([]);
        toast(toUserMessage(err), "error");
      });
  }, [instanceId, world.folder_name]);

  useEffect(() => {
    setPacks(null);
    load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await instanceService.deleteWorldDatapack(instanceId, world.folder_name, deleteTarget.file_name);
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast(t.errors.deleteFailed(toUserMessage(err)), "error");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Tip label={t.worlds.datapackBack}>
            <Button variant="ghost" size="sm" onClick={onBack} aria-label={t.worlds.datapackBack} className="h-8 w-8 p-0 text-white/70 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Tip>
          <div>
            <h2 className="text-sm font-bold text-white">{t.worlds.datapackTitle(world.name)}</h2>
            <p className="text-xs text-slate-400">{t.worlds.datapackDesc}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => instanceService.openWorldDatapacksDir(instanceId, world.folder_name)}
          className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
        >
          <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
          {t.worlds.datapackOpenFolder}
        </Button>
      </div>

      {packs === null ? (
        <TabSkeleton />
      ) : packs.length === 0 ? (
        <FramelessEmptyState icon={Package} title={t.worlds.datapackEmptyTitle} description={t.worlds.datapackEmptyDesc} />
      ) : (
        <div className="space-y-1.5">
          {packs.map((p) => (
            <PackItem
              key={p.file_name}
              pack={{ filename: p.file_name, sizeBytes: p.size_bytes, isDirectory: p.is_dir }}
              icon={Package}
              action={
                <Tip label={t.worlds.datapackDelete}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteTarget(p)}
                    aria-label={t.worlds.datapackDelete}
                    className="h-7 w-7 p-0 text-white/60 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </Tip>
              }
            />
          ))}
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md bg-slate-900 border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-rose-400" />
              {t.worlds.datapackDelete}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-300 leading-relaxed py-2">
            {t.worlds.datapackDeleteConfirm(shownTarget?.file_name ?? "")}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" disabled={isDeleting} onClick={() => setDeleteTarget(null)} className="border-white/10 text-xs">
              {t.common.cancel}
            </Button>
            <Button size="sm" disabled={isDeleting} onClick={confirmDelete} variant="destructive" className="text-xs">
              {isDeleting ? t.worlds.deleting : t.worlds.deleteForever}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
