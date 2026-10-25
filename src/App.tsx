import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { WindowBar } from "@/components/layout/WindowBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { DynamicTitlebar } from "@/components/layout/DynamicTitlebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { NewsView } from "@/views/NewsView";
import { HomeView } from "@/views/HomeView";
import { InstancesView } from "@/views/InstancesView";
import { InstanceDetailView } from "@/views/InstanceDetailView";
import { SettingsView } from "@/views/SettingsView";
import {
  HomeSubNav,
  MainView,
  MinecraftInstance,
  NewsSubNav,
  UserAccount,
} from "@/types/navigation";

// 垂直頁面層級空間索引映射，用於雙向物理位移動畫
const VIEW_INDEX: Record<MainView, number> = {
  news: 0,
  home: 1,
  instances: 2,
  "instance-detail": 3,
  settings: 4,
};

// Initial mock data conforming to specifications (Launcher Version 26.1.0)
const INITIAL_INSTANCES: MinecraftInstance[] = [
  {
    id: "inst-1",
    name: "Vanilla 1.21.4",
    version: "1.21.4",
    loader: "Vanilla",
    modCount: 0,
    lastPlayed: "今天 10:20",
    isFavorite: true,
  },
  {
    id: "inst-2",
    name: "Fabric 生存探險",
    version: "1.21.4",
    loader: "Fabric",
    modCount: 12,
    lastPlayed: "昨天 21:45",
  },
  {
    id: "inst-3",
    name: "NeoForge 工業包",
    version: "1.20.4",
    loader: "NeoForge",
    modCount: 48,
    lastPlayed: "3 天前",
  },
];

const INITIAL_ACCOUNTS: UserAccount[] = [
  {
    id: "acc-1",
    username: "Steve",
    accountType: "microsoft",
    isReady: true,
    isActive: true,
  },
  {
    id: "acc-2",
    username: "Alex_Offline",
    accountType: "offline",
    isReady: true,
    isActive: false,
  },
];

