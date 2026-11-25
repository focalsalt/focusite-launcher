import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { clearCachedFiles } from "@/lib/instanceFilesCache";
import { toast } from "@/lib/toast";
import { instanceService } from "@/services/instanceService";
import { MinecraftInstance } from "@/types/navigation";

interface DeleteInstanceDialogProps {
  instance: MinecraftInstance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export const DeleteInstanceDialog: React.FC<DeleteInstanceDialogProps> = ({
  instance,
  open,
  onOpenChange,
  onDeleted,
}) => {
  const { t } = useI18n();
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const handleDeleteInstance = async () => {
    setIsDeleting(true);
    try {
      await instanceService.deleteInstance(instance.id);
      clearCachedFiles(instance.id);
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      toast(toUserMessage(err), "error");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-danger-400">
            <AlertTriangle className="h-5 w-5 text-danger-500 shrink-0" />
            {t.inst.deleteTitle(instance.name)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-xs text-slate-300 leading-relaxed">
          <p>
            {t.inst.deleteBody1}{" "}
            <span className="font-mono text-danger-300 bg-danger-950/40 px-1.5 py-0.5 rounded border border-danger-900/40">
              instances/{instance.id}
            </span>{" "}
            {t.inst.deleteBody2}
          </p>
          <p className="text-slate-400">{t.inst.casNotAffected}</p>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isDeleting}
            onClick={() => onOpenChange(false)}
            className="border-white/10 text-xs"
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isDeleting}
            onClick={handleDeleteInstance}
            className="gap-2 bg-danger-600 hover:bg-danger-700 text-white font-bold text-xs"
          >
            {isDeleting ? t.inst.deleting : t.inst.confirmDelete}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
