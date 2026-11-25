import { useInstanceFiles } from "@/lib/useInstanceFiles";
import { TabSkeleton } from "@/components/instance/detail/shared";
import { InstanceSetupPanel } from "@/components/instance/InstanceSetupPanel";
import { RenameInstanceDialog } from "@/components/instance/detail/RenameInstanceDialog";
import { DeleteInstanceDialog } from "@/components/instance/detail/DeleteInstanceDialog";
import { InstanceIconDialog } from "@/components/instance/detail/InstanceIconDialog";
import React, { useState, useEffect, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import {
  FolderOpen,
  Settings,
  Package,
  HardDrive,
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
  Terminal,
  PackageOpen,
} from "lucide-react";
import { ChangeVersionLoaderDialog } from "@/components/instance/ChangeVersionLoaderDialog";
import { ExportInstanceDialog } from "@/components/instance/ExportInstanceDialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toAssetSrc } from "@/lib/assetUrl";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ScreenshotsTab } from "@/components/instance/detail/ScreenshotsTab";
import { ModsTab } from "@/components/instance/detail/ModsTab";
import { PacksTab } from "@/components/instance/detail/PacksTab";
import { WorldsTab } from "@/components/instance/detail/WorldsTab";
import { ServersTab } from "@/components/instance/detail/ServersTab";
import { SettingsTab } from "@/components/instance/detail/SettingsTab";
import { InstanceDetailSubNav, MinecraftInstance, VersionCapabilities } from "@/types/navigation";
import {
  instanceService,
  ModFileInfo,
  JavaInstallationDto,
  ServerEntry,
} from "@/services/instanceService";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";
import { Tip } from "@/components/ui/tooltip";


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
  onLaunch: (id: string, quickPlayType?: "singleplayer" | "multiplayer", quickPlayTarget?: string) => void;
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
  const { t } = useI18n();
  const caps: VersionCapabilities = instance?.capabilities ?? {
    supportsNonVanillaLoaders: true,
    supportsShaderpacks: true,
    packFolderKind: "resourcepacks",
    modsTabMode: "modernsinglelist",
  };

  const [activeSubTab, setActiveSubTab] =
    useState<InstanceDetailSubNav>("screenshots");
  const [tabDirection, setTabDirection] = useState<number>(1);
  const tabLine = useSlidingIndicator(activeSubTab);
  const [resourceShaderTab, setResourceShaderTab] = useState<"packs" | "shaders">("packs");
  const [resourceShaderDir, setResourceShaderDir] = useState<number>(1);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [maxRam, setMaxRam] = useState<number>(instance?.maxMemoryMb ?? 4096);
  const [minRam, setMinRam] = useState<number>(instance?.minMemoryMb ?? 1024);
  const [systemJavas, setSystemJavas] = useState<JavaInstallationDto[]>([]);
  const [selectedJavaPath, setSelectedJavaPath] = useState<string>(instance?.javaPath ?? "");
  const [showLogOnLaunch, setShowLogOnLaunch] = useState<boolean>(
    instance?.showLogOnLaunch ?? false
  );

  const [isIconModalOpen, setIsIconModalOpen] = useState<boolean>(false);

  // 變更版本與 Loader 對話框狀態
  const [isChangeVersionOpen, setIsChangeVersionOpen] = useState<boolean>(false);

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

  const [isRenameOpen, setIsRenameOpen] = useState<boolean>(false);

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

  // 真實磁碟模組、核心模組、材質包、光影包、存檔與截圖：依實例快取，第二次開啟不再顯示 Skeleton
  const { files, isLoading: isLoadingFiles, refresh: refreshInstanceFiles, patch } = useInstanceFiles(instance);
  const { mods, coremods, resourcepacks, shaderpacks, worlds, servers, screenshots } = files;
  const setMods = (u: React.SetStateAction<ModFileInfo[]>) => patch("mods", u);
  const setCoremods = (u: React.SetStateAction<ModFileInfo[]>) => patch("coremods", u);
  const setServers: React.Dispatch<React.SetStateAction<ServerEntry[]>> = (u) => patch("servers", u);

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
  // The background lives in the instance folder; `bgVersion` busts the webview cache when it is replaced.
  const [bgVersion, setBgVersion] = useState<number>(0);
  const [bgLoadError, setBgLoadError] = useState<boolean>(false);
  const bgImage = toAssetSrc(instance?.backgroundPath, bgVersion || undefined) ?? DEFAULT_MC_BG;
  useEffect(() => setBgLoadError(false), [bgImage]);

  const handleSelectCustomBg = async () => {
    if (!instance) return;
    try {
      const selected = await openFileDialog({
        multiple: false,
        filters: [
          {
            name: t.inst.images,
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (selected && typeof selected === "string") {
        const updated = await instanceService.setInstanceBackground(instance.id, selected);
        setBgVersion(Date.now());
        onInstanceUpdated?.(updated);
      }
    } catch (err) {
      console.warn("選擇自訂背景失敗:", err);
      toast(toUserMessage(err), "error");
    }
  };

  const handleResetBg = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!instance) return;
    try {
      const updated = await instanceService.resetInstanceBackground(instance.id);
      setBgVersion(Date.now());
      onInstanceUpdated?.(updated);
    } catch (err) {
      toast(toUserMessage(err), "error");
    }
  };

  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);

  const navTabs = useMemo(() => {
    const list: { id: InstanceDetailSubNav; label: string; icon: React.ReactNode }[] = [];

    list.push({
      id: "screenshots",
      label: t.inst.tabScreenshots,
      icon: <Camera className="h-4 w-4" />,
    });

    if (caps.modsTabMode !== "hidden") {
      list.push({
        id: "mods",
        label: t.inst.tabMods,
        icon: <Package className="h-4 w-4" />,
      });
    }

    if (caps.packFolderKind !== "hidden") {
      const label = caps.packFolderKind !== "texturepacks" && caps.supportsShaderpacks ? t.inst.tabPacks : t.inst.tabResourcePacks;
      list.push({
        id: "resourcepacks",
        label,
        icon: <Palette className="h-4 w-4" />,
      });
    }

    list.push({
      id: "saves",
      label: t.inst.tabWorlds,
      icon: <HardDrive className="h-4 w-4" />,
    });

    list.push({
      id: "servers",
      label: t.inst.tabServers,
      icon: <Server className="h-4 w-4" />,
    });

    list.push({
      id: "settings",
      label: t.inst.tabSettings,
      icon: <Settings className="h-4 w-4" />,
    });

    return list;
  }, [caps.modsTabMode, caps.packFolderKind, caps.supportsShaderpacks, t]);

  useEffect(() => {
    if (navTabs.length > 0 && !navTabs.some((t) => t.id === activeSubTab)) {
      setActiveSubTab(navTabs[0].id);
    }
  }, [navTabs, activeSubTab]);


  // 空狀態：純淨水平垂直絕對居中，無卡片樣式
  if (!instance) {
    return (
      <div className="flex flex-1 h-full min-h-[500px] w-full flex-col items-center justify-center p-8 text-center select-none">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-400">
          <Layers className="h-7 w-7 text-slate-400" />
        </div>
        <div className="mt-4 space-y-1">
          <h3 className="text-base font-semibold text-white">{t.inst.noneSelected}</h3>
          <p className="text-xs text-slate-400">{t.inst.noneSelectedHint}</p>
        </div>
        {onGoToInstances && (
          <Button
            onClick={onGoToInstances}
            className="mt-5 bg-brand hover:bg-brand-light text-white text-xs font-semibold px-4 py-2"
          >
            {t.inst.backToList}
          </Button>
        )}
      </div>
    );
  }

  const listLoading = isLoadingFiles && ["mods", "resourcepacks", "saves"].includes(activeSubTab);

  // 1. 緊湊頂部 Hero 橫幅
  const heroSection = (
    <div className="group/hero relative w-full h-44 shrink-0 overflow-hidden border-b border-white/10 bg-slate-950">
      {/* 背景大圖與漸變遮罩 */}
      {!bgLoadError ? (
        <img
          src={bgImage}
          alt="Minecraft Official Artwork"
          onError={() => setBgLoadError(true)}
          className="absolute inset-0 h-full w-full object-cover object-center filter brightness-75"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand-dark via-canvas to-slate-950" />
      )}

      {/* 氛圍遮罩與暗部漸層以確保文字與按鈕清晰可讀 */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/50 to-slate-950/70" />
      <div className="pointer-events-none absolute bottom-0 left-6 h-28 w-80 rounded-full bg-brand/25 blur-3xl" />

      {/* 背景編輯：滑過橫幅時才顯示於左上角 */}
      <div className="absolute left-4 top-3 z-20 flex items-center gap-2 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/hero:opacity-100">
        <Tip label={t.inst.customBgAttr}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSelectCustomBg}
            className="gap-1.5 text-xs h-8 rounded-lg border-white/15 bg-black/50 backdrop-blur-md hover:bg-white/10 text-slate-200"
          >
            <ImageIcon className="h-3.5 w-3.5 text-slate-300" />
            <span>{t.inst.changeBg}</span>
          </Button>
        </Tip>
        {!!instance?.backgroundPath && (
          <Tip label={t.inst.resetBgAttr}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetBg}
              className="text-xs h-8 px-2.5 rounded-lg border-white/15 bg-black/50 backdrop-blur-md hover:bg-white/10 text-slate-300"
              aria-label={t.inst.resetBgAttr}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </Tip>
        )}
      </div>

      {/* Hero 內部下緣內容：實例資訊與操作按鈕群 */}
      <div className="relative z-10 flex h-full w-full items-end justify-between px-6 pb-4">
        {/* 左側實例圖示、名稱、版本 */}
        <div className="flex items-center gap-4">
          <Tip label={t.inst.changeIconAttr}>
            <div
              onClick={() => setIsIconModalOpen(true)}
              className="group relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-brand to-brand-dark text-white shadow-xl shadow-brand/30 border border-white/20 overflow-hidden cursor-pointer hover:border-brand-light/80 transition-all"
            >
              {instance.hasIcon && instance.iconPath ? (
                <img
                  src={toAssetSrc(instance.iconPath, instance.iconUpdatedAt)}
                  alt={instance.name}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <Package className="h-7 w-7 drop-shadow transition-transform group-hover:scale-105" />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Pencil className="h-4 w-4 text-white drop-shadow" />
              </div>
            </div>
          </Tip>

          <div className="space-y-1">
            <Tip label={t.inst.renameAttr}>
              <h1 className="text-xl font-black tracking-tight text-white drop-shadow-md">
                <button
                  type="button"
                  onClick={() => setIsRenameOpen(true)}
                  aria-label={t.inst.renameAttr}
                  className="-mx-1.5 rounded-md px-1.5 text-left transition-colors hover:bg-white/10"
                >
                  {instance.name}
                </button>
              </h1>
            </Tip>
            <div className="flex items-center gap-2">
              <p className="text-2xs text-slate-400 drop-shadow">
                Minecraft {instance.version} - {instance.loader}{instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}
                {instance.description && (
                  <span className="text-2xs text-slate-300 drop-shadow line-clamp-1">
                    ｜{instance.description}
                  </span>
                )}
              </p>
              <Tip label={t.inst.changeVersionAttr}>
                <button
                  type="button"
                  onClick={() => setIsChangeVersionOpen(true)}
                  className="text-3xs text-brand-light hover:text-brand-light/80 hover:underline flex items-center gap-1 font-medium bg-black/40 px-1.5 py-0.5 rounded border border-brand-light/30 transition-all"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  {t.inst.changeVersionBtn}
                </button>
              </Tip>
            </div>
          </div>
        </div>

        {/* 右側按鈕群：更換背景、開啟遊戲資料夾、立即啟動遊戲 */}
        <div className="flex items-center gap-2.5">
          <Tip label={t.inst.exportAttr}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsExportOpen(true)}
              disabled={isRunning || isLaunching}
              className="gap-1.5 text-xs h-8 rounded-lg border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-200"
            >
              <PackageOpen className="h-3.5 w-3.5 text-slate-300" />
              <span>{t.inst.export}</span>
            </Button>
          </Tip>

          <Tip label={t.inst.openLogAttr}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => instanceService.openInstanceLogWindow(instance.id).catch((err) => toast(toUserMessage(err), "error"))}
              className="gap-1.5 text-xs h-8 rounded-lg border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-200"
            >
              <Terminal className="h-3.5 w-3.5 text-slate-300" />
              <span>{t.inst.openLog}</span>
            </Button>
          </Tip>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => instanceService.openInstanceDirectory(instance.id, "minecraft")}
            className="gap-1.5 text-xs h-8 rounded-lg border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-200"
          >
            <FolderOpen className="h-3.5 w-3.5 text-slate-300" />
            <span>{t.inst.openGameFolder}</span>
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
                {t.common.forceStop(runningPid ?? 0)}
                {runningAccountName ? ` • ${runningAccountName}` : ""})
              </span>
            </Button>
          ) : isLaunching ? (
            <Button
              type="button"
              size="sm"
              disabled
              className="gap-2 bg-gradient-to-r from-brand to-brand-dark opacity-80 cursor-wait text-white font-bold px-4 h-8 rounded-lg shadow-lg"
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>{t.inst.launching}</span>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => onLaunch(instance.id)}
              className="gap-2 bg-gradient-to-r from-brand to-brand-dark hover:from-brand-hover hover:to-brand-dark text-white font-bold px-5 h-8 rounded-lg shadow-lg shadow-brand/30"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{t.inst.launchNow}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // 2. 六大子分頁導覽列 (吸頂黏附)
  const tabNavSection = (
    <div className="sticky top-0 z-30 w-full border-b border-white/10 bg-canvas/90 backdrop-blur-xl">
      <div className="relative flex items-center gap-1 px-6 py-1 overflow-x-auto">
        <SlidingIndicator box={tabLine.box} className="bottom-1 h-0.5 bg-brand-light shadow-[0_0_8px_color-mix(in_srgb,var(--fc-highlight)_80%,transparent)]" />
        {navTabs.map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={tabLine.register(tab.id)}
              type="button"
              onClick={() => handleSelectSubTab(tab.id)}
              className={`relative flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold transition-colors ${isActive
                ? "text-brand-light"
                : "text-slate-400 hover:text-slate-200"
                }`}
            >
              {tab.icon}
              <span>{tab.label}</span>

            </button>
          );
        })}
      </div>
    </div>
  );

  // A folder without our config must be set up before anything else on the page can work.
  if (instance.needsSetup) {
    return (
      <ScrollArea className="h-full w-full" viewportClassName="p-0">
        <InstanceSetupPanel
          instance={instance}
          onDone={(updated) => onInstanceUpdated?.(updated)}
          onBack={onGoToInstances}
        />
      </ScrollArea>
    );
  }

  // 六大子分頁：統一 ScrollArea，往下捲動時 Tab 列吸頂，所有子分頁共享 AnimatePresence 與物理方向
  // 遊戲截圖分頁是輪播，不使用 ScrollArea：整頁固定高度、內容裁切。
  // The wrapper stays the same element for every tab so switching tabs does not remount the page.
  const noScroll = activeSubTab === "screenshots";
  return (
    <ScrollArea
      className="h-full w-full"
      viewportClassName={noScroll ? "p-0 overflow-hidden" : "p-0"}
      fadeEdges={!noScroll}
    >
      <div className={`flex flex-col w-full select-none ${noScroll ? "h-full" : "min-h-full pb-12"}`}>
        {heroSection}
        {tabNavSection}

        {/* 子分頁無框扁平內容 (雙向水平物理動態轉場，完全移除外層卡片邊框) */}
        <div className={`relative w-full p-6 space-y-6 overflow-hidden ${noScroll ? "flex-1 min-h-0" : ""}`}>
          <AnimatePresence mode="popLayout" custom={tabDirection}>
            {listLoading && <TabSkeleton key="skeleton" />}
            {/* 1. 遊戲截圖分頁 */}
            {activeSubTab === "screenshots" && (
              <ScreenshotsTab key="screenshots" instance={instance} screenshots={screenshots} tabDirection={tabDirection} />
            )}
            {/* 2. 模組管理分頁 */}
            {!listLoading && activeSubTab === "mods" && caps.modsTabMode !== "hidden" && (
              <ModsTab key="mods" instance={instance} caps={caps} mods={mods} coremods={coremods} toggleMod={toggleMod} toggleCoremod={toggleCoremod} tabDirection={tabDirection} />
            )}

            {/* 3. 材質光影分頁 (根據版本自動適配 texturepacks / resourcepacks / shaderpacks) */}
            {!listLoading && activeSubTab === "resourcepacks" && caps.packFolderKind !== "hidden" && (
              <PacksTab key="resourcepacks" instance={instance} caps={caps} resourcepacks={resourcepacks} shaderpacks={shaderpacks} resourceShaderTab={resourceShaderTab} resourceShaderDir={resourceShaderDir} handleResourceShaderChange={handleResourceShaderChange} tabDirection={tabDirection} />
            )}

            {/* 4. 世界存檔分頁 */}
            {!listLoading && activeSubTab === "saves" && (
              <WorldsTab key="saves" instance={instance} worlds={worlds} onLaunch={onLaunch} isLaunching={isLaunching} isRunning={isRunning} refreshInstanceFiles={refreshInstanceFiles} tabDirection={tabDirection} />
            )}

            {/* 5. 多人伺服分頁 */}
            {activeSubTab === "servers" && (
              <ServersTab key="servers" instance={instance} servers={servers} setServers={setServers} onLaunch={onLaunch} isLaunching={isLaunching} isRunning={isRunning} tabDirection={tabDirection} />
            )}

            {/* 6. 實例設定分頁 (扁平無框設計) */}
            {activeSubTab === "settings" && (
              <SettingsTab key="settings" instance={instance} maxRam={maxRam} handleRamChange={handleRamChange} selectedJavaPath={selectedJavaPath} handleJavaChange={handleJavaChange} systemJavas={systemJavas} showLogOnLaunch={showLogOnLaunch} handleToggleShowLog={handleToggleShowLog} onInstanceUpdated={onInstanceUpdated} setIsDeleteDialogOpen={setIsDeleteDialogOpen} tabDirection={tabDirection} />
            )}
          </AnimatePresence>
        </div>

        <RenameInstanceDialog
          instance={instance}
          open={isRenameOpen}
          onOpenChange={setIsRenameOpen}
          onUpdated={onInstanceUpdated}
        />
        <DeleteInstanceDialog
          instance={instance}
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onDeleted={onGoToInstances}
        />
        <InstanceIconDialog
          instance={instance}
          open={isIconModalOpen}
          onOpenChange={setIsIconModalOpen}
          onUpdated={onInstanceUpdated}
        />
        <ChangeVersionLoaderDialog
          open={isChangeVersionOpen}
          onOpenChange={setIsChangeVersionOpen}
          instance={instance}
          onSuccess={async () => {
            const updated = await instanceService.getInstance(instance.id);
            if (updated && onInstanceUpdated) {
              onInstanceUpdated(updated);
            }
          }}
        />
        <ExportInstanceDialog
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          instanceId={instance.id}
          instanceName={instance.name}
        />

      </div>
    </ScrollArea>
  );
};
