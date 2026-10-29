import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { WindowBar } from "@/components/layout/WindowBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { DynamicTitlebar } from "@/components/layout/DynamicTitlebar";
import { MainBootOverlay } from "@/components/layout/MainBootOverlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HomeView } from "@/views/HomeView";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { ExitConfirmationDialog } from "@/components/layout/ExitConfirmationDialog";
import {
  HomeSubNav,
  MainView,
  MinecraftInstance,
  NewsSubNav,
  RunningInstanceInfo,
  UserAccount,
} from "@/types/navigation";
import { instanceService, InstanceStatusEvent } from "@/services/instanceService";
import { authService } from "@/services/authService";
import { closeWindow, exitApp, showMainWindow, hideWindow } from "@/lib/tauriWindow";
import { listen } from "@tauri-apps/api/event";
import {
  computeRemainingSplashDelay,
  runSequentialPrefetch,
  SECONDARY_2D_PREFETCH_TASKS,
} from "@/lib/startupOrchestrator";

// 路由級延遲載入非首屏視圖，分離 Three.js 3D 引擎與次要頁面 Bundle
const NewsView = lazy(() => import("@/views/NewsView").then((m) => ({ default: m.NewsView })));
const InstancesView = lazy(() => import("@/views/InstancesView").then((m) => ({ default: m.InstancesView })));
const InstanceDetailView = lazy(() => import("@/views/InstanceDetailView").then((m) => ({ default: m.InstanceDetailView })));
const SettingsView = lazy(() => import("@/views/SettingsView").then((m) => ({ default: m.SettingsView })));
const SkinManagerView = lazy(() => import("@/views/SkinManagerView").then((m) => ({ default: m.SkinManagerView })));
const LogWindow = lazy(() => import("@/views/LogWindow").then((m) => ({ default: m.LogWindow })));
const CreateInstanceDialog = lazy(() => import("@/components/instance/CreateInstanceDialog").then((m) => ({ default: m.CreateInstanceDialog })));
const ImportModpackDialog = lazy(() => import("@/components/instance/ImportModpackDialog").then((m) => ({ default: m.ImportModpackDialog })));
const MicrosoftLoginModal = lazy(() => import("@/components/auth/MicrosoftLoginModal").then((m) => ({ default: m.MicrosoftLoginModal })));

// 垂直頁面層級空間索引映射，用於雙向物理位移動畫
const VIEW_INDEX: Record<MainView, number> = {
  news: 0,
  home: 1,
  instances: 2,
  "instance-detail": 3,
  settings: 4,
  skins: 5,
};

