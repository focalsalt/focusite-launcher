import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Newspaper,
  Home,
  LayoutGrid,
  Boxes,
  Box,
  AlertTriangle,
  Settings,
  Plus,
  FolderDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { AccountDropdown } from "./AccountDropdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent, Tip } from "@/components/ui/tooltip";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import {
  MainView,
  MinecraftInstance,
  RunningInstanceInfo,
  UserAccount,
} from "@/types/navigation";
import { toAssetSrc } from "@/lib/assetUrl";
import {
  preloadCreateInstanceDialog,
  preloadImportModpackDialog,
} from "@/lib/startupOrchestrator";
import { sortForSidebar } from "@/lib/instanceOrder";
import { useI18n } from "@/i18n";

interface SidebarProps {
  currentView: MainView;
  onNavigate: (view: MainView) => void;
  instances: MinecraftInstance[];
  selectedInstanceId: string;
  onSelectInstance: (instanceId: string) => void;
  accounts: UserAccount[];
  activeAccount: UserAccount;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onOpenSkinManager: () => void;
  onSignOut: (accountId: string) => void;
  onCreateInstance?: () => void;
  onImportInstance?: () => void;
  runningInstances?: Record<string, RunningInstanceInfo>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  instances,
  selectedInstanceId,
  onSelectInstance,
  accounts,
  activeAccount,
  onSelectAccount,
  onAddAccount,
  onOpenSkinManager,
  onSignOut,
  onCreateInstance,
  onImportInstance,
  runningInstances = {},
}) => {
  const { t } = useI18n();
  const asideRef = useRef<HTMLElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 指示器位置與捲動狀態
  const [indicator, setIndicator] = useState<{
    top: number;
    height: number;
    visible: boolean;
  }>({
    top: 0,
    height: 28,
    visible: false,
  });
  const [isScrolling, setIsScrolling] = useState<boolean>(false);

  // 計算目前活躍之導覽鍵
  const activeKey =
    currentView === "instance-detail"
      ? `inst-${selectedInstanceId}`
      : currentView;

  // 動態更新膠囊位置：點擊切換時 Spring 滑動，列表捲動時 0ms 即時鎖定
  const updateIndicator = (immediate = false) => {
    if (!asideRef.current) return;
    const activeEl = document.getElementById(`nav-item-${activeKey}`);
    if (!activeEl) {
      setIndicator((prev) => ({ ...prev, visible: false }));
      return;
    }

    const asideRect = asideRef.current.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();

    // 若當前選取的項目為實例列表，檢查是否處於可視範圍內
    if (activeKey.startsWith("inst-") && scrollViewportRef.current) {
      const scrollRect = scrollViewportRef.current.getBoundingClientRect();
      if (
        itemRect.bottom < scrollRect.top + 4 ||
        itemRect.top > scrollRect.bottom - 4
      ) {
        setIndicator((prev) => ({ ...prev, visible: false }));
        return;
      }
    }

    if (immediate) {
      setIsScrolling(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 120);
    }

    setIndicator({
      top: itemRect.top - asideRect.top + 6,
      height: itemRect.height - 12,
      visible: true,
    });
  };

  useLayoutEffect(() => {
    updateIndicator(false);
  }, [activeKey, instances]);

  useEffect(() => {
    const handleResize = () => updateIndicator(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeKey]);

  return (
    <aside
      ref={asideRef}
      className="relative z-20 flex h-full w-64 flex-col overflow-hidden border-r border-white/10 bg-slate-950/80 backdrop-blur-xl select-none"
    >
      {/* 全局無裁切膠囊指示器：座落於 aside 根層級，在頂部項目、實例列表與全域設定間切換時永不遭容器溢出裁切 */}
      <motion.div
        className="absolute left-0 w-1 rounded-r-full bg-brand-light shadow-[0_0_8px_color-mix(in_srgb,var(--fc-highlight)_70%,transparent)] z-30 pointer-events-none"
        initial={false}
        animate={{
          top: indicator.top,
          height: indicator.height,
          opacity: indicator.visible ? 1 : 0,
        }}
        transition={
          isScrolling
            ? { duration: 0 }
            : { type: "spring", stiffness: 500, damping: 38 }
        }
      />

      {/* 1. Account 頂部區域：高度與 Titlebar (56px / h-14) 一致並填滿整欄 */}
      <div className="h-14 shrink-0 w-full border-b border-white/10">
        <AccountDropdown
          accounts={accounts}
          activeAccount={activeAccount}
          onSelectAccount={onSelectAccount}
          onAddAccount={onAddAccount}
          onOpenSkinManager={onOpenSkinManager}
          onSignOut={onSignOut}        />
      </div>

      {/* 2. 上方固定主要導覽區 (固定不滾動) */}
      <div className="shrink-0 pt-3 pb-1 space-y-1">
        <SidebarNavItem
          id="nav-item-news"
          icon={<Newspaper className="h-4 w-4" />}
          label={t.shell.newsFlash}
          active={currentView === "news"}
          onClick={() => onNavigate("news")}
        />

        <SidebarNavItem
          id="nav-item-home"
          icon={<Home className="h-4 w-4" />}
          label={t.shell.home}
          active={currentView === "home"}
          onClick={() => onNavigate("home")}
        />

        <SidebarNavItem
          id="nav-item-instances"
          icon={<LayoutGrid className="h-4 w-4" />}
          label={t.shell.instanceOverview}
          active={currentView === "instances"}
          onClick={() => onNavigate("instances")}
        />
      </div>

      {/* 3. 實例列表標籤 (純文字 Label，非按鈕，水平對齊 20px) */}
      <div id="nav-instance-list" className="shrink-0 flex items-center justify-between px-5 pt-4 pb-1.5 text-xs font-bold text-slate-300">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-brand-light" />
          <span>{t.shell.instanceList}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseEnter={preloadImportModpackDialog}
                onClick={onImportInstance}
                aria-label={t.shell.importInstance}
                className="flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
              >
                <FolderDown className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t.shell.importInstance}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseEnter={preloadCreateInstanceDialog}
                onClick={onCreateInstance}
                aria-label={t.shell.createNewInstance}
                className="flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t.shell.createNewInstance}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* 4. 僅實例列表可滾動的 ScrollArea：
          - 隱藏原生捲動條 (0px 位移) + 自訂 Overlay Thumb
          - onScroll 即時更新膠囊位置 (0ms 延遲隨動)
      */}
      <ScrollArea
        className="flex-1 min-h-0 w-full"
        viewportRef={scrollViewportRef}
        onScroll={() => updateIndicator(true)}
        viewportClassName="space-y-0.5"
      >
        {instances.length === 0 ? (
          <div className="px-5 py-6 text-center space-y-1">
            <p className="text-2xs text-slate-400">{t.shell.noInstances}</p>
          </div>
        ) : (
          sortForSidebar(instances).map((inst) => {
            const isSelected =
              currentView === "instance-detail" &&
              selectedInstanceId === inst.id;

            const runningInfo = runningInstances[inst.id];

            return (
              <div
                key={inst.id}
                id={`nav-item-inst-${inst.id}`}
                className="relative w-full px-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectInstance(inst.id);
                    onNavigate("instance-detail");
                  }}
                  className={`flex h-[52px] w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/5 active:bg-white/10 ${isSelected
                    ? "bg-white/10 text-slate-100 font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  <div className="relative shrink-0">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg overflow-hidden text-brand-light ${
                      inst.hasIcon && inst.iconPath ? "" : "border border-white/10 bg-white/5"
                    }`}>
                      {inst.hasIcon && inst.iconPath ? (
                        <img
                          src={toAssetSrc(inst.iconPath, inst.iconUpdatedAt)}
                          alt={inst.name}
                          className="h-full w-full object-cover"
                        />
                      ) : inst.needsSetup ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-warning-400" />
                      ) : (
                        <Box
                          className={`h-4 w-4 shrink-0 transition-colors ${isSelected ? "text-brand-light" : "text-slate-400"
                            }`}
                        />
                      )}
                    </div>
                    {/* 運行中玩家頭像 (絕對定位於圖示右下角，Spring 平滑進入與淡出) */}
                    <AnimatePresence>
                      {runningInfo && (
                        <motion.div
                          key={`avatar-${inst.id}`}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="absolute -bottom-1 -right-1 z-10 flex h-4 w-4 items-center justify-center rounded-md border border-slate-900 bg-slate-800 shadow-md overflow-hidden ring-1 ring-brand-light"
                        >
                          <Tip label={t.shell.runningAs(runningInfo.accountName || t.shell.player)} className="h-full w-full">
                            <span className="flex h-full w-full items-center justify-center">
                              {runningInfo.accountName && (
                                <PlayerAvatar username={runningInfo.accountName} size={16} className="rounded-none" />
                              )}
                            </span>
                          </Tip>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex flex-1 min-w-0 flex-col justify-center">
                    <span className="truncate text-xs font-semibold text-slate-200 leading-snug">
                      {inst.name}
                    </span>
                    <span className="truncate text-3xs text-slate-400 font-mono mt-0.5">
                      {inst.needsSetup ? t.common.unknown : `${inst.loader} · ${inst.version}`}
                    </span>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </ScrollArea>

      {/* 5. 全域設定 (固定在 Sidebar 最下方，永遠不被擠出視窗外) */}
      <div className="shrink-0 border-t border-white/10 py-2 bg-slate-950">
        <div id="nav-item-settings" className="relative w-full px-2">
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/5 active:bg-white/10 ${currentView === "settings"
              ? "bg-white/10 text-slate-100"
              : "text-slate-400 hover:text-slate-200"
              }`}
          >
            <span
              className={
                currentView === "settings" ? "text-brand-light" : "text-slate-400"
              }
            >
              <Settings className="h-4 w-4" />
            </span>
            <span>{t.shell.globalSettings}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

function SidebarNavItem({
  id,
  icon,
  label,
  active,
  onClick,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div id={id} className="relative w-full px-2">
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/5 active:bg-white/10 ${active ? "bg-white/10 text-slate-100" : "text-slate-400 hover:text-slate-200"
          }`}
      >
        <span className={active ? "text-brand-light" : "text-slate-400"}>
          {icon}
        </span>
        <span>{label}</span>
      </button>
    </div>
  );
}
