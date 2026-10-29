import React, { useRef, useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  FolderOpen,
  Settings,
  Package,
  HardDrive,
  Cpu,
  Image as ImageIcon,
  RotateCcw,
  Layers,
  Camera,
  Palette,
  Server,
  Play,
  Square,
  RefreshCw,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Trash2,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { convertFileSrc } from "@tauri-apps/api/core";
import { InstanceDetailSubNav, MinecraftInstance, PackFileInfo, VersionCapabilities } from "@/types/navigation";
import {
  instanceService,
  ModFileInfo,
  ScreenshotFileInfo,
  JavaInstallationDto,
} from "@/services/instanceService";

function FramelessEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 select-none">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-[#52A43A] shadow-inner">
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

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

// 水平分頁空間索引映射 (六大子分頁)
const SUB_TAB_ORDER: Record<InstanceDetailSubNav, number> = {
  screenshots: 0,
  mods: 1,
  resourcepacks: 2,
  saves: 3,
  servers: 4,
  settings: 5,
};

// 預設 Minecraft 官方版本背景圖
const DEFAULT_MC_BG =
  "https://launchercontent.mojang.com/images/1.21.0.jpg";

interface InstanceDetailViewProps {
  instance: MinecraftInstance | null;
  onLaunch: (id: string) => void;
  onGoToInstances?: () => void;
  isLaunching?: boolean;
  isRunning?: boolean;
  runningPid?: number | null;
  runningAccountName?: string | null;
  onKill?: () => void;
  onInstanceUpdated?: (updated: MinecraftInstance) => void;
}

export const InstanceDetailView: React.FC<InstanceDetailViewProps> = ({
  instance,
  onLaunch,
  onGoToInstances,
  isLaunching = false,
  isRunning = false,
  runningPid = null,
  runningAccountName = null,
  onKill,
  onInstanceUpdated,
}) => {
  const caps: VersionCapabilities = instance?.capabilities ?? {
    supportsNonVanillaLoaders: true,
    supportsShaderpacks: true,
    packFolderKind: "resourcepacks",
    modsTabMode: "modernsinglelist",
  };

  const [activeSubTab, setActiveSubTab] =
    useState<InstanceDetailSubNav>("screenshots");
  const [tabDirection, setTabDirection] = useState<number>(1);
  const [resourceShaderTab, setResourceShaderTab] = useState<"packs" | "shaders">("packs");
  const [resourceShaderDir, setResourceShaderDir] = useState<number>(1);
  const [legacyModTab, setLegacyModTab] = useState<"mods" | "coremods">("mods");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [maxRam, setMaxRam] = useState<number>(instance?.maxMemoryMb ?? 4096);
  const [minRam, setMinRam] = useState<number>(instance?.minMemoryMb ?? 1024);
  const [systemJavas, setSystemJavas] = useState<JavaInstallationDto[]>([]);
  const [selectedJavaPath, setSelectedJavaPath] = useState<string>(instance?.javaPath ?? "");
  const [showLogOnLaunch, setShowLogOnLaunch] = useState<boolean>(
    instance?.showLogOnLaunch ?? false
  );

  // 複製實例狀態
  const [isDuplicateOpen, setIsDuplicateOpen] = useState<boolean>(false);
  const [duplicateName, setDuplicateName] = useState<string>("");
  const [isDuplicating, setIsDuplicating] = useState<boolean>(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  useEffect(() => {
    if (instance) {
      setShowLogOnLaunch(instance.showLogOnLaunch ?? false);
      setMaxRam(instance.maxMemoryMb ?? 4096);
      setMinRam(instance.minMemoryMb ?? 1024);
      setSelectedJavaPath(instance.javaPath ?? "");
    }
  }, [
    instance?.id,
    instance?.showLogOnLaunch,
    instance?.maxMemoryMb,
    instance?.minMemoryMb,
    instance?.javaPath,
  ]);

  useEffect(() => {
    instanceService.listSystemJavas().then(setSystemJavas).catch(console.error);
  }, []);

  const handleToggleShowLog = async (checked: boolean) => {
    if (!instance) return;
    setShowLogOnLaunch(checked);
    await instanceService.setInstanceShowLog(instance.id, checked);
    try {
      const updated = await instanceService.updateInstanceSettings(instance.id, {
        showLogOnLaunch: checked,
      });
      if (onInstanceUpdated) {
        onInstanceUpdated(updated);
      }
    } catch (err) {
      console.error("Failed to persist showLogOnLaunch:", err);
    }
  };

  const handleRamChange = async (val: number) => {
    if (!instance) return;
    setMaxRam(val);
    try {
      const updated = await instanceService.updateInstanceSettings(instance.id, {
        maxMemoryMb: val,
        minMemoryMb: minRam,
      });
      if (onInstanceUpdated) {
        onInstanceUpdated(updated);
      }
    } catch (err) {
      console.error("Failed to persist RAM settings:", err);
    }
  };

  const handleJavaChange = async (path: string) => {
    if (!instance) return;
    setSelectedJavaPath(path);
    const finalJava = path.trim() === "" ? null : path.trim();
    try {
      const updated = await instanceService.updateInstanceSettings(instance.id, {
        javaPath: finalJava,
      });
      if (onInstanceUpdated) {
        onInstanceUpdated(updated);
      }
    } catch (err) {
      console.error("Failed to persist Java selection:", err);
    }
  };

  const openDuplicateModal = () => {
    if (!instance) return;
    setDuplicateName(`${instance.name} (複製)`);
    setDuplicateError(null);
    setIsDuplicateOpen(true);
  };

  const handleDuplicate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instance) return;
    const trimmed = duplicateName.trim();
    if (!trimmed) {
      setDuplicateError("請輸入複製實例名稱");
      return;
    }
    setIsDuplicating(true);
    setDuplicateError(null);
    try {
      const dup = await instanceService.duplicateInstance(instance.id, trimmed);
      setIsDuplicateOpen(false);
      if (onInstanceUpdated) {
        onInstanceUpdated(dup);
      }
      if (onGoToInstances) {
        onGoToInstances();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDuplicateError(msg);
    } finally {
      setIsDuplicating(false);
    }
  };

  // 重新命名實例狀態
  const [isRenameOpen, setIsRenameOpen] = useState<boolean>(false);
  const [renameInput, setRenameInput] = useState<string>("");
  const [showFolderRenamePrompt, setShowFolderRenamePrompt] = useState<boolean>(false);
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const openRenameModal = () => {
    if (!instance) return;
    setRenameInput(instance.name);
    setShowFolderRenamePrompt(false);
    setRenameError(null);
    setIsRenameOpen(true);
  };

  const handleRenameNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instance) return;
    const trimmed = renameInput.trim();
    if (!trimmed) {
      setRenameError("實例名稱不能為空");
      return;
    }
    if (trimmed === instance.name) {
      setIsRenameOpen(false);
      return;
    }
    setRenameError(null);
    setShowFolderRenamePrompt(true);
  };

  const executeRename = async (renameFolder: boolean) => {
    if (!instance) return;
    setIsRenaming(true);
    setRenameError(null);
    try {
      const updated = await instanceService.renameInstance(
        instance.id,
        renameInput.trim(),
        renameFolder
      );
      if (onInstanceUpdated) {
        onInstanceUpdated(updated);
      }
      setIsRenameOpen(false);
      setShowFolderRenamePrompt(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRenameError(msg);
    } finally {
      setIsRenaming(false);
    }
  };

  // 處理水平物理方向的子分頁切換
  const handleSelectSubTab = (newTab: InstanceDetailSubNav) => {
    if (newTab === activeSubTab) return;
    const dir = SUB_TAB_ORDER[newTab] > SUB_TAB_ORDER[activeSubTab] ? 1 : -1;
    setTabDirection(dir);
    setActiveSubTab(newTab);
  };

  const handleResourceShaderChange = (tab: "packs" | "shaders") => {
    if (tab === resourceShaderTab) return;
    const dir = tab === "shaders" ? 1 : -1;
    setResourceShaderDir(dir);
    setResourceShaderTab(tab);
  };

  const handleDeleteInstance = async () => {
    if (!instance) return;
    setIsDeleting(true);
    try {
      await instanceService.deleteInstance(instance.id);
      setIsDeleteDialogOpen(false);
      if (onGoToInstances) {
        onGoToInstances();
      }
    } catch (err) {
      console.error("刪除實例失敗:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  // 真實磁碟模組、核心模組、材質包、光影包、存檔與截圖狀態
  const [mods, setMods] = useState<ModFileInfo[]>([]);
  const [coremods, setCoremods] = useState<ModFileInfo[]>([]);
  const [resourcepacks, setResourcepacks] = useState<PackFileInfo[]>([]);
  const [shaderpacks, setShaderpacks] = useState<PackFileInfo[]>([]);
  const [saves, setSaves] = useState<string[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotFileInfo[]>([]);
  const [currentScreenshotIdx, setCurrentScreenshotIdx] = useState<number>(0);

  const refreshInstanceFiles = () => {
    if (!instance) return;
    const currentCaps = instance.capabilities ?? {
      supportsShaderpacks: true,
      packFolderKind: "resourcepacks",
      modsTabMode: "standard",
    };
    Promise.all([
      instanceService.listInstanceMods(instance.id),
      currentCaps.modsTabMode === "legacydualnav"
        ? instanceService.listInstanceCoremods(instance.id)
        : Promise.resolve([]),
      instanceService.listInstanceSaves(instance.id),
      instanceService.listInstanceScreenshots(instance.id),
      instanceService.listInstanceResourcepacks(instance.id),
      currentCaps.supportsShaderpacks
        ? instanceService.listInstanceShaderpacks(instance.id)
        : Promise.resolve([]),
    ]).then(([mList, cList, sList, scList, rList, shList]) => {
      setMods(mList);
      setCoremods(cList);
      setSaves(sList);
      setScreenshots(scList);
      setResourcepacks(rList);
      setShaderpacks(shList);
    });
  };

  useEffect(() => {
    if (!instance) return;
    let isMounted = true;
    const currentCaps = instance.capabilities ?? {
      supportsShaderpacks: true,
      packFolderKind: "resourcepacks",
      modsTabMode: "standard",
    };
    Promise.all([
      instanceService.listInstanceMods(instance.id),
      currentCaps.modsTabMode === "legacydualnav"
        ? instanceService.listInstanceCoremods(instance.id)
        : Promise.resolve([]),
      instanceService.listInstanceSaves(instance.id),
      instanceService.listInstanceScreenshots(instance.id),
      instanceService.listInstanceResourcepacks(instance.id),
      currentCaps.supportsShaderpacks
        ? instanceService.listInstanceShaderpacks(instance.id)
        : Promise.resolve([]),
    ]).then(([mList, cList, sList, scList, rList, shList]) => {
      if (isMounted) {
        setMods(mList);
        setCoremods(cList);
        setSaves(sList);
        setScreenshots(scList);
        setResourcepacks(rList);
        setShaderpacks(shList);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [instance?.id]);

  // 截圖分頁鍵盤左右方向鍵切換
  useEffect(() => {
    if (activeSubTab !== "screenshots" || screenshots.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setCurrentScreenshotIdx((cur) => (cur > 0 ? cur - 1 : screenshots.length - 1));
      } else if (e.key === "ArrowRight") {
        setCurrentScreenshotIdx((cur) => (cur < screenshots.length - 1 ? cur + 1 : 0));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSubTab, screenshots.length]);

  const toggleMod = async (filename: string, enabled: boolean) => {
    if (!instance) return;
    setMods((prev) =>
      prev.map((m) => (m.filename === filename ? { ...m, enabled } : m))
    );
    try {
      await instanceService.toggleModState(instance.id, filename, enabled);
      const updated = await instanceService.listInstanceMods(instance.id);
      setMods(updated);
    } catch (err) {
      console.error("Failed to toggle mod:", err);
      refreshInstanceFiles();
    }
  };

  const toggleCoremod = async (filename: string, enabled: boolean) => {
    if (!instance) return;
    setCoremods((prev) =>
      prev.map((m) => (m.filename === filename ? { ...m, enabled } : m))
    );
    try {
      await instanceService.toggleCoremodState(instance.id, filename, enabled);
      const updated = await instanceService.listInstanceCoremods(instance.id);
      setCoremods(updated);
    } catch (err) {
      console.error("Failed to toggle coremod:", err);
      refreshInstanceFiles();
    }
  };

  // 可自訂背景圖狀態
  const [bgImage, setBgImage] = useState<string>(DEFAULT_MC_BG);
  const [bgLoadError, setBgLoadError] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCustomBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setBgImage(url);
      setBgLoadError(false);
    }
  };

  const handleResetBg = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBgImage(DEFAULT_MC_BG);
    setBgLoadError(false);
  };

  const navTabs = useMemo(() => {
    const list: { id: InstanceDetailSubNav; label: string; icon: React.ReactNode }[] = [];

    list.push({
      id: "screenshots",
      label: screenshots.length > 0 ? `遊戲截圖 (${screenshots.length})` : "遊戲截圖",
      icon: <Camera className="h-4 w-4" />,
    });

    if (caps.modsTabMode !== "hidden") {
      const count =
        caps.modsTabMode === "legacydualnav"
          ? mods.length + coremods.length
          : mods.length;
      list.push({
        id: "mods",
        label: `模組管理 (${count})`,
        icon: <Package className="h-4 w-4" />,
      });
    }

    if (caps.packFolderKind !== "hidden") {
      const label =
        caps.packFolderKind === "texturepacks"
          ? `材質包 (${resourcepacks.length})`
          : caps.supportsShaderpacks
            ? "材質光影"
            : `材質包 (${resourcepacks.length})`;
      list.push({
        id: "resourcepacks",
        label,
        icon: <Palette className="h-4 w-4" />,
      });
    }

    list.push({
      id: "saves",
      label: `世界存檔 (${saves.length})`,
      icon: <HardDrive className="h-4 w-4" />,
    });

    list.push({
      id: "servers",
      label: "多人伺服",
      icon: <Server className="h-4 w-4" />,
    });

    list.push({
      id: "settings",
      label: "實例設定",
      icon: <Settings className="h-4 w-4" />,
    });

    return list;
  }, [
    screenshots.length,
    caps.modsTabMode,
    caps.packFolderKind,
    caps.supportsShaderpacks,
    mods.length,
    coremods.length,
    resourcepacks.length,
    saves.length,
  ]);

  useEffect(() => {
    if (navTabs.length > 0 && !navTabs.some((t) => t.id === activeSubTab)) {
      setActiveSubTab(navTabs[0].id);
    }
  }, [navTabs, activeSubTab]);

  // 雙向水平滑動物理動態變體
  const tabContentVariants = {
    initial: (dir: number) => ({
      opacity: 0,
      x: dir * 32,
    }),
    animate: {
      opacity: 1,
      x: 0,
      transition: {
        type: "spring" as const,
        stiffness: 450,
        damping: 35,
        mass: 0.8,
      },
    },
    exit: (dir: number) => ({
      opacity: 0,
      x: -dir * 32,
      transition: {
        duration: 0.14,
      },
    }),
  };

  // 空狀態：純淨水平垂直絕對居中，無卡片樣式
  if (!instance) {
    return (
      <div className="flex flex-1 h-full min-h-[500px] w-full flex-col items-center justify-center p-8 text-center select-none">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-400">
          <Layers className="h-7 w-7 text-slate-400" />
        </div>
        <div className="mt-4 space-y-1">
          <h3 className="text-base font-semibold text-white">尚未選取任何實例</h3>
          <p className="text-xs text-slate-400">請從實例列表選取或建立全新實例。</p>
        </div>
        {onGoToInstances && (
          <Button
            onClick={onGoToInstances}
            className="mt-5 bg-[#3C8527] hover:bg-[#52A43A] text-white text-xs font-semibold px-4 py-2"
          >
            返回實例列表
          </Button>
        )}
      </div>
    );
  }

  // 1. 緊湊頂部 Hero 橫幅
  const heroSection = (
    <div className="relative w-full h-44 shrink-0 overflow-hidden border-b border-white/10 bg-slate-950">
      {/* 背景大圖與漸變遮罩 */}
      {!bgLoadError ? (
        <img
          src={bgImage}
          alt="Minecraft Official Artwork"
          onError={() => setBgLoadError(true)}
          className="absolute inset-0 h-full w-full object-cover object-center filter brightness-75"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1E4A13] via-[#0E260A] to-slate-950" />
      )}

      {/* 氛圍遮罩與暗部漸層以確保文字與按鈕清晰可讀 */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/50 to-slate-950/70" />
      <div className="pointer-events-none absolute bottom-0 left-6 h-28 w-80 rounded-full bg-[#3C8527]/25 blur-3xl" />

      {/* Hero 內部下緣內容：實例資訊與操作按鈕群 */}
      <div className="relative z-10 flex h-full w-full items-end justify-between px-6 pb-4">
        {/* 左側實例圖示、名稱、版本 */}
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#3C8527] to-[#2E6B1D] text-white shadow-xl shadow-[#3C8527]/30 border border-white/20 overflow-hidden">
            {instance.hasIcon && instance.iconPath ? (
              <img
                src={getIconSrc(instance.iconPath)}
                alt={instance.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-7 w-7 drop-shadow" />
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-white drop-shadow-md">
                {instance.name}
              </h1>
              <button
                type="button"
                onClick={openRenameModal}
                className="rounded p-1 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="重新命名實例"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 drop-shadow">
              Minecraft {instance.version} - {instance.loader}{instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}
              {instance.description && (
                <span className="text-[11px] text-slate-300 drop-shadow line-clamp-1">
                  ｜{instance.description}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* 右側按鈕群：更換背景、開啟遊戲資料夾、立即啟動遊戲 */}
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5 text-xs h-8 rounded-lg border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-200"
            title="自訂背景圖片"
          >
            <ImageIcon className="h-3.5 w-3.5 text-slate-300" />
            <span>更換背景</span>
          </Button>

          {bgImage !== DEFAULT_MC_BG && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetBg}
              className="text-xs h-8 px-2.5 rounded-lg border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-300"
              title="恢復預設官方圖"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => instanceService.openInstanceDirectory(instance.id, "minecraft")}
            className="gap-1.5 text-xs h-8 rounded-lg border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-200"
          >
            <FolderOpen className="h-3.5 w-3.5 text-slate-300" />
            <span>開啟遊戲資料夾</span>
          </Button>

          {isRunning ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onKill}
              className="gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 h-8 rounded-lg shadow-lg shadow-rose-900/30"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              <span>
                強制終止 (PID: {runningPid}
                {runningAccountName ? ` • ${runningAccountName}` : ""})
              </span>
            </Button>
          ) : isLaunching ? (
            <Button
              type="button"
              size="sm"
              disabled
              className="gap-2 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] opacity-80 cursor-wait text-white font-bold px-4 h-8 rounded-lg shadow-lg"
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>正在啟動...</span>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => onLaunch(instance.id)}
              className="gap-2 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] hover:from-[#469C2D] hover:to-[#357A21] text-white font-bold px-5 h-8 rounded-lg shadow-lg shadow-[#3C8527]/30"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>立即啟動遊戲</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // 2. 六大子分頁導覽列 (吸頂黏附)
  const tabNavSection = (
    <div className="sticky top-0 z-30 w-full border-b border-white/10 bg-[#0b0f17]/90 backdrop-blur-xl">
      <div className="flex items-center gap-1 px-6 py-1 overflow-x-auto">
        {navTabs.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSelectSubTab(tab.id)}
              className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${isActive
                ? "text-[#52A43A]"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              {tab.icon}
              <span>{tab.label}</span>

              {isActive && (
                <motion.div
                  layoutId="instance-detail-tab-pill"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.8)]"
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 35,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const fileInput = (
    <input
      type="file"
      ref={fileInputRef}
      onChange={handleCustomBgChange}
      accept="image/*"
      className="hidden"
    />
  );

  const renameDialog = (
    <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
      <DialogContent onClose={() => setIsRenameOpen(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {showFolderRenamePrompt ? "確認更改實例資料夾名稱" : "重新命名實例"}
          </DialogTitle>
        </DialogHeader>

        {renameError && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400">
            {renameError}
          </div>
        )}

        {!showFolderRenamePrompt ? (
          <form onSubmit={handleRenameNext} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-300">實例顯示名稱</label>
              <Input
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                placeholder="輸入新的實例名稱..."
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRenameOpen(false)}
                className="text-xs"
              >
                取消
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-[#3C8527] hover:bg-[#52A43A] text-white text-xs font-semibold"
              >
                儲存修改
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              您即將將實例名稱更改為「<span className="text-[#52A43A] font-semibold">{renameInput.trim()}</span>」。
              <br />
              是否同步更改個別實例資料夾名稱為更改後的實例名稱？
            </p>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs space-y-1">
              <div className="text-slate-400">目前資料夾名稱：<span className="font-mono text-slate-200">{instance.id}</span></div>
              <div className="text-slate-400">新資料夾名稱：<span className="font-mono text-[#52A43A]">{renameInput.trim()}</span></div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="button"
                size="sm"
                disabled={isRenaming}
                onClick={() => executeRename(true)}
                className="bg-[#3C8527] hover:bg-[#52A43A] text-white text-xs font-semibold"
              >
                {isRenaming ? "正在重新命名..." : "同步更改個別實例資料夾名稱"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRenaming}
                onClick={() => executeRename(false)}
                className="text-xs border-white/15 bg-white/5 hover:bg-white/10 text-slate-300"
              >
                僅更改顯示名稱 (保留現有資料夾名稱)
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isRenaming}
                onClick={() => setIsRenameOpen(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                取消
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  const deleteDialog = (
    <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
      <DialogContent className="border border-white/10 bg-slate-950/95 text-slate-100 backdrop-blur-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-rose-400">
            <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
            確定要刪除實例「{instance?.name}」？
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-xs text-slate-300 leading-relaxed">
          <p>
            此操作無法復原。將永久刪除位於目錄{" "}
            <span className="font-mono text-rose-300 bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-900/40">
              instances/{instance?.id}
            </span>{" "}
            內的所有遊戲檔案。
          </p>
          <p className="text-slate-400">共用的 CAS 全域快取庫不會受影響。</p>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isDeleting}
            onClick={() => setIsDeleteDialogOpen(false)}
            className="border-white/10 text-xs"
          >
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isDeleting}
            onClick={handleDeleteInstance}
            className="gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
          >
            {isDeleting ? "正在刪除..." : "確認刪除實例"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  const duplicateDialog = (
    <Dialog open={isDuplicateOpen} onOpenChange={setIsDuplicateOpen}>
      <DialogContent onClose={() => setIsDuplicateOpen(false)} className="max-w-md">
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
              onClick={() => setIsDuplicateOpen(false)}
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
  );

  // 六大子分頁：統一 ScrollArea，往下捲動時 Tab 列吸頂，所有子分頁共享 AnimatePresence 與物理方向
  return (
    <ScrollArea className="h-full w-full" viewportClassName="p-0">
      <div className="flex flex-col w-full min-h-full select-none pb-12">
        {fileInput}
        {heroSection}
        {tabNavSection}

        {/* 子分頁無框扁平內容 (雙向水平物理動態轉場，完全移除外層卡片邊框) */}
        <div className="p-6 space-y-6 max-w-6xl overflow-hidden">
          <AnimatePresence mode="wait" custom={tabDirection}>
            {/* 1. 遊戲截圖分頁 */}
            {activeSubTab === "screenshots" && (
              <motion.div
                key="screenshots"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <div>
                    <h2 className="text-sm font-bold text-white">
                      遊戲截圖 (Screenshots)
                      {screenshots.length > 0 && ` · 共 ${screenshots.length} 張`}
                    </h2>
                    <p className="text-xs text-slate-400">
                      此實例於遊戲內按下 F2 所保存的高畫質遊戲截圖。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => instanceService.openInstanceDirectory(instance.id, "screenshots")}
                    className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                    開啟截圖資料夾
                  </Button>
                </div>

                {screenshots.length === 0 ? (
                  <FramelessEmptyState
                    icon={Camera}
                    title="尚未有遊戲截圖"
                    description="進入遊戲後按下 F2 拍攝截圖，將自動歸檔於此處。"
                  />
                ) : (
                  <div className="relative min-h-[420px] flex flex-col items-center justify-center overflow-hidden py-4">
                    {/* 左右圓形毛玻璃導航箭頭 */}
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentScreenshotIdx((cur) =>
                          cur > 0 ? cur - 1 : screenshots.length - 1
                        )
                      }
                      className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 border border-white/20 text-white backdrop-blur-md shadow-2xl hover:bg-white/20 active:scale-95 transition-all"
                      title="上一張 (方向鍵左)"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setCurrentScreenshotIdx((cur) =>
                          cur < screenshots.length - 1 ? cur + 1 : 0
                        )
                      }
                      className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 border border-white/20 text-white backdrop-blur-md shadow-2xl hover:bg-white/20 active:scale-95 transition-all"
                      title="下一張 (方向鍵右)"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>

                    {/* 3D Coverflow 水平輪播畫布 */}
                    <div className="relative flex items-center justify-center h-[340px] w-full perspective-[1000px]">
                      {screenshots.map((sc, idx) => {
                        const diff = idx - currentScreenshotIdx;
                        if (Math.abs(diff) > 2) return null;

                        const isCurrent = diff === 0;
                        const xOffset = diff * 260;
                        const scale = isCurrent ? 1 : 0.82;
                        const zIndex = isCurrent ? 20 : 10 - Math.abs(diff);
                        const opacity = isCurrent ? 1 : 0.35;
                        const filter = isCurrent ? "none" : "brightness(0.5)";

                        return (
                          <motion.div
                            key={sc.path}
                            onClick={() => setCurrentScreenshotIdx(idx)}
                            animate={{
                              x: xOffset,
                              scale,
                              opacity,
                              filter,
                              zIndex,
                            }}
                            transition={{
                              type: "spring",
                              stiffness: 400,
                              damping: 32,
                            }}
                            className={`absolute cursor-pointer overflow-hidden rounded-2xl select-none transition-shadow ${isCurrent
                              ? "w-[540px] max-w-[85vw] aspect-video border-2 border-[#52A43A] shadow-[0_0_36px_rgba(82,164,58,0.3)] ring-1 ring-[#52A43A]/40"
                              : "w-[460px] aspect-video border border-white/10"
                              }`}
                          >
                            <img
                              src={getIconSrc(sc.path)}
                              alt={sc.name}
                              className="h-full w-full object-cover"
                            />

                            {/* 頂部標籤 */}
                            {isCurrent && (
                              <div className="absolute top-3 left-3 z-10">
                                <Badge className="bg-[#2E6B1D]/90 text-[#52A43A] border border-[#52A43A]/50 backdrop-blur-md text-[11px] px-2.5 py-0.5 shadow-md">
                                  {sc.name}
                                </Badge>
                              </div>
                            )}

                            {/* 聚焦圖片底部漸層資訊列 */}
                            {isCurrent && (
                              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-4 flex items-end justify-between">
                                <div className="space-y-0.5">
                                  <p className="text-sm font-bold text-white drop-shadow">
                                    {sc.name}
                                  </p>
                                  <p className="text-[11px] text-slate-300 font-mono drop-shadow">
                                    {sc.created_at
                                      ? new Date(Number(sc.created_at) * 1000).toLocaleString("zh-TW")
                                      : "遊戲截圖"}
                                  </p>
                                </div>
                                <Badge variant="outline" className="border-[#52A43A]/40 text-[#52A43A] text-[10px] bg-black/40">
                                  {idx + 1} / {screenshots.length}
                                </Badge>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </div>

                    {/* 底部指示點與膠囊 */}
                    <div className="flex items-center gap-1.5 pt-4 z-20">
                      {screenshots.map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setCurrentScreenshotIdx(idx)}
                          className={`transition-all duration-300 ${idx === currentScreenshotIdx
                            ? "w-6 h-1.5 rounded-full bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.6)]"
                            : "w-1.5 h-1.5 rounded-full bg-white/20 hover:bg-white/40"
                            }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
            {/* 2. 模組管理分頁 */}
            {activeSubTab === "mods" && caps.modsTabMode !== "hidden" && (
              <motion.div
                key="mods"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                {caps.modsTabMode === "legacydualnav" ? (
                  <>
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                        <button
                          type="button"
                          onClick={() => setLegacyModTab("mods")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${legacyModTab === "mods"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {legacyModTab === "mods" && (
                            <motion.div
                              layoutId="legacy-mod-pill"
                              className="absolute inset-0 rounded-lg bg-[#3C8527] shadow-sm shadow-[#3C8527]/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Package className="h-3.5 w-3.5" />
                            Mods ({mods.length})
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setLegacyModTab("coremods")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${legacyModTab === "coremods"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {legacyModTab === "coremods" && (
                            <motion.div
                              layoutId="legacy-mod-pill"
                              className="absolute inset-0 rounded-lg bg-[#3C8527] shadow-sm shadow-[#3C8527]/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Package className="h-3.5 w-3.5" />
                            Core Mods ({coremods.length})
                          </span>
                        </button>
                      </div>

                      <div>
                        {legacyModTab === "mods" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => instanceService.openInstanceDirectory(instance.id, "mods")}
                            className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                            開啟 mods 資料夾
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => instanceService.openInstanceDirectory(instance.id, "coremods")}
                            className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                            開啟 coremods 資料夾
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#52A43A]/20 bg-[#3C8527]/10 p-3 text-xs text-[#52A43A] leading-relaxed">
                      1.2.5 ~ 1.5.2 Forge 雙資料夾隔離機制：ASM 核心攔截模組（例如 CodeChickenCore、早期 OptiFine）請置入 coremods/；一般增添方塊、生物與物品的模組請置入 mods/。
                    </div>

                    {legacyModTab === "mods" ? (
                      mods.length === 0 ? (
                        <FramelessEmptyState
                          icon={Package}
                          title="minecraft/mods/ 中尚未有模組 (.jar)"
                          description="可將一般 Mod 放入實例目錄的 minecraft/mods/ 中。"
                        />
                      ) : (
                        <div className="space-y-1.5">
                          {mods.map((mod) => (
                            <ModItem
                              key={mod.filename}
                              name={mod.filename}
                              version={`${(mod.size_bytes / 1024).toFixed(1)} KB`}
                              desc={mod.enabled ? "已啟用" : "已停用 (.disabled)"}
                              enabled={mod.enabled}
                              onToggle={(checked) => toggleMod(mod.filename, checked)}
                            />
                          ))}
                        </div>
                      )
                    ) : coremods.length === 0 ? (
                      <FramelessEmptyState
                        icon={Package}
                        title="minecraft/coremods/ 中尚未有核心模組 (.jar)"
                        description="可將底層核心模組放入實例目錄的 minecraft/coremods/ 中。"
                      />
                    ) : (
                      <div className="space-y-1.5">
                        {coremods.map((mod) => (
                          <ModItem
                            key={mod.filename}
                            name={mod.filename}
                            version={`${(mod.size_bytes / 1024).toFixed(1)} KB`}
                            desc={mod.enabled ? "已啟用 (核心加載)" : "已停用 (.disabled)"}
                            enabled={mod.enabled}
                            onToggle={(checked) => toggleCoremod(mod.filename, checked)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div>
                        <h2 className="text-sm font-bold text-white">已安裝模組 ({mods.length})</h2>
                        <p className="text-xs text-slate-400">
                          共用 Mod 檔案由全域雜湊庫管理並透過作業系統原生 Hardlink 映射至此實例。
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => instanceService.openInstanceDirectory(instance.id, "mods")}
                        className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                      >
                        <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                        開啟 mods 資料夾
                      </Button>
                    </div>

                    {mods.length === 0 ? (
                      <FramelessEmptyState
                        icon={Package}
                        title="此實例尚未安裝任何模組 (.jar)"
                        description="可將 Mod 放入實例目錄的 minecraft/mods/ 中，或於模組工作坊下載。"
                      />
                    ) : (
                      <div className="space-y-1.5">
                        {mods.map((mod) => (
                          <ModItem
                            key={mod.filename}
                            name={mod.filename}
                            version={`${(mod.size_bytes / 1024).toFixed(1)} KB`}
                            desc={mod.enabled ? "已啟用" : "已停用 (.disabled)"}
                            enabled={mod.enabled}
                            onToggle={(checked) => toggleMod(mod.filename, checked)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {/* 3. 材質光影分頁 (根據版本自動適配 texturepacks / resourcepacks / shaderpacks) */}
            {activeSubTab === "resourcepacks" && caps.packFolderKind !== "hidden" && (
              <motion.div
                key="resourcepacks"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-6"
              >
                {!caps.supportsShaderpacks ? (
                  <>
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div>
                        <h2 className="text-sm font-bold text-white">
                          {caps.packFolderKind === "texturepacks"
                            ? "材質包 (Texture Packs)"
                            : "材質包 (Resource Packs)"}{" "}
                          ({resourcepacks.length})
                        </h2>
                        <p className="text-xs text-slate-400">
                          {caps.packFolderKind === "texturepacks"
                            ? "Minecraft 早期經典材質包目錄 (texturepacks/)。"
                            : "此版本置於 resourcepacks/ 目錄之自訂資源包。"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          instanceService.openInstanceDirectory(
                            instance.id,
                            caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks"
                          )
                        }
                        className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                      >
                        <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                        開啟 {caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks"} 資料夾
                      </Button>
                    </div>

                    {resourcepacks.length === 0 ? (
                      <FramelessEmptyState
                        icon={Palette}
                        title="尚未安裝材質包"
                        description={`將 .zip 材質包置入 ${caps.packFolderKind === "texturepacks" ? "texturepacks/" : "resourcepacks/"
                          } 資料夾即可於遊戲設定中啟用自訂材質。`}
                      />
                    ) : (
                      <div className="space-y-1.5">
                        {resourcepacks.map((pack) => (
                          <PackItem key={pack.filename} pack={pack} icon={Palette} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* 二級水平 Sub-Nav */}
                    <div className="flex items-center justify-between pb-2 border-b border-white/5">
                      <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                        <button
                          type="button"
                          onClick={() => handleResourceShaderChange("packs")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${resourceShaderTab === "packs"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {resourceShaderTab === "packs" && (
                            <motion.div
                              layoutId="resource-shader-pill"
                              className="absolute inset-0 rounded-lg bg-[#3C8527] shadow-sm shadow-[#3C8527]/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Palette className="h-3.5 w-3.5" />
                            {caps.packFolderKind === "texturepacks" ? "材質包" : "材質包"} ({resourcepacks.length})
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleResourceShaderChange("shaders")}
                          className={`relative px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${resourceShaderTab === "shaders"
                            ? "text-white"
                            : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                          {resourceShaderTab === "shaders" && (
                            <motion.div
                              layoutId="resource-shader-pill"
                              className="absolute inset-0 rounded-lg bg-[#3C8527] shadow-sm shadow-[#3C8527]/50"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10 flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5" />
                            光影包 ({shaderpacks.length})
                          </span>
                        </button>
                      </div>

                      <div>
                        {resourceShaderTab === "packs" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              instanceService.openInstanceDirectory(
                                instance.id,
                                caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks"
                              )
                            }
                            className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                            開啟 {caps.packFolderKind === "texturepacks" ? "texturepacks" : "resourcepacks"} 資料夾
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => instanceService.openInstanceDirectory(instance.id, "shaderpacks")}
                            className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                            開啟 shaderpacks 資料夾
                          </Button>
                        )}
                      </div>
                    </div>

                    <AnimatePresence mode="wait" custom={resourceShaderDir}>
                      {resourceShaderTab === "packs" ? (
                        <motion.div
                          key="packs"
                          custom={resourceShaderDir}
                          variants={tabContentVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          className="space-y-4"
                        >
                          {resourcepacks.length === 0 ? (
                            <FramelessEmptyState
                              icon={Palette}
                              title="尚未安裝材質包"
                              description="將 .zip 材質包置入 resourcepacks/ 資料夾即可於遊戲設定中啟用自訂材質。"
                            />
                          ) : (
                            <div className="space-y-1.5">
                              {resourcepacks.map((pack) => (
                                <PackItem key={pack.filename} pack={pack} icon={Palette} />
                              ))}
                            </div>
                          )}
                        </motion.div>
                      ) : (
                        <motion.div
                          key="shaders"
                          custom={resourceShaderDir}
                          variants={tabContentVariants}
                          initial="initial"
                          animate="animate"
                          exit="exit"
                          className="space-y-4"
                        >
                          {shaderpacks.length === 0 ? (
                            <FramelessEmptyState
                              icon={Layers}
                              title="尚未安裝光影包"
                              description="將光影著色器 (.zip) 置入 shaderpacks/ 資料夾，並安裝相容之 OptiFine 或 Iris 即可享受動態光影。"
                            />
                          ) : (
                            <div className="space-y-1.5">
                              {shaderpacks.map((pack) => (
                                <PackItem key={pack.filename} pack={pack} icon={Layers} />
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </motion.div>
            )}

            {/* 4. 世界存檔分頁 */}
            {activeSubTab === "saves" && (
              <motion.div
                key="saves"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <div>
                    <h2 className="text-sm font-bold text-white">世界存檔 ({saves.length})</h2>
                    <p className="text-xs text-slate-400">
                      獨立單人世界、地圖存檔與備份管理。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => instanceService.openInstanceDirectory(instance.id, "saves")}
                    className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                    開啟 saves 資料夾
                  </Button>
                </div>

                {saves.length === 0 ? (
                  <FramelessEmptyState
                    icon={HardDrive}
                    title="此實例尚未建立任何單人世界存檔"
                    description="啟動遊戲後建立單人世界，將自動儲存在此實例目錄中。"
                  />
                ) : (
                  <div className="space-y-1.5">
                    {saves.map((saveName) => (
                      <div
                        key={saveName}
                        className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <HardDrive className="h-4 w-4 text-emerald-400" />
                          <div>
                            <p className="font-semibold text-slate-200">{saveName}</p>
                            <p className="text-[10px] text-slate-400">遊戲世界存檔目錄</p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] py-0 px-2 border-white/10">
                          正常
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {/* 5. 多人伺服分頁 */}
            {activeSubTab === "servers" && (
              <motion.div
                key="servers"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-6"
              >
                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <div>
                    <h2 className="text-sm font-bold text-white">多人連線伺服器清單</h2>
                    <p className="text-xs text-slate-400">
                      記錄於 servers.dat 之伺服器書籤與自訂連線站點。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => instanceService.openInstanceDirectory(instance.id, "minecraft")}
                    className="text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10"
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                    開啟遊戲目錄
                  </Button>
                </div>

                <FramelessEmptyState
                  icon={Server}
                  title="尚未儲存任何伺服器"
                  description="進入遊戲內「多人遊戲」添加伺服器後，將自動同步於此。"
                />
              </motion.div>
            )}

            {/* 6. 實例設定分頁 (扁平無框設計) */}
            {activeSubTab === "settings" && (
              <motion.div
                key="settings"
                custom={tabDirection}
                variants={tabContentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-8"
              >
                {/* JVM 記憶體分配 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-[#52A43A]" />
                    <h3 className="text-sm font-bold text-white">JVM 記憶體分配</h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    建議依目前系統記憶體與 Mod 數量調校最大 Heap 記憶體大小。
                  </p>

                  <div className="pt-2 max-w-xl space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">最大分配記憶體 (Max Heap)</span>
                      <span className="font-bold font-mono text-[#52A43A]">{maxRam} MB</span>
                    </div>

                    <Slider
                      value={maxRam}
                      min={1024}
                      max={16384}
                      step={512}
                      onChange={handleRamChange}
                    />

                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>1024 MB</span>
                      <span>4096 MB (推薦)</span>
                      <span>8192 MB</span>
                      <span>16384 MB</span>
                    </div>
                  </div>
                </div>

                <div className="h-px w-full bg-white/5" />

                {/* Java 執行階段環境 */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-white">Java 執行階段環境</h3>
                  <p className="text-xs text-slate-400">
                    此 Minecraft 版本可選用偵測到之系統 JRE 或由啟動器依版本自動指派。
                  </p>

                  <div className="pt-1 max-w-xl space-y-2.5">
                    <Select value={selectedJavaPath} onValueChange={handleJavaChange}>
                      <SelectTrigger className="w-full h-9 bg-black/40 border-white/10 text-xs">
                        <SelectValue placeholder="選擇 Java 執行路徑..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default_mojang">
                          依版本自動指派 (Mojang JRE)
                        </SelectItem>
                        {systemJavas.map((j) => (
                          <SelectItem key={j.path} value={j.path}>
                            Java {j.major_version} ({j.vendor}) - {j.is_64_bit ? "64-bit" : "32-bit"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedJavaPath && selectedJavaPath !== "default_mojang" && (
                      <div className="rounded-xl border border-white/10 bg-black/30 p-2.5 text-[11px] font-mono text-slate-300 break-all">
                        {selectedJavaPath}
                      </div>
                    )}
                  </div>
                </div>

                <div className="h-px w-full bg-white/5" />

                {/* 實例複製與備份 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Copy className="h-4 w-4 text-[#52A43A]" />
                    <h3 className="text-sm font-bold text-white">實例複製 (CAS 去重)</h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    快速建立一份完全獨立的實例副本，共用檔案透過原生 Hardlink 去重以節省硬碟空間。
                  </p>
                  <div className="pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={openDuplicateModal}
                      className="gap-1.5 text-xs h-8 border-white/10 bg-white/5 hover:bg-white/10 text-slate-200"
                    >
                      <Copy className="h-3.5 w-3.5 text-[#52A43A]" />
                      <span>複製此實例...</span>
                    </Button>
                  </div>
                </div>

                <div className="h-px w-full bg-white/5" />

                {/* 控制台與即時日誌視窗設定 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-[#52A43A]" />
                    <h3 className="text-sm font-bold text-white">啟動日誌視窗</h3>
                  </div>
                  <p className="text-xs text-slate-400">
                    設定此實例在啟動時是否自動喚起即時輸出日誌視窗。
                  </p>

                  <div className="pt-1 max-w-xl">
                    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-4 text-xs">
                      <div>
                        <span className="font-semibold text-slate-200">啟動時顯示即時日誌視窗</span>
                        <p className="text-[11px] text-slate-400 mt-1">
                          關閉時，正常啟動保持隱藏靜默；若遊戲崩潰時仍會自動彈出日誌視窗。
                        </p>
                      </div>
                      <Switch
                        checked={showLogOnLaunch}
                        onCheckedChange={handleToggleShowLog}
                      />
                    </div>
                  </div>
                </div>

                <div className="h-px w-full bg-white/5" />

                {/* 危險區域 (Danger Zone) */}
                <div className="space-y-4 rounded-2xl border border-rose-500/20 bg-rose-950/10 p-5 max-w-xl">
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-rose-500" />
                    <h3 className="text-sm font-bold text-rose-300">危險區域 (Danger Zone)</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    刪除實例將永久移除該實例的所有獨立世界存檔、已安裝模組、設定檔與截圖。此操作無法復原。
                  </p>
                  <div className="pt-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setIsDeleteDialogOpen(true)}
                      className="gap-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs h-8 px-3.5 rounded-lg shadow-md shadow-rose-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>刪除此實例</span>
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {renameDialog}
        {duplicateDialog}
        {deleteDialog}
      </div>
    </ScrollArea>
  );
};

function PackItem({
  pack,
  icon: Icon,
}: {
  pack: PackFileInfo;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const effectiveBytes = pack.sizeBytes ?? pack.size ?? 0;
  const sizeMb = (effectiveBytes / (1024 * 1024)).toFixed(2);
  const sizeStr =
    effectiveBytes > 1024 * 1024 ? `${sizeMb} MB` : `${(effectiveBytes / 1024).toFixed(1)} KB`;
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-[#52A43A]">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">{pack.filename}</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-white/10 text-slate-300">
              {sizeStr}
            </Badge>
          </div>
          {pack.description && (
            <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{pack.description}</p>
          )}
        </div>
      </div>
      <div className="text-[11px] text-slate-500 font-mono">
        {pack.modified ? new Date(pack.modified * 1000).toLocaleDateString("zh-TW") : "本機套件"}
      </div>
    </div>
  );
}

function ModItem({
  name,
  version,
  desc,
  enabled,
  onToggle,
}: {
  name: string;
  version: string;
  desc: string;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">{name}</span>
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-white/10 text-slate-300">
            {version}
          </Badge>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5">{desc}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] text-slate-400 font-medium">
          {enabled ? "已啟用" : "已停用"}
        </span>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
    </div>
  );
}
