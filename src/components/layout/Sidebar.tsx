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
  Settings
} from "lucide-react";
import { motion } from "motion/react";
import { AccountDropdown } from "./AccountDropdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MainView,
  MinecraftInstance,
  UserAccount,
} from "@/types/navigation";

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
  isDark: boolean;
  onToggleTheme: () => void;
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
}) => {
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
        className="absolute left-0 w-1 rounded-r-full bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.7)] z-30 pointer-events-none"
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
          onSignOut={onSignOut}
        />
      </div>

      {/* 2. 上方固定主要導覽區 (固定不滾動) */}
      <div className="shrink-0 pt-3 pb-1 space-y-1">
        <SidebarNavItem
          id="nav-item-news"
          icon={<Newspaper className="h-4 w-4" />}
          label="新聞快訊"
          active={currentView === "news"}
          onClick={() => onNavigate("news")}
        />

        <SidebarNavItem
          id="nav-item-home"
          icon={<Home className="h-4 w-4" />}
          label="首頁"
          active={currentView === "home"}
          onClick={() => onNavigate("home")}
        />

        <SidebarNavItem
          id="nav-item-instances"
          icon={<LayoutGrid className="h-4 w-4" />}
          label="實例總覽"
          active={currentView === "instances"}
          onClick={() => onNavigate("instances")}
        />
      </div>

      {/* 3. 實例列表標籤 (純文字 Label，非按鈕，水平對齊 20px) */}
      <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-1.5 text-xs font-bold text-slate-300">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-[#52A43A]" />
          <span>實例列表</span>
        </div>
        <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] text-slate-400 font-mono font-medium">
          {instances.length}
        </span>
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
        {instances.map((inst) => {
          const isSelected =
            currentView === "instance-detail" &&
            selectedInstanceId === inst.id;

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
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/5 active:bg-white/10 ${isSelected
                  ? "bg-white/10 text-slate-100 font-semibold"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Box
                    className={`h-3.5 w-3.5 shrink-0 transition-colors ${isSelected ? "text-[#52A43A]" : "text-slate-500"
                      }`}
                  />
                  <span className="truncate">{inst.name}</span>
                </div>
                <span
                  className={`text-[10px] rounded px-1.5 py-0.2 shrink-0 font-mono ${isSelected
                    ? "bg-[#3C8527]/25 text-[#52A43A] font-medium"
                    : "bg-white/5 text-slate-500"
                    }`}
                >
                  {inst.version}
                </span>
              </button>
            </div>
          );
        })}
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
                currentView === "settings" ? "text-[#52A43A]" : "text-slate-400"
              }
            >
              <Settings className="h-4 w-4" />
            </span>
            <span>全域設定</span>
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
        <span className={active ? "text-[#52A43A]" : "text-slate-400"}>
          {icon}
        </span>
        <span>{label}</span>
      </button>
    </div>
  );
}
