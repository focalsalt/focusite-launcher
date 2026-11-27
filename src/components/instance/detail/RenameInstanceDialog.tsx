import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { instanceService } from "@/services/instanceService";
import { MinecraftInstance } from "@/types/navigation";

interface RenameInstanceDialogProps {
  instance: MinecraftInstance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (updated: MinecraftInstance) => void;
}

/** Two steps: type the new name, then choose whether the folder is renamed too. */
export const RenameInstanceDialog: React.FC<RenameInstanceDialogProps> = ({
  instance,
  open,
  onOpenChange,
  onUpdated,
}) => {
  const { t } = useI18n();
  const [renameInput, setRenameInput] = useState<string>("");
  const [showFolderRenamePrompt, setShowFolderRenamePrompt] = useState<boolean>(false);
  const [isRenaming, setIsRenaming] = useState<boolean>(false);

  // Every opening starts at step one with the current name (adjusted during render, so no stale frame).
  const [wasOpen, setWasOpen] = useState<boolean>(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRenameInput(instance.name);
      setShowFolderRenamePrompt(false);
    }
  }

  const handleRenameNext = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = renameInput.trim();
    if (!trimmed) {
      toast(t.inst.nameEmpty, "error");
      return;
    }
    if (trimmed === instance.name) {
      onOpenChange(false);
      return;
    }
    setShowFolderRenamePrompt(true);
  };

  const executeRename = async (renameFolder: boolean) => {
    setIsRenaming(true);
    try {
      const updated = await instanceService.renameInstance(instance.id, renameInput.trim(), renameFolder);
      onUpdated?.(updated);
      onOpenChange(false);
      setShowFolderRenamePrompt(false);
    } catch (err: unknown) {
      toast(toUserMessage(err), "error");
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {showFolderRenamePrompt ? t.inst.confirmFolderRename : t.inst.renameTitle}
          </DialogTitle>
        </DialogHeader>

        {!showFolderRenamePrompt ? (
          <form onSubmit={handleRenameNext} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="rename-instance" className="text-xs text-slate-300">{t.inst.displayName}</label>
              <Input id="rename-instance"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                placeholder={t.inst.newNamePlaceholder}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs"
              >
                {t.common.cancel}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-brand hover:bg-brand-hover text-on-solid text-xs font-semibold"
              >
                {t.inst.saveChanges}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              {t.inst.renameNotice(renameInput.trim())}
              <br />
              {t.inst.syncFolderQuestion}
            </p>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs space-y-1">
              <div className="text-slate-400">{t.inst.currentFolder}<span className="font-mono text-slate-200">{instance.id}</span></div>
              <div className="text-slate-400">{t.inst.newFolder}<span className="font-mono text-brand-light">{renameInput.trim()}</span></div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="button"
                size="sm"
                disabled={isRenaming}
                onClick={() => executeRename(true)}
                className="bg-brand hover:bg-brand-hover text-on-solid text-xs font-semibold"
              >
                {isRenaming ? t.inst.renaming : t.inst.syncFolderRename}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRenaming}
                onClick={() => executeRename(false)}
                className="text-xs border-white/15 bg-white/5 hover:bg-white/10 text-slate-300"
              >
                {t.inst.displayOnly}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isRenaming}
                onClick={() => onOpenChange(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                {t.common.cancel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
