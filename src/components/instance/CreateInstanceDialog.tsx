import React, { useState, useEffect, useRef, useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Box,
  RefreshCw,
  X,
  Image as ImageIcon,
  FileCode,
  CheckCircle2,
  Star,
  ShieldCheck,
} from "lucide-react";
import { manifestService, VersionManifestV2 } from "@/services/manifestService";
import { instanceService } from "@/services/instanceService";
import { loaderService, LoaderVersionOption } from "@/services/loaderService";
import { LoaderType, MinecraftInstance } from "@/types/navigation";

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

export function isVersionOlderThan125(versionStr: string): boolean {
  const clean = versionStr.trim();
  if (
    clean.startsWith("a") ||
    clean.startsWith("b") ||
    clean.startsWith("c") ||
    clean.startsWith("rd-") ||
    clean.startsWith("inf-")
  ) {
    return true;
  }
  const match = clean.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = match[3] ? parseInt(match[3], 10) : 0;
  if (major === 1) {
    if (minor < 2) return true;
    if (minor === 2 && patch < 5) return true;
  }
  return false;
}

export const CreateInstanceDialog: React.FC<CreateInstanceDialogProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [instanceName, setInstanceName] = useState<string>("我的世界 1.21.4");
  const [description, setDescription] = useState<string>("");
  const [selectedVersion, setSelectedVersion] = useState<string>("1.21.4");
  const [selectedLoader, setSelectedLoader] = useState<LoaderType>("Vanilla");
  const [loaderVersion, setLoaderVersion] = useState<string>("");
  const [loaderOptions, setLoaderOptions] = useState<LoaderVersionOption[]>([]);
  const [isLoadingLoaders, setIsLoadingLoaders] = useState<boolean>(false);

  // 快照與歷史版本過濾
  const [showSnapshots, setShowSnapshots] = useState<boolean>(false);
  const [showHistorical, setShowHistorical] = useState<boolean>(false);

  // 實例圖示狀態
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBytes, setIconBytes] = useState<number[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom Loader Jar 狀態
  const [customJar, setCustomJar] = useState<{
    name: string;
    bytes: number[];
    sizeStr: string;
  } | null>(null);
  const [isDraggingJar, setIsDraggingJar] = useState<boolean>(false);
  const jarInputRef = useRef<HTMLInputElement>(null);

  const [manifest, setManifest] = useState<VersionManifestV2 | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && !manifest) {
      setIsLoadingVersions(true);
      manifestService
        .getVersionManifest()
        .then((data) => {
          setManifest(data);
          if (data.latest?.release) {
            setSelectedVersion(data.latest.release);
            setInstanceName(`Minecraft ${data.latest.release}`);
          }
          setIsLoadingVersions(false);
        })
        .catch((err) => {
          console.error("Failed to load versions:", err);
          setIsLoadingVersions(false);
        });
    }
  }, [isOpen, manifest]);

  // 切換 Loader
  const handleSelectLoader = (loader: LoaderType) => {
    setSelectedLoader(loader);
  };

  // 當選取的 Minecraft 版本或 Loader 改變時，動態擷取真實加載器版本
  useEffect(() => {
    if (!isOpen) return;
    if (selectedLoader === "Vanilla" || selectedLoader === "Custom") {
      setLoaderOptions([]);
      setLoaderVersion("");
      setIsLoadingLoaders(false);
      return;
    }

    let isMounted = true;
    setIsLoadingLoaders(true);

    loaderService
      .getLoaderVersions(selectedLoader, selectedVersion)
      .then((opts) => {
        if (!isMounted) return;
        setLoaderOptions(opts);
        if (opts.length > 0) {
          const rec = opts.find((o) => o.isRecommended) || opts[0];
          setLoaderVersion(rec.version);
        } else {
          setLoaderVersion("");
        }
        setIsLoadingLoaders(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load loader versions:", err);
        setLoaderOptions([]);
        setLoaderVersion("");
        setIsLoadingLoaders(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedLoader, selectedVersion]);

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
      setErrorMessage("請選擇合法的 Minecraft .jar 檔案");
      return;
    }
    setErrorMessage(null);
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
      setErrorMessage("請輸入實例名稱");
      return;
    }

    if (selectedLoader === "Custom" && !customJar) {
      setErrorMessage("Custom 模式必須提供自訂 Loader .jar 檔案");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

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
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`建立實例失敗: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 根據快照與歷史勾選狀態即時過濾版本清單
  const filteredVersions = useMemo(() => {
    if (!manifest?.versions) {
      return [
        { id: "1.21.4", type: "release" },
        { id: "1.20.4", type: "release" },
        { id: "1.19.4", type: "release" },
      ];
    }
    return manifest.versions.filter((v) => {
      if (v.type === "release") return true;
      if (showSnapshots && v.type === "snapshot") return true;
      if (showHistorical && (v.type === "old_beta" || v.type === "old_alpha")) return true;
      return false;
    });
  }, [manifest, showSnapshots, showHistorical]);

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
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-[#3C8527] to-[#2E6B1D] text-white shadow-md shadow-[#3C8527]/20 border border-white/10">
                <Box className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-slate-100">
                  建立全新實例
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  於 %APPDATA%/focusite_launcher/instances/ 建立獨立隔離目錄。
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* 2. 兩欄式恆定佈局主體 (完全移除內部 Scroll Area，恆定固定高度確保 0px 位移) */}
          <div className="h-[360px] p-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch shrink-0">
            {/* === 左側欄位 === */}
            <div className="flex flex-col h-full space-y-4">
              {/* 實例自訂名稱與圖示 (標籤置頂，圖示與輸入框等高並排) */}
              <div className="space-y-1 shrink-0">
                <label className="font-semibold text-xs text-slate-300">實例自訂名稱 *</label>
                <div className="flex items-center gap-2.5">
                  {/* 圖示選擇按鈕 (h-9 w-9 與 Input 等高) */}
                  <div className="relative group shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:border-[#52A43A]/60 hover:bg-[#3C8527]/15 transition-all overflow-hidden"
                        >
                          {iconPreview ? (
                            <img
                              src={iconPreview}
                              alt="實例圖示預覽"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-slate-400 group-hover:text-[#52A43A] transition-colors" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {iconPreview ? "點擊更換圖示" : "上傳實例圖示"}
                      </TooltipContent>
                    </Tooltip>

                    {iconPreview && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={handleClearIcon}
                            className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500/90 text-white shadow hover:bg-red-600 transition-colors"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">移除圖示</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* 實例名稱輸入框 */}
                  <Input
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    placeholder="例如：生存伺服冒險 1.21.4"
                    className="bg-black/40 border-white/10 text-xs h-9 flex-1"
                    required
                  />
                </div>
              </div>

              {/* 實例描述（自動填滿左欄剩餘高度，與右欄高度齊平） */}
              <div className="flex-1 flex flex-col space-y-1 min-h-0 pt-0.5">
                <label className="font-semibold text-xs text-slate-300">實例描述 (可選)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="輸入此實例的描述、用途備註或模組包簡介..."
                  className="w-full flex-1 min-h-[170px] rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-slate-100 placeholder:text-slate-500 shadow-sm transition-colors focus-visible:outline-none focus-visible:border-[#52A43A]/60 focus-visible:ring-1 focus-visible:ring-[#52A43A] resize-none"
                />
              </div>
            </div>

            {/* === 右側欄位 === */}
            <div className="flex flex-col h-full space-y-3">
              {/* 實例 Loader 標題列 (與左側實例自訂名稱標籤頂部完全水平齊平) */}
              <div className="flex items-center justify-between shrink-0 h-[18px]">
                <label className="font-semibold text-xs text-slate-300">模組加載器 (Loader) *</label>
              </div>

              {/* Loader 按鈕組 (6 大選項，恆定高度 70px) */}
              <div className="grid grid-cols-3 gap-2 shrink-0">
                {LOADERS.map((loader) => {
                  const isSelected = selectedLoader === loader;
                  const isRestricted =
                    loader !== "Vanilla" && isVersionOlderThan125(selectedVersion);
                  return (
                    <Tooltip key={loader}>
                      <TooltipTrigger asChild>
                        <span>
                          <button
                            type="button"
                            disabled={isRestricted}
                            onClick={() => !isRestricted && handleSelectLoader(loader)}
                            className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border text-xs font-semibold transition-all w-full ${
                              isRestricted
                                ? "border-white/5 bg-black/10 text-slate-600 opacity-40 cursor-not-allowed"
                                : isSelected
                                  ? "border-[#52A43A]/60 bg-[#3C8527]/20 text-[#52A43A] shadow-sm shadow-[#3C8527]/20"
                                  : "border-white/10 bg-black/20 text-slate-400 hover:bg-white/5 hover:text-slate-200"
                            }`}
                          >
                            <span>{loader}</span>
                          </button>
                        </span>
                      </TooltipTrigger>
                      {isRestricted && (
                        <TooltipContent side="top">
                          1.2.5 以前之版本僅支援 Vanilla 原版
                        </TooltipContent>
                      )}
                    </Tooltip>
                  );
                })}
              </div>

              {/* 恆定佈局區域 (高度恆定 200px，根據 Loader 類型無縫切換無抖動) */}
              <div className="flex-1 flex flex-col justify-between min-h-0 pt-1">
                {/* 狀況 A: 非 Custom 時呈現 Minecraft 遊戲版本 Dropdown */}
                {selectedLoader !== "Custom" ? (
                  <div className="space-y-3">
                    {/* Minecraft 遊戲版本 自訂 Dropdown + 右上方快照/歷史勾選框 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="font-semibold text-xs text-slate-300">
                          Minecraft 遊戲版本 *
                        </label>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
                            <Checkbox checked={showSnapshots} onCheckedChange={setShowSnapshots} />
                            <span>顯示快照版</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-400 hover:text-slate-200">
                            <Checkbox checked={showHistorical} onCheckedChange={setShowHistorical} />
                            <span>顯示歷史版</span>
                          </label>
                        </div>
                      </div>

                      <Select
                        value={selectedVersion}
                        onValueChange={(ver) => {
                          setSelectedVersion(ver);
                          if (isVersionOlderThan125(ver) && selectedLoader !== "Vanilla") {
                            setSelectedLoader("Vanilla");
                          }
                        }}
                        disabled={isLoadingVersions}
                      >
                        <SelectTrigger className="w-full h-8">
                          {isLoadingVersions ? (
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <RefreshCw className="h-3 w-3 animate-spin text-[#52A43A]" />
                              <span>讀取 Minecraft 版本中...</span>
                            </div>
                          ) : (
                            <SelectValue placeholder="選擇 Minecraft 版本..." />
                          )}
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {filteredVersions.map((v) => (
                            <SelectItem
                              key={v.id}
                              value={v.id}
                              extraRight={
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {v.type === "release"
                                    ? "正式版"
                                    : v.type === "snapshot"
                                      ? "快照版"
                                      : "歷史版"}
                                </span>
                              }
                            >
                              Minecraft {v.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 狀況 A-1: 非 Vanilla 且非 Custom 時呈現 Loader 版本 Dropdown */}
                    {selectedLoader !== "Vanilla" ? (
                      <div className="space-y-1">
                        <label className="font-semibold text-xs text-slate-300">
                          {selectedLoader} 加載器版本 *
                        </label>
                        {loaderOptions.length === 0 && !isLoadingLoaders ? (
                          <div className="flex h-8 w-full items-center rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-slate-500 italic select-none">
                            此版本暫無相容的 {selectedLoader} 加載器
                          </div>
                        ) : (
                          <Select
                            value={loaderVersion}
                            onValueChange={setLoaderVersion}
                            disabled={isLoadingLoaders}
                          >
                            <SelectTrigger className="w-full h-8">
                              {isLoadingLoaders ? (
                                <div className="flex items-center gap-1.5 text-slate-400">
                                  <RefreshCw className="h-3 w-3 animate-spin text-[#52A43A]" />
                                  <span>讀取 {selectedLoader} 版本中...</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 truncate">
                                  <SelectValue placeholder={`選擇 ${selectedLoader} 版本...`} />
                                  {loaderOptions.find((o) => o.version === loaderVersion)?.isRecommended && (
                                    <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                                  )}
                                </div>
                              )}
                            </SelectTrigger>
                            <SelectContent className="max-h-52">
                              {loaderOptions.map((opt) => (
                                <SelectItem
                                  key={opt.version}
                                  value={opt.version}
                                  extraRight={
                                    opt.isRecommended ? (
                                      <div className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20 font-medium">
                                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                        <span>推薦</span>
                                      </div>
                                    ) : undefined
                                  }
                                >
                                  {opt.version}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ) : (
                      /* 狀況 A-2: Vanilla 時呈現純淨原版提示卡片以填補相同高度 */
                      <div className="flex items-center gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3C8527]/20 text-[#52A43A]">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                        <div className="text-[11px] space-y-0.5">
                          <p className="font-medium text-slate-200">純淨官方原版 (Vanilla)</p>
                          <p className="text-slate-400 text-[10px]">
                            無外加 Loader 注入，享有最穩定的官方環境與完整原生相容性。
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* 狀況 B: Custom 時呈現 Custom Jar 拖曳選擇區 (填滿相同高度空間) */
                  <div className="h-full flex flex-col space-y-1.5 justify-center">
                    <label className="font-semibold text-xs text-slate-300">自訂 Loader Jar 檔案 *</label>
                    <div
                      onDragOver={handleJarDragOver}
                      onDragLeave={handleJarDragLeave}
                      onDrop={handleJarDrop}
                      onClick={() => jarInputRef.current?.click()}
                      className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${isDraggingJar
                          ? "border-[#52A43A] bg-[#3C8527]/10"
                          : customJar
                            ? "border-[#52A43A]/60 bg-black/40"
                            : "border-white/15 bg-black/20 hover:border-white/30 hover:bg-white/5"
                        }`}
                    >
                      {customJar ? (
                        <div className="flex items-center justify-between w-full px-2">
                          <div className="flex items-center gap-2.5 truncate">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3C8527]/20 text-[#52A43A] border border-[#52A43A]/30">
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                            <div className="truncate">
                              <p className="font-mono font-semibold text-slate-200 text-xs truncate">
                                {customJar.name}
                              </p>
                              <p className="text-[10px] text-slate-400">{customJar.sizeStr}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={handleClearJar}
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
                            拖曳 .jar 檔案至此，或點擊瀏覽選取
                          </p>
                          <p className="text-[10px] text-slate-500">
                            將保存為個別實例根目錄之自訂加載器
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3. 錯誤訊息提示條 */}
          {errorMessage && (
            <div className="px-6 py-2 bg-rose-950/40 border-t border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-rose-400 hover:text-rose-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

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
              取消
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={isSubmitting}
              className="gap-1.5 bg-[#3C8527] hover:bg-[#469C2D] text-white font-semibold text-xs px-4"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>正在寫入磁碟...</span>
                </>
              ) : (
                <span>確認建立實例</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