export default function App() {
  const [currentView, setCurrentView] = useState<MainView>("home");
  const [viewDirection, setViewDirection] = useState<number>(1);
  const [newsNav, setNewsNav] = useState<NewsSubNav>("official");
  const [homeNav, setHomeNav] = useState<HomeSubNav>("overview");
  const [instances, setInstances] = useState<MinecraftInstance[]>(INITIAL_INSTANCES);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("inst-1");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Account states
  const [accounts, setAccounts] = useState<UserAccount[]>(INITIAL_ACCOUNTS);
  const [activeAccountId, setActiveAccountId] = useState<string>("acc-1");

  // Skin manager modal state
  const [isSkinModalOpen, setIsSkinModalOpen] = useState<boolean>(false);

  // Theme state
  const [isDark, setIsDark] = useState<boolean>(true);

  const activeAccount =
    accounts.find((a) => a.id === activeAccountId) || accounts[0];

  const activeInstance =
    instances.find((i) => i.id === selectedInstanceId) || instances[0];

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (!isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleNavigate = (newView: MainView) => {
    if (newView === currentView) return;
    const dir = VIEW_INDEX[newView] > VIEW_INDEX[currentView] ? 1 : -1;
    setViewDirection(dir);
    setCurrentView(newView);
  };

  const handleSelectInstance = (instanceId: string) => {
    setSelectedInstanceId(instanceId);
    if (currentView !== "instance-detail") {
      const dir =
        VIEW_INDEX["instance-detail"] > VIEW_INDEX[currentView] ? 1 : -1;
      setViewDirection(dir);
      setCurrentView("instance-detail");
    }
  };

  const handleSelectAccount = (id: string) => {
    setActiveAccountId(id);
    setAccounts((prev) =>
      prev.map((acc) => ({
        ...acc,
        isActive: acc.id === id,
      }))
    );
  };

  const handleAddAccount = () => {
    const newUsername = `Player_${Math.floor(1000 + Math.random() * 9000)}`;
    const newAcc: UserAccount = {
      id: `acc-${Date.now()}`,
      username: newUsername,
      accountType: "microsoft",
      isReady: true,
      isActive: false,
    };
    setAccounts((prev) => [...prev, newAcc]);
  };

  const handleSignOut = (id: string) => {
    if (accounts.length <= 1) return;
    const remaining = accounts.filter((a) => a.id !== id);
    setAccounts(remaining);
    if (activeAccountId === id) {
      setActiveAccountId(remaining[0].id);
    }
  };

  const handleCreateInstance = () => {
    const newId = `inst-${Date.now()}`;
    const newInst: MinecraftInstance = {
      id: newId,
      name: `新實例 ${instances.length + 1}`,
      version: "1.21.4",
      loader: "Fabric",
      modCount: 0,
      lastPlayed: "尚未遊玩",
    };
    setInstances((prev) => [...prev, newInst]);
    setSelectedInstanceId(newId);
    const dir = VIEW_INDEX["instance-detail"] > VIEW_INDEX[currentView] ? 1 : -1;
    setViewDirection(dir);
    setCurrentView("instance-detail");
  };

  const handleCreateGroup = () => {
    // Group creation stub
  };

  // 主頁面雙向物理垂直運動變體
  const pageVariants = {
    initial: (dir: number) => ({
      opacity: 0,
      y: dir * 24,
    }),
    animate: {
      opacity: 1,
      y: 0,
      transition: {
        type: "spring" as const,
        stiffness: 450,
        damping: 35,
        mass: 0.8,
      },
    },
    exit: (dir: number) => ({
      opacity: 0,
      y: -dir * 24,
      transition: {
        duration: 0.15,
      },
    }),
  };

  return (
    <div
      className={`relative flex h-screen w-screen flex-col overflow-hidden select-none transition-colors duration-300 ${
        isDark ? "dark bg-[#0a0f1d] text-slate-100" : "bg-[#f4f6fb] text-slate-900"
      }`}
    >
      {/* 1. Global WindowBar (Tauri Managed) */}
      <WindowBar />

      {/* 2. Main Window Body (Sidebar + Content) */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Background Ambient Glow (Focusite Emerald & Grass Green) */}
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <div className="absolute -top-[15%] -left-[10%] h-[450px] w-[450px] rounded-full bg-[#3C8527]/15 blur-[130px]" />
          <div className="absolute -bottom-[15%] -right-[10%] h-[450px] w-[450px] rounded-full bg-[#2E6B1D]/20 blur-[130px]" />
        </div>

        {/* Sidebar */}
        <Sidebar
          currentView={currentView}
          onNavigate={handleNavigate}
          instances={instances}
          selectedInstanceId={selectedInstanceId}
          onSelectInstance={handleSelectInstance}
          accounts={accounts}
          activeAccount={activeAccount}
          onSelectAccount={handleSelectAccount}
          onAddAccount={handleAddAccount}
          onOpenSkinManager={() => setIsSkinModalOpen(true)}
          onSignOut={handleSignOut}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />

        {/* Right Content Area:
            Titlebar 完全整合進主頁面畫布，與內容同享雙向物理動態 (AnimatePresence)
        */}
        <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 min-h-0 overflow-hidden relative">
            <AnimatePresence mode="wait" custom={viewDirection}>
              {currentView === "news" && (
                <motion.div
                  key="news"
                  custom={viewDirection}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex h-full w-full flex-col overflow-hidden"
                >
                  <DynamicTitlebar
                    currentView="news"
                    newsNav={newsNav}
                    onNewsNavChange={setNewsNav}
                    homeNav={homeNav}
                    onHomeNavChange={setHomeNav}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onCreateInstance={handleCreateInstance}
                    onCreateGroup={handleCreateGroup}
                  />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <NewsView subNav={newsNav} />
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "home" && (
                <motion.div
                  key="home"
                  custom={viewDirection}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex h-full w-full flex-col overflow-hidden"
                >
                  <DynamicTitlebar
                    currentView="home"
                    newsNav={newsNav}
                    onNewsNavChange={setNewsNav}
                    homeNav={homeNav}
                    onHomeNavChange={setHomeNav}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onCreateInstance={handleCreateInstance}
                    onCreateGroup={handleCreateGroup}
                  />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <HomeView
                      subNav={homeNav}
                      activeInstance={activeInstance}
                    />
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "instances" && (
                <motion.div
                  key="instances"
                  custom={viewDirection}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex h-full w-full flex-col overflow-hidden"
                >
                  <DynamicTitlebar
                    currentView="instances"
                    newsNav={newsNav}
                    onNewsNavChange={setNewsNav}
                    homeNav={homeNav}
                    onHomeNavChange={setHomeNav}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onCreateInstance={handleCreateInstance}
                    onCreateGroup={handleCreateGroup}
                  />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <InstancesView
                      instances={instances}
                      searchQuery={searchQuery}
                      onSelectInstance={(id) => {
                        setSelectedInstanceId(id);
                        const dir =
                          VIEW_INDEX["instance-detail"] > VIEW_INDEX["instances"]
                            ? 1
                            : -1;
                        setViewDirection(dir);
                        setCurrentView("instance-detail");
                      }}
                      onLaunchInstance={(id) => {
                        setSelectedInstanceId(id);
                        const dir =
                          VIEW_INDEX["home"] > VIEW_INDEX["instances"]
                            ? 1
                            : -1;
                        setViewDirection(dir);
                        setCurrentView("home");
                      }}
                    />
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "instance-detail" && (
                <motion.div
                  key={`instance-detail-${selectedInstanceId}`}
                  custom={viewDirection}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex h-full w-full flex-col overflow-hidden"
                >
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-0"
                  >
                    <InstanceDetailView
                      instance={activeInstance}
                      onLaunch={() => handleNavigate("home")}
                    />
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "settings" && (
                <motion.div
                  key="settings"
                  custom={viewDirection}
                  variants={pageVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex h-full w-full flex-col overflow-hidden"
                >
                  <DynamicTitlebar
                    currentView="settings"
                    newsNav={newsNav}
                    onNewsNavChange={setNewsNav}
                    homeNav={homeNav}
                    onHomeNavChange={setHomeNav}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onCreateInstance={handleCreateInstance}
                    onCreateGroup={handleCreateGroup}
                  />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <SettingsView />
                  </ScrollArea>
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>
      </div>

      {/* Skin & Cape Management Modal with Shadcn Dialog + Motion */}
      <Dialog open={isSkinModalOpen} onOpenChange={setIsSkinModalOpen}>
        <DialogContent onClose={() => setIsSkinModalOpen(false)}>
          <DialogHeader>
            <DialogTitle>外觀與披風管理</DialogTitle>
            <DialogDescription>
              玩家 <span className="font-semibold text-[#52A43A]">{activeAccount.username}</span> 的外觀皮膚自訂中心。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-8 rounded-xl border border-dashed border-white/10 bg-black/20 text-xs text-muted-foreground">
            拖曳 .png 皮膚檔案至此，或點擊瀏覽匯入
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSkinModalOpen(false)}
            >
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
