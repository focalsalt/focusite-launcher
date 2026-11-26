import React, { useState, useEffect, useRef } from "react";
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
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Box,
  RefreshCw,
  X,
  Image as ImageIcon,
  FileCode,
  CheckCircle2,
} from "lucide-react";
import { instanceService } from "@/services/instanceService";
import { isVersionOlderThan125, useVersionManifest, VersionLoaderFields } from "./VersionLoaderFields";
import { LoaderType, MinecraftInstance } from "@/types/navigation";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";

interface CreateInstanceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (newInstance: MinecraftInstance) => void;
}

const LOADERS: readonly LoaderType[] = [
  "Vanilla",
  "Fabric",
  "Forge",
  "NeoForge",
  "Quilt",
  "Custom",
];

export { isVersionOlderThan125 };

export const CreateInstanceDialog: React.FC<CreateInstanceDialogProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const { t } = useI18n();
  const [instanceName, setInstanceName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [selectedLoader, setSelectedLoader] = useState<LoaderType>("Vanilla");
  const [loaderVersion, setLoaderVersion] = useState<string>("");


  // 實例圖示狀態
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBytes, setIconBytes] = useState<number[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Each picked icon holds a blob URL; release it once it is replaced or the dialog unmounts.
  useEffect(() => () => {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
  }, [iconPreview]);

  // Custom Loader Jar 狀態
  const [customJar, setCustomJar] = useState<{
    name: string;
    bytes: number[];
    sizeStr: string;
  } | null>(null);
  const [isDraggingJar, setIsDraggingJar] = useState<boolean>(false);
  const jarInputRef = useRef<HTMLInputElement>(null);

  const { manifest, isLoading: isLoadingVersions } = useVersionManifest(isOpen);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Errors surface as toasts rather than an inline banner.
  const setErrorMessage = (msg: string) => toast(msg, "error");

  // Default to the latest release once the manifest arrives.
  useEffect(() => {
    const latest = manifest?.latest?.release;
    if (!latest) return;
    setSelectedVersion(latest);
    setInstanceName(`Minecraft ${latest}`);
  }, [manifest]);

  const handleIconChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setIconPreview(url);

    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        const u8 = new Uint8Array(reader.result);
        setIconBytes(Array.from(u8));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleClearIcon = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIconPreview(null);
    setIconBytes(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const processJarFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".jar")) {
      setErrorMessage(t.create.pickValidJar);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        const u8 = new Uint8Array(reader.result);
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        const sizeStr =
          file.size > 1024 * 1024
            ? `${sizeMb} MB`
            : `${(file.size / 1024).toFixed(1)} KB`;
        setCustomJar({
          name: file.name,
          bytes: Array.from(u8),
          sizeStr,
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleJarInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processJarFile(file);
    }
  };

  const handleJarDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingJar(true);
  };

  const handleJarDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingJar(false);
  };

  const handleJarDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingJar(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processJarFile(file);
    }
  };

  const handleClearJar = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomJar(null);
    if (jarInputRef.current) {
      jarInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instanceName.trim()) {
      setErrorMessage(t.create.nameRequired);
      return;
    }

    if (selectedLoader === "Custom" && !customJar) {
      setErrorMessage(t.create.customJarRequired);
      return;
    }

    setIsSubmitting(true);

    const requiresLoaderVersion =
      selectedLoader !== "Vanilla" && selectedLoader !== "Custom";

    try {
      const newInst = await instanceService.createInstance({
        name: instanceName.trim(),
        version: selectedLoader === "Custom" ? "Custom" : selectedVersion,
        loader: selectedLoader,
        loaderVersion: requiresLoaderVersion ? loaderVersion.trim() || undefined : undefined,
        description: description.trim() || undefined,
        iconBytes: iconBytes || undefined,
        customJarName: selectedLoader === "Custom" ? customJar?.name : undefined,
        customJarBytes: selectedLoader === "Custom" ? customJar?.bytes : undefined,
      });
      onCreated(newInst);
      onClose();
    } catch (err: unknown) {
      const msg = toUserMessage(err);
      setErrorMessage(t.errors.createFailed(msg));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      preventBackdropClose={true}
    >
      <DialogContent className="max-w-3xl border-white/10 bg-slate-900/98 text-slate-100 backdrop-blur-2xl p-0 overflow-hidden shadow-2xl">
        {/* 隱藏的圖示檔案輸入項 */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleIconChange}
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
        />

        {/* 隱藏的 Custom Jar 輸入項 */}
        <input
          type="file"
          ref={jarInputRef}
          onChange={handleJarInputChange}
          accept=".jar"
          className="hidden"
        />

        <form onSubmit={handleSubmit} className="flex flex-col select-none">
          {/* 1. 彈窗頂部固定標題列 */}
          <DialogHeader className="h-16 px-6 border-b border-white/10 flex items-left justify-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-brand to-brand-dark text-white shadow-md shadow-brand/20 border border-white/10">
                <Box className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-100">
                  {t.create.title}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t.create.dirHint}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* 2. 兩欄式恆定佈局主體 (完全移除內部 Scroll Area，恆定固定高度確保 0px 位移) */}
          <div className="h-[360px] p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch shrink-0">
            {/* === 左側欄位：圖示（跨名稱＋模組平台兩列）→ 遊戲版本 → 平台版本 === */}
            <div className="flex flex-col h-full space-y-3">
              <VersionLoaderFields
                isOpen={isOpen}
                loaders={LOADERS}
                manifest={manifest}
                isLoadingVersions={isLoadingVersions}
                version={selectedVersion}
                onVersionChange={setSelectedVersion}
                loader={selectedLoader}
                onLoaderChange={setSelectedLoader}
                loaderVersion={loaderVersion}
                onLoaderVersionChange={setLoaderVersion}
                iconSlot={
                  <div className="relative group w-24 shrink-0 self-stretch">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex h-full min-h-[96px] w-24 items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:border-brand-light/60 hover:bg-brand/15 transition-all overflow-hidden"
                        >
                          {iconPreview ? (
                            <img
                              src={iconPreview}
                              alt={t.create.iconPreviewAlt}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-7 w-7 text-slate-400 group-hover:text-brand-light transition-colors" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {iconPreview ? t.create.changeIcon : t.create.uploadIcon}
                      </TooltipContent>
                    </Tooltip>

                    {iconPreview && (
                      <Tooltip className="absolute -top-1.5 -right-1.5">
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={handleClearIcon}
                            aria-label={t.create.removeIcon}
                            className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500/90 text-white shadow hover:bg-red-600 transition-colors"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">{t.create.removeIcon}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                }
                nameSlot={
                  <div className="space-y-1">
                    <label className="font-semibold text-xs text-slate-300">{t.create.nameLabel}</label>
                    <Input
                      value={instanceName}
                      onChange={(e) => setInstanceName(e.target.value)}
                      placeholder={t.create.namePlaceholder}
                      className="bg-black/40 border-white/10 text-xs h-9"
                      required
                    />
                  </div>
                }
                customSlot={
                  <div className="flex-1 flex flex-col space-y-1.5 justify-center min-h-[150px]">
                    <label className="font-semibold text-xs text-slate-300">{t.create.customJarLabel}</label>
                    <div
                      onDragOver={handleJarDragOver}
                      onDragLeave={handleJarDragLeave}
                      onDrop={handleJarDrop}
                      onClick={() => jarInputRef.current?.click()}
                      className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${isDraggingJar
                          ? "border-brand-light bg-brand/10"
                          : customJar
                            ? "border-brand-light/60 bg-black/40"
                            : "border-white/15 bg-black/20 hover:border-white/30 hover:bg-white/5"
                        }`}
                    >
                      {customJar ? (
                        <div className="flex items-center justify-between w-full px-2">
                          <div className="flex items-center gap-2.5 truncate">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/20 text-brand-light border border-brand-light/30">
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                            <div className="truncate">
                              <p className="font-mono font-semibold text-slate-200 text-xs truncate">
                                {customJar.name}
                              </p>
                              <p className="text-3xs text-slate-400">{customJar.sizeStr}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleClearJar}
                            aria-label={t.create.removeJar}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-center space-y-1">
                          <div className="flex h-8 w-8 mx-auto items-center justify-center rounded-xl bg-white/5 text-slate-400">
                            <FileCode className="h-4 w-4" />
                          </div>
                          <p className="font-medium text-slate-300 text-xs">
                            {t.create.dropJar}
                          </p>
                          <p className="text-3xs text-slate-500">
                            {t.create.customLoaderNote}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                }
              />
            </div>

            {/* === 右側欄位：實例描述（填滿高度） === */}
            <div className="flex flex-col h-full space-y-1 min-h-0">
              <label className="font-semibold text-xs text-slate-300">{t.create.descLabel}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.create.descPlaceholder}
                className="w-full flex-1 min-h-0 rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-slate-100 placeholder:text-slate-500 shadow-sm transition-colors focus-visible:outline-none focus-visible:border-brand-light/60 focus-visible:ring-1 focus-visible:ring-brand-light resize-none"
              />
            </div>
          </div>

          {/* 4. 底部固定動作列 */}
          <DialogFooter className="h-14 px-6 border-t border-white/10 bg-black/20 flex items-center justify-end gap-2.5 shrink-0">
            <Button
              variant="glass"
              size="sm"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-xs"
            >
              {t.common.cancel}
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={isSubmitting || (selectedLoader !== "Custom" && !selectedVersion)}
              className="gap-1.5 bg-brand hover:bg-brand-hover text-white font-semibold text-xs px-4"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>{t.create.writing}</span>
                </>
              ) : (
                <span>{t.create.confirm}</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