export default function App() {
  const isLogWindow =
    typeof window !== "undefined" &&
    (window.location.hash === "#/log-window" ||
      window.location.search.includes("window=log"));

  if (isLogWindow) {
    return (
      <Suspense fallback={null}>
        <LogWindow />
      </Suspense>
    );
  }

  // 三階段無縫漸進式掛載狀態機：
  // 1. "window-reveal": DOM 僅掛載 WindowBar + 極簡 MainBootOverlay，0ms 揭示視窗杜絕 Win32 黑屏
  // 2. "workspace-mount": 視窗顯示且雙重 rAF 確認遮罩已顯示後，在遮罩下方掛載完整工作區 DOM
  // 3. "ready": 待工作區首幀合成穩定後，MainBootOverlay 平滑淡出 (220ms)
  type BootStage = "window-reveal" | "workspace-mount" | "ready";
  const [bootStage, setBootStage] = useState<BootStage>("window-reveal");
  const [isInitialDataLoaded, setIsInitialDataLoaded] = useState<boolean>(false);
  const bootStartTimeRef = useRef<number>(performance.now());
  const hasRevealedWindowRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [currentView, setCurrentView] = useState<MainView>("home");
  const [viewDirection, setViewDirection] = useState<number>(1);
  const [newsNav, setNewsNav] = useState<NewsSubNav>("official");
  const [newsNavDirection, setNewsNavDirection] = useState<number>(1);
  const [homeNav, setHomeNav] = useState<HomeSubNav>("overview");
  const [homeNavDirection, setHomeNavDirection] = useState<number>(1);

  const handleNewsNavChange = (nav: NewsSubNav) => {
    if (nav === newsNav) return;
    const order: Record<NewsSubNav, number> = { official: 0, changelog: 1, announcements: 2 };
    setNewsNavDirection(order[nav] > order[newsNav] ? 1 : -1);
    setNewsNav(nav);
  };

  const handleHomeNavChange = (nav: HomeSubNav) => {
    if (nav === homeNav) return;
    const order: Record<HomeSubNav, number> = { overview: 0, p2p: 1 };
    setHomeNavDirection(order[nav] > order[homeNav] ? 1 : -1);
    setHomeNav(nav);
  };
  const [instances, setInstances] = useState<MinecraftInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // 多實例並發執行與互斥狀態字典
  const [runningInstances, setRunningInstances] = useState<Record<string, RunningInstanceInfo>>({});
  const [launchingInstanceIds, setLaunchingInstanceIds] = useState<Record<string, boolean>>({});
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState<boolean>(false);

  // Account states
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>("");

  // Microsoft Device Code Login modal state (for adding accounts when already logged in)
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);

  // Instance creation modal state
  const [isCreateInstanceOpen, setIsCreateInstanceOpen] = useState<boolean>(false);
  const [isImportModpackOpen, setIsImportModpackOpen] = useState<boolean>(false);

  // Theme state
  const [isDark, setIsDark] = useState<boolean>(true);

  const fallbackAccount: UserAccount = {
    id: "guest",
    username: "未登入帳號",
    accountType: "microsoft",
    isReady: false,
    isActive: true,
  };

  const activeAccount =
    accounts.find((a) => a.id === activeAccountId) || accounts[0] || fallbackAccount;

  const activeInstance =
    instances.find((i) => i.id === selectedInstanceId) || instances[0] || null;

  const refreshInstances = async () => {
    try {
      const list = await instanceService.listInstances();
      setInstances(list);
      setSelectedInstanceId((currentId) => {
        if (!currentId && list.length > 0) return list[0].id;
        if (currentId && !list.some((i) => i.id === currentId)) {
          return list.length > 0 ? list[0].id : "";
        }
        return currentId;
      });
    } catch (err) {
      console.error("Failed to sync instances from disk:", err);
    }
  };

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      instanceService.listInstances(),
      authService.listAccounts(),
    ])
      .then(([instList, accList]) => {
        if (isMounted) {
          setInstances(instList);
          if (instList.length > 0) {
            setSelectedInstanceId(instList[0].id);
          }

          setAccounts(accList);
          if (accList.length > 0) {
            const active = accList.find((a) => a.isActive) || accList[0];
            setActiveAccountId(active.id);
          }
          setIsInitialDataLoaded(true);
        }
      })
      .catch((err) => {
        console.error("Initialization failed:", err);
        if (isMounted) setIsInitialDataLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // 三階段漸進式掛載與無縫視窗交接：
  // 1. "window-reveal": 確保滿 400ms 最小展示時間且初始資料就緒後，呼叫 showMainWindow() 將視窗置為 visible。
  //    此時 DOM 僅有 WindowBar 與極簡 MainBootOverlay，0ms 即時光柵化，絕不暴露 Win32 空視窗。
  // 2. "workspace-mount": 視窗顯示且雙重 rAF 確認遮罩已呈現在螢幕後，轉入 "workspace-mount"，於遮罩下方掛載完整工作區。
  // 3. "ready": 工作區完成初始光柵化 (延遲 260ms + rAF)，轉入 "ready"，MainBootOverlay 平滑淡出 (220ms)。
  useEffect(() => {
    if (!isInitialDataLoaded || hasRevealedWindowRef.current) {
      return;
    }

    const remainingDelay = computeRemainingSplashDelay({
      bootStartTimeMs: bootStartTimeRef.current,
      nowMs: performance.now(),
      minSplashDurationMs: 400,
    });

    let mountTimer: number | undefined;
    let rafId1 = 0;
    let rafId2 = 0;
    let rafId3 = 0;

    const timer = window.setTimeout(() => {
      if (hasRevealedWindowRef.current) return;
      hasRevealedWindowRef.current = true;

      void showMainWindow().then(() => {
        // 強制進行一次同步排版重排 (Layout Reflow)，確保視窗由隱藏切換為顯示時，
        // DOM 與 MainBootOverlay 樣式計算立即生效，加速 DirectComposition 表面首幀提交。
        void document.body.offsetHeight;

        // 當視窗轉為 visible: true 時，以雙重 rAF 確認 MainBootOverlay 首幀已送出至螢幕
        rafId1 = window.requestAnimationFrame(() => {
          rafId2 = window.requestAnimationFrame(() => {
            // 進入階段 2：在遮罩下方開始掛載工作區
            setBootStage("workspace-mount");

            // 給予工作區 260ms 加上額外幀合成時間，確保底層複雜 DOM、陰影與文字光柵化完畢
            mountTimer = window.setTimeout(() => {
              rafId3 = window.requestAnimationFrame(() => {
                // 進入階段 3：工作區準備就緒，啟動遮罩平滑淡出
                setBootStage("ready");

                // 遮罩淡出後延遲 1500ms，在背景以序列式（逐一間隔 150ms）預載常規 2D 頁面
                const ac = new AbortController();
                abortControllerRef.current = ac;
                window.setTimeout(() => {
                  void runSequentialPrefetch(SECONDARY_2D_PREFETCH_TASKS, 150, ac.signal);
                }, 1500);
              });
            }, 260);
          });
        });
      });
    }, remainingDelay);

    return () => {
      window.clearTimeout(timer);
      if (mountTimer) window.clearTimeout(mountTimer);
      if (rafId1) window.cancelAnimationFrame(rafId1);
      if (rafId2) window.cancelAnimationFrame(rafId2);
      if (rafId3) window.cancelAnimationFrame(rafId3);
    };
  }, [isInitialDataLoaded]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // 實例磁碟資料夾即時更新：視窗焦點與 3 秒輪詢同步
  useEffect(() => {
    const handleFocus = () => {
      refreshInstances();
    };
    window.addEventListener("focus", handleFocus);
    const interval = setInterval(refreshInstances, 3000);
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, []);

  // 初始同步背景運行中的遊戲進程
  useEffect(() => {
    instanceService.getRunningInstances().then((list) => {
      const map: Record<string, RunningInstanceInfo> = {};
      for (const item of list) {
        map[item.instance_id] = {
          pid: item.pid,
          instanceId: item.instance_id,
          accountId: item.accountId,
          accountName: item.accountName,
        };
      }
      setRunningInstances(map);
    });
  }, []);

  // 監聽後端遊戲進程狀態變更事件與退出二次確認請求
  useEffect(() => {
    let unlistenStatus: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    listen<InstanceStatusEvent>("instance-status", (event) => {
      const id = event.payload.instance_id;
      if (event.payload.status === "running") {
        setRunningInstances((prev) => ({
          ...prev,
          [id]: {
            pid: event.payload.pid ?? 0,
            instanceId: id,
            accountId: activeAccount?.id,
            accountName: activeAccount?.username,
          },
        }));
        setLaunchingInstanceIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else if (
        event.payload.status === "stopped" ||
        event.payload.status === "crashed"
      ) {
        setRunningInstances((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setLaunchingInstanceIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      } else if (event.payload.status === "launching") {
        setLaunchingInstanceIds((prev) => ({ ...prev, [id]: true }));
      }
    }).then((un) => {
      unlistenStatus = un;
    });

    listen("request-exit-confirmation", () => {
      setIsExitConfirmOpen(true);
    }).then((un) => {
      unlistenExit = un;
    });

    return () => {
      if (unlistenStatus) unlistenStatus();
      if (unlistenExit) unlistenExit();
    };
  }, [activeAccount?.id, activeAccount?.username]);

  const handleLaunchGame = async (id?: string) => {
    const targetId = id || selectedInstanceId || activeInstance?.id;
    if (!targetId) return;

    // 單實例互斥鎖保護：同實例嚴禁被同時啟動兩次
    if (runningInstances[targetId]) {
      console.warn(`實例 '${targetId}' 已在運行中，拒絕重複啟動`);
      return;
    }

    setLaunchingInstanceIds((prev) => ({ ...prev, [targetId]: true }));
    try {
      const pid = await instanceService.launchInstance(
        targetId,
        activeAccount?.id,
        activeAccount?.username
      );
      setRunningInstances((prev) => ({
        ...prev,
        [targetId]: {
          pid,
          instanceId: targetId,
          accountId: activeAccount?.id,
          accountName: activeAccount?.username,
        },
      }));
    } catch (err) {
      console.error("Launch instance error:", err);
      setLaunchingInstanceIds((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    }
  };

  const handleKillGame = async (id?: string) => {
    const targetId = id || selectedInstanceId || activeInstance?.id;
    if (!targetId || !runningInstances[targetId]) return;
    try {
      await instanceService.killInstance(targetId);
      setRunningInstances((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
    } catch (err) {
      console.error("Kill instance error:", err);
    }
  };

  const handleWindowClose = () => {
    const runningCount = Object.keys(runningInstances).length;
    if (runningCount > 0) {
      setIsExitConfirmOpen(true);
    } else {
      closeWindow();
    }
  };

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
    authService.setActiveAccount(id);
    setAccounts((prev) =>
      prev.map((acc) => ({
        ...acc,
        isActive: acc.id === id,
      }))
    );
  };

  const handleAddAccount = () => {
    setIsLoginModalOpen(true);
  };

  const handleSignOut = async (id: string) => {
    await authService.removeAccount(id);
    const remaining = accounts.filter((a) => a.id !== id);
    setAccounts(remaining);
    if (activeAccountId === id) {
      if (remaining.length > 0) {
        setActiveAccountId(remaining[0].id);
        authService.setActiveAccount(remaining[0].id);
      } else {
        setActiveAccountId("");
        setIsLoginModalOpen(true);
      }
    }
  };

  const handleCreateInstance = () => {
    setIsCreateInstanceOpen(true);
  };

  const handleImportInstance = () => {
    setIsImportModpackOpen(true);
  };

  const handleModpackImported = async (instanceId: string) => {
    await refreshInstances();
    setSelectedInstanceId(instanceId);
    const dir = VIEW_INDEX["instance-detail"] > VIEW_INDEX[currentView] ? 1 : -1;
    setViewDirection(dir);
    setCurrentView("instance-detail");
  };

  const handleInstanceCreated = (newInstance: MinecraftInstance) => {
    setInstances((prev) => [...prev, newInstance]);
    setSelectedInstanceId(newInstance.id);
    const dir = VIEW_INDEX["instance-detail"] > VIEW_INDEX[currentView] ? 1 : -1;
    setViewDirection(dir);
    setCurrentView("instance-detail");
  };

  const handleCreateGroup = () => {
    // 實例分組功能預留於後續版本
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
      <WindowBar onClose={handleWindowClose} />

      {/* Main Workspace Boot Overlay: Seamlessly covers the canvas until initial frame rasterization */}
      <AnimatePresence>
        {bootStage !== "ready" && <MainBootOverlay />}
      </AnimatePresence>

      {/* 2. Main Window Body (Sidebar + Content or Auth Overlay) */}
      {bootStage !== "window-reveal" && (
        accounts.length === 0 ? (
          <div key="app-auth" className="flex flex-1 flex-col h-full w-full">
            <AuthScreen
              onLoginSuccess={(newAcc) => {
                setAccounts([newAcc]);
                setActiveAccountId(newAcc.id);
              }}
            />
          </div>
        ) : (
          <div
            key="app-workspace"
            className="relative flex flex-1 overflow-hidden"
          >
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
          onOpenSkinManager={() => handleNavigate("skins")}
          onSignOut={handleSignOut}
          onCreateInstance={handleCreateInstance}
          onImportInstance={handleImportInstance}
          runningInstances={runningInstances}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />

        {/* Right Content Area:
            Titlebar 完全整合進主頁面畫布，與內容同享雙向物理動態 (AnimatePresence)
        */}
        <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 min-h-0 overflow-hidden relative">
            <AnimatePresence mode="wait" initial={false} custom={viewDirection}>
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
                    onNewsNavChange={handleNewsNavChange}
                    homeNav={homeNav}
                    onHomeNavChange={handleHomeNavChange}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onCreateInstance={handleCreateInstance}
                    onImportInstance={handleImportInstance}
                    onCreateGroup={handleCreateGroup}
                  />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <Suspense fallback={null}>
                      <NewsView subNav={newsNav} direction={newsNavDirection} />
                    </Suspense>
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
                    onNewsNavChange={handleNewsNavChange}
                    homeNav={homeNav}
                    onHomeNavChange={handleHomeNavChange}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onCreateInstance={handleCreateInstance}
                    onImportInstance={handleImportInstance}
                    onCreateGroup={handleCreateGroup}
                  />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <HomeView
                      subNav={homeNav}
                      direction={homeNavDirection}
                      activeInstance={activeInstance}
                      onCreateInstance={handleCreateInstance}
                      onGoToInstanceDetail={(id) => {
                        setSelectedInstanceId(id);
                        handleNavigate("instance-detail");
                      }}
                      isLaunching={!!(activeInstance && launchingInstanceIds[activeInstance.id])}
                      isRunning={!!(activeInstance && runningInstances[activeInstance.id])}
                      runningPid={activeInstance ? runningInstances[activeInstance.id]?.pid ?? null : null}
                      runningAccountName={activeInstance ? runningInstances[activeInstance.id]?.accountName ?? null : null}
                      onLaunch={() => handleLaunchGame(activeInstance?.id)}
                      onKill={() => activeInstance && handleKillGame(activeInstance.id)}
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
                    onImportInstance={handleImportInstance}
                    onCreateGroup={handleCreateGroup}
                  />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <Suspense fallback={null}>
                      <InstancesView
                        instances={instances}
                        searchQuery={searchQuery}
                        runningInstances={runningInstances}
                        onCreateInstance={handleCreateInstance}
                        onImportInstance={handleImportInstance}
                        onCreateGroup={handleCreateGroup}
                        onInstanceDuplicated={refreshInstances}
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
                          handleLaunchGame(id);
                        }}
                        onKillInstance={(id) => {
                          handleKillGame(id);
                        }}
                      />
                    </Suspense>
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
                  <Suspense fallback={null}>
                    <InstanceDetailView
                      instance={activeInstance}
                      onLaunch={(id) => handleLaunchGame(id)}
                      onGoToInstances={() => handleNavigate("instances")}
                      isLaunching={!!(activeInstance && launchingInstanceIds[activeInstance.id])}
                      isRunning={!!(activeInstance && runningInstances[activeInstance.id])}
                      runningPid={activeInstance ? runningInstances[activeInstance.id]?.pid ?? null : null}
                      runningAccountName={activeInstance ? runningInstances[activeInstance.id]?.accountName ?? null : null}
                      onKill={() => activeInstance && handleKillGame(activeInstance.id)}
                      onInstanceUpdated={(updated) => {
                        setInstances((prev) =>
                          prev.map((it) => (it.id === activeInstance?.id ? updated : it))
                        );
                        setSelectedInstanceId(updated.id);
                      }}
                    />
                  </Suspense>
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
                    <Suspense fallback={null}>
                      <SettingsView />
                    </Suspense>
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "skins" && (
                <motion.div
                  key="skins"
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
                    <Suspense fallback={null}>
                      <SkinManagerView
                        activeAccount={activeAccount}
                        onGoBack={() => handleNavigate("home")}
                        onOpenLoginModal={() => setIsLoginModalOpen(true)}
                        onAccountUpdated={(updated) => {
                          setAccounts((prev) =>
                            prev.map((a) => (a.id === updated.id ? updated : a))
                          );
                        }}
                      />
                    </Suspense>
                  </ScrollArea>
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>
      </div>
      )
      )}

      {/* Microsoft Device Code Authentication Modal (Condition-gated to avoid eager bundle fetch) */}
      {isLoginModalOpen && (
        <Suspense fallback={null}>
          <MicrosoftLoginModal
            isOpen={isLoginModalOpen}
            onClose={() => setIsLoginModalOpen(false)}
            onSuccess={(newAcc) => {
              setAccounts((prev) => {
                const filtered = prev.filter((a) => a.id !== newAcc.id);
                return [newAcc, ...filtered.map((a) => ({ ...a, isActive: false }))];
              });
              setActiveAccountId(newAcc.id);
            }}
          />
        </Suspense>
      )}

      {/* Create Instance Modal */}
      {isCreateInstanceOpen && (
        <Suspense fallback={null}>
          <CreateInstanceDialog
            isOpen={isCreateInstanceOpen}
            onClose={() => setIsCreateInstanceOpen(false)}
            onCreated={handleInstanceCreated}
          />
        </Suspense>
      )}

      {/* Import Modpack Modal */}
      {isImportModpackOpen && (
        <Suspense fallback={null}>
          <ImportModpackDialog
            isOpen={isImportModpackOpen}
            onClose={() => setIsImportModpackOpen(false)}
            onImportSuccess={handleModpackImported}
          />
        </Suspense>
      )}

      {/* Exit Confirmation Dialog */}
      <ExitConfirmationDialog
        open={isExitConfirmOpen}
        onOpenChange={setIsExitConfirmOpen}
        runningCount={Object.keys(runningInstances).length}
        onHideToTray={async () => {
          setIsExitConfirmOpen(false);
          await hideWindow();
        }}
        onForceQuit={async () => {
          setIsExitConfirmOpen(false);
          await exitApp();
        }}
      />
    </div>
  );
}
