import React from "react";
import { Search, Plus, FolderDown } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HomeSubNav,
  MainView,
  NewsSubNav,
} from "@/types/navigation";

interface DynamicTitlebarProps {
  currentView: MainView;
  newsNav: NewsSubNav;
  onNewsNavChange: (nav: NewsSubNav) => void;
  homeNav: HomeSubNav;
  onHomeNavChange: (nav: HomeSubNav) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreateInstance: () => void;
  onImportInstance?: () => void;
  onCreateGroup?: () => void;
}

export const DynamicTitlebar: React.FC<DynamicTitlebarProps> = ({
  currentView,
  newsNav,
  onNewsNavChange,
  homeNav,
  onHomeNavChange,
  searchQuery,
  onSearchChange,
  onCreateInstance,
  onImportInstance,
}) => {
  // 個別實例 (instance-detail) 依規格明確沒有 Titlebar!
  if (currentView === "instance-detail") {
    return null;
  }

  return (
    <div className="relative z-10 flex h-14 w-full shrink-0 select-none items-center justify-between border-b border-white/10 bg-slate-900/40 px-6 backdrop-blur-md">
      {/* 1. 新聞快訊：Title(靠左) + Navbar(靠右)；使用獨立作用域 layoutId="news-subnav-indicator" */}
      {currentView === "news" && (
        <>
          <h2 className="text-lg font-bold tracking-tight text-slate-100">
            新聞快訊
          </h2>
          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
            <TitlebarTabButton
              active={newsNav === "official"}
              layoutId="news-subnav-indicator"
              onClick={() => onNewsNavChange("official")}
            >
              官方新聞
            </TitlebarTabButton>
            <TitlebarTabButton
              active={newsNav === "changelog"}
              layoutId="news-subnav-indicator"
              onClick={() => onNewsNavChange("changelog")}
            >
              Java版更改日誌
            </TitlebarTabButton>
            <TitlebarTabButton
              active={newsNav === "announcements"}
              layoutId="news-subnav-indicator"
              onClick={() => onNewsNavChange("announcements")}
            >
              啟動器快訊
            </TitlebarTabButton>
          </div>
        </>
      )}

      {/* 2. 首頁：Navbar(置中)；使用獨立作用域 layoutId="home-subnav-indicator" */}
      {currentView === "home" && (
        <div className="flex w-full items-center justify-center">
          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
            <TitlebarTabButton
              active={homeNav === "overview"}
              layoutId="home-subnav-indicator"
              onClick={() => onHomeNavChange("overview")}
            >
              主頁總覽
            </TitlebarTabButton>
            <TitlebarTabButton
              active={homeNav === "p2p"}
              layoutId="home-subnav-indicator"
              onClick={() => onHomeNavChange("p2p")}
            >
              P2P好友共遊
            </TitlebarTabButton>
          </div>
        </div>
      )}

      {/* 3. 實例總覽：Title(靠左) + Searchbar(置中) + Button(靠右) */}
      {currentView === "instances" && (
        <>
          <h2 className="text-lg font-bold tracking-tight text-slate-100 shrink-0">
            實例總覽
          </h2>

          <div className="flex flex-1 items-center justify-center px-6 max-w-md mx-auto">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 z-10 pointer-events-none" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="搜尋實例名稱、版本或加載器..."
                className="pl-9 h-8 rounded-xl"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={onImportInstance}
              className="gap-1.5 text-xs h-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
            >
              <FolderDown className="h-3.5 w-3.5 text-[#52A43A]" />
              <span>導入實例</span>
            </Button>
            <Button
              size="sm"
              onClick={onCreateInstance}
              className="gap-1.5 text-xs h-8 rounded-lg bg-[#3C8527] hover:bg-[#469C2D] text-white shadow-sm shadow-[#3C8527]/25"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>建立實例</span>
            </Button>
          </div>
        </>
      )}

      {/* 5. 全域設定：Title(靠左) */}
      {currentView === "settings" && (
        <h2 className="text-lg font-bold tracking-tight text-slate-100">
          全域設定
        </h2>
      )}
    </div>
  );
};

function TitlebarTabButton({
  active,
  layoutId,
  onClick,
  children,
}: {
  active: boolean;
  layoutId: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "text-white" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {active && (
        <motion.div
          layoutId={layoutId}
          className="absolute inset-0 rounded-lg bg-[#3C8527] shadow-sm shadow-[#3C8527]/30"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  );
}
