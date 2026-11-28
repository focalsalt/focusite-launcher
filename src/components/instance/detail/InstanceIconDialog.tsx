import React, { useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Image as ImageIcon, Package, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { toAssetSrc } from "@/lib/assetUrl";
import { presetIconPngBytes, presetIconUrl, type PresetIconId } from "@/lib/presetIcons";
import { instanceService } from "@/services/instanceService";
import { MinecraftInstance } from "@/types/navigation";
import { cn } from "@/lib/utils";

const PRESET_ICONS = [
  { id: "grass", labelKey: "presetGrass" },
  { id: "crafting_table", labelKey: "presetCraftingTable" },
  { id: "furnace", labelKey: "presetFurnace" },
  { id: "diamond", labelKey: "presetDiamond" },
  { id: "redstone", labelKey: "presetRedstone" },
  { id: "creeper", labelKey: "presetCreeper" },
  { id: "tnt", labelKey: "presetTnt" },
  { id: "bookshelf", labelKey: "presetBookshelf" },
  { id: "ender_chest", labelKey: "presetEnderChest" },
  { id: "sword", labelKey: "presetSword" },
] as const;

interface InstanceIconDialogProps {
  instance: MinecraftInstance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (updated: MinecraftInstance) => void;
}

/** Pick the instance icon from a local image or from the bundled presets. */
export const InstanceIconDialog: React.FC<InstanceIconDialogProps> = ({
  instance,
  open,
  onOpenChange,
  onUpdated,
}) => {
  const { t } = useI18n();
  const [isSettingIcon, setIsSettingIcon] = useState<boolean>(false);

  /** Runs one icon change: busy while it saves, closes the dialog on success. */
  const applyIcon = async (change: () => Promise<MinecraftInstance>, failure: string) => {
    setIsSettingIcon(true);
    try {
      onUpdated?.(await change());
      onOpenChange(false);
    } catch (err) {
      console.error(failure, err);
    } finally {
      setIsSettingIcon(false);
    }
  };

  const handleSelectFileIcon = async () => {
    let selected: unknown;
    try {
      selected = await openFileDialog({
        multiple: false,
        filters: [{ name: t.inst.imageFiles, extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
      });
    } catch (err) {
      console.error("Failed to set icon from file:", err);
      return;
    }
    if (typeof selected !== "string" || !selected) return;
    const path = selected;
    await applyIcon(() => instanceService.setInstanceIconFromFile(instance.id, path), "Failed to set icon from file:");
  };

  const handleSelectPresetIcon = (presetId: PresetIconId) =>
    applyIcon(
      async () => instanceService.setInstancePresetIcon(instance.id, presetId, await presetIconPngBytes(presetId)),
      "Failed to set preset icon:"
    );

  const handleResetIcon = () => applyIcon(() => instanceService.resetInstanceIcon(instance.id), "Failed to reset icon:");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-brand-light" />
            {t.inst.iconDialogTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Upload from disk, with the current icon */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-3">
              <div className={cn(
                "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-on-solid overflow-hidden",
                instance.hasIcon && instance.iconPath ? "" : "bg-gradient-to-tr from-brand to-brand-dark shadow-md border border-white/20",
              )}>
                {instance.hasIcon && instance.iconPath ? (
                  <img
                    src={toAssetSrc(instance.iconPath, instance.iconUpdatedAt)}
                    alt={instance.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package className="h-6 w-6" />
                )}
              </div>
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-white">{t.inst.customIconFile}</span>
                <p className="text-2xs text-slate-400">{t.inst.iconFormats}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSettingIcon}
                onClick={handleSelectFileIcon}
                className="gap-1.5 text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10 text-white"
              >
                <FolderOpen className="h-3.5 w-3.5 text-brand-light" />
                {t.inst.browseEllipsis}
              </Button>
              {instance.hasIcon && (
                <Tip label={t.inst.resetIconAttr}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSettingIcon}
                    onClick={handleResetIcon}
                    aria-label={t.inst.resetIconAttr}
                    className="text-xs h-8 border-white/10 hover:border-danger-500/30 text-slate-400 hover:text-danger-400"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              )}
            </div>
          </div>

          {/* Bundled presets */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-300">{t.inst.presetIcons}</span>
            <div className="grid grid-cols-5 gap-2">
              {PRESET_ICONS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={isSettingIcon}
                  onClick={() => handleSelectPresetIcon(preset.id)}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 hover:border-brand-light/50 transition-all text-center group cursor-pointer"
                >
                  <img
                    src={presetIconUrl(preset.id)}
                    alt=""
                    className="h-9 w-9 rounded-lg shadow-inner group-hover:scale-105 transition-transform [image-rendering:pixelated]"
                  />
                  <span className="text-3xs text-slate-300 group-hover:text-white font-medium truncate max-w-full">
                    {t.inst[preset.labelKey]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              {t.common.close}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
