import React from "react";
import { Search, Plus, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HomeSubNav,
  MainView,
  NewsSubNav,
  SettingsSubNav,
} from "@/types/navigation";
import { useI18n } from "@/i18n";
import { SlidingIndicator, useSlidingIndicator } from "@/components/ui/sliding-indicator";

interface DynamicTitlebarProps {
  currentView: MainView;
  newsNav: NewsSubNav;
  onNewsNavChange: (nav: NewsSubNav) => void;
  homeNav: HomeSubNav;
  onHomeNavChange: (nav: HomeSubNav) => void;
  settingsNav?: SettingsSubNav;
  onSettingsNavChange?: (nav: SettingsSubNav) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreateInstance: () => void;
  onImportInstance?: () => void;
}

export const DynamicTitlebar: React.FC<DynamicTitlebarProps> = ({
  currentView,
  newsNav,
  onNewsNavChange,
  homeNav,
  onHomeNavChange,
  settingsNav = "general",
  onSettingsNavChange,
  searchQuery,
  onSearchChange,
  onCreateInstance,
  onImportInstance,
}) => {
  const { t } = useI18n();
  // 個別實例 (instance-detail) 依規格明確沒有 Titlebar!
  if (currentView === "instance-detail") {
    return null;
  }

  return (
    <div className="relative z-10 flex h-14 w-full shrink-0 select-none items-center justify-between border-b border-white/10 bg-slate-900/40 px-6 backdrop-blur-md">
      {/* 1. 新聞快訊：Title(靠左) + Navbar(靠右) */}
      {currentView === "news" && (
        <>
          <h2 className="text-lg font-bold tracking-tight text-slate-100">
            {t.shell.newsFlash}
          </h2>
          <SubNav
            active={newsNav}
            onChange={onNewsNavChange}
            items={[
              { id: "official", label: t.shell.officialNews },
              { id: "changelog", label: t.shell.javaChangelog },
              { id: "announcements", label: t.shell.launcherAnnouncements },
            ]}
          />
        </>
      )}

      {/* 2. 首頁：Navbar(置中) */}
      {currentView === "home" && (
        <div className="flex w-full items-center justify-center">
          <SubNav
            active={homeNav}
            onChange={onHomeNavChange}
            items={[
              { id: "overview", label: t.shell.homeOverview },
              { id: "p2p", label: t.shell.p2p },
            ]}
          />
        </div>
      )}

      {/* 3. 實例總覽：Title(靠左) + Searchbar(置中) + Button(靠右) */}
      {currentView === "instances" && (
        <>
          <h2 className="text-lg font-bold tracking-tight text-slate-100 shrink-0">
            {t.shell.instanceOverview}
          </h2>

          <div className="flex flex-1 items-center justify-center px-6 max-w-md mx-auto">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 z-10 pointer-events-none" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t.shell.searchInstances}
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
              <FolderDown className="h-3.5 w-3.5 text-brand-light" />
              <span>{t.shell.importInstance}</span>
            </Button>
            <Button
              size="sm"
              onClick={onCreateInstance}
              className="gap-1.5 text-xs h-8 rounded-lg bg-brand hover:bg-brand-hover text-on-solid shadow-sm shadow-brand/25"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.shell.createInstance}</span>
            </Button>
          </div>
        </>
      )}

      {/* 5. 全域設定：Title(靠左) */}
      {currentView === "settings" && (
        <>
          <h2 className="text-lg font-bold tracking-tight text-slate-100">
            {t.shell.globalSettings}
          </h2>
          <SubNav
            active={settingsNav}
            onChange={(nav) => onSettingsNavChange?.(nav)}
            items={[
              { id: "general", label: t.shell.settingsGeneral },
              { id: "privacy", label: t.shell.settingsPrivacy },
            ]}
          />
        </>
      )}
    </div>
  );
};

/** Tab strip with a sliding indicator (see `useSlidingIndicator` for why it avoids `layoutId`). */
function SubNav<T extends string>({
  items,
  active,
  onChange,
}: {
  items: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  const pill = useSlidingIndicator(active);
  return (
    <div className="relative flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
      <SlidingIndicator box={pill.box} className="top-1 bottom-1 rounded-lg bg-brand shadow-sm shadow-brand/30" />
      {items.map((item) => (
        <button
          key={item.id}
          ref={pill.register(item.id)}
          type="button"
          onClick={() => onChange(item.id)}
          className={`relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            active === item.id ? "text-on-solid" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
