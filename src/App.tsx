import { sortForSidebar } from "@/lib/instanceOrder";
import { scaleVariants, slideVariants } from "@/lib/motion";
import { useExitMount } from "@/lib/useExitMount";
import { useState, useEffect, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { WindowBar } from "@/components/layout/WindowBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { DynamicTitlebar } from "@/components/layout/DynamicTitlebar";
import { MainBootOverlay } from "@/components/layout/MainBootOverlay";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HomeView } from "@/views/HomeView";
import { EMPTY_FILES, setCachedFiles } from "@/lib/instanceFilesCache";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { FriendsPanel } from "@/components/party/FriendsPanel";
import { OnboardingGuide } from "@/components/onboarding/OnboardingGuide";
import { ExitConfirmationDialog } from "@/components/layout/ExitConfirmationDialog";
import { MinecraftInstance } from "@/types/navigation";
import { instanceService } from "@/services/instanceService";
import { authService } from "@/services/authService";
import { closeWindow, exitApp, hideWindow } from "@/lib/tauriWindow";
import { listenSafe } from "@/lib/listenSafe";
import { themeService } from "@/services/themeService";
import { LocationConsentDialog } from "@/components/layout/LocationConsentDialog";
import { ShortcutsDialog } from "@/components/layout/ShortcutsDialog";
import { Toaster } from "@/components/ui/Toaster";
import { useAccounts } from "@/hooks/useAccounts";
import { useBootSequence } from "@/hooks/useBootSequence";
import { useFirstRun } from "@/hooks/useFirstRun";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useInstances } from "@/hooks/useInstances";
import { useNavigation } from "@/hooks/useNavigation";
import { useRunningInstances } from "@/hooks/useRunningInstances";

// Views outside the first screen load lazily, which keeps the Three.js engine out of the main bundle.
const NewsView = lazy(() => import("@/views/NewsView").then((m) => ({ default: m.NewsView })));
const InstancesView = lazy(() => import("@/views/InstancesView").then((m) => ({ default: m.InstancesView })));
const InstanceDetailView = lazy(() => import("@/views/InstanceDetailView").then((m) => ({ default: m.InstanceDetailView })));
const SettingsView = lazy(() => import("@/views/SettingsView").then((m) => ({ default: m.SettingsView })));
const SkinManagerView = lazy(() => import("@/views/SkinManagerView").then((m) => ({ default: m.SkinManagerView })));
const LogWindow = lazy(() => import("@/views/LogWindow").then((m) => ({ default: m.LogWindow })));
const WorkshopWindow = lazy(() => import("@/views/WorkshopWindow").then((m) => ({ default: m.WorkshopWindow })));
const CreateInstanceDialog = lazy(() => import("@/components/instance/CreateInstanceDialog").then((m) => ({ default: m.CreateInstanceDialog })));
const ImportModpackDialog = lazy(() => import("@/components/instance/ImportModpackDialog").then((m) => ({ default: m.ImportModpackDialog })));
const MicrosoftLoginModal = lazy(() => import("@/components/auth/MicrosoftLoginModal").then((m) => ({ default: m.MicrosoftLoginModal })));
const LaunchInstallModal = lazy(() => import("@/components/instance/LaunchInstallModal").then((m) => ({ default: m.LaunchInstallModal })));

const pageVariants = slideVariants("y", 12);

/** Picks the window this webview hosts. The kind never changes at runtime, and each kind owns its hooks. */
export default function App() {
  useEffect(() => {
    const cleanup = themeService.initListeners();
    return cleanup;
  }, []);

  const isLogWindow =
    window.location.hash.startsWith("#/log-window") || window.location.search.includes("window=log");
  const isWorkshopWindow =
    window.location.hash.startsWith("#/workshop") || window.location.search.includes("window=workshop");

  if (isLogWindow || isWorkshopWindow) {
    return <Suspense fallback={null}>{isLogWindow ? <LogWindow /> : <WorkshopWindow />}</Suspense>;
  }
  return <MainApp />;
}

function MainApp() {
  const [isInitialDataLoaded, setIsInitialDataLoaded] = useState<boolean>(false);
  const bootStage = useBootSequence(isInitialDataLoaded);
  const { currentView, viewDirection, setViewDirection, showView, navigate, news, home, settings } = useNavigation();
  const {
    instances,
    setInstances,
    selectedInstanceId,
    setSelectedInstanceId,
    activeInstance,
    refreshInstances,
  } = useInstances();
  const {
    accounts,
    setAccounts,
    setActiveAccountId,
    activeAccount,
    updateAccount,
    signInFirstAccount,
    addAccount,
    selectAccount,
    signOut,
    isLoginModalOpen,
    setIsLoginModalOpen,
  } = useAccounts();
  const { runningInstances, launchingInstanceIds, launchGame, killGame } = useRunningInstances(
    activeAccount,
    selectedInstanceId || activeInstance?.id
  );
  const { showOnboarding, closeOnboarding, skipOnboarding, askLocation, answerLocation } = useFirstRun();

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState<boolean>(false);
  const [isCreateInstanceOpen, setIsCreateInstanceOpen] = useState<boolean>(false);
  const [isImportModpackOpen, setIsImportModpackOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  // Keep modals mounted briefly after closing so their exit animation can play.
  const loginMounted = useExitMount(isLoginModalOpen);
  const createMounted = useExitMount(isCreateInstanceOpen);
  const importMounted = useExitMount(isImportModpackOpen);

  // QuickPlay never targets an instance that still needs setup.
  const homeInstance =
    (activeInstance && !activeInstance.needsSetup ? activeInstance : instances.find((i) => !i.needsSetup)) || null;

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
            skipOnboarding();
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

  useEffect(() => listenSafe("request-exit-confirmation", () => setIsExitConfirmOpen(true)), []);

  const handleWindowClose = () => {
    if (Object.keys(runningInstances).length > 0) {
      setIsExitConfirmOpen(true);
    } else {
      closeWindow();
    }
  };

  const handleSelectInstance = (instanceId: string) => {
    // Moving between instance pages follows the list: a lower entry slides the page up, a higher one down.
    if (currentView === "instance-detail" && instanceId !== selectedInstanceId) {
      const order = sortForSidebar(instances).map((i) => i.id);
      const from = order.indexOf(selectedInstanceId || activeInstance?.id || "");
      const to = order.indexOf(instanceId);
      if (from !== -1 && to !== -1) setViewDirection(to > from ? 1 : -1);
    }
    setSelectedInstanceId(instanceId);
    navigate("instance-detail");
  };

  const handleCreateInstance = () => setIsCreateInstanceOpen(true);
  const handleImportInstance = () => setIsImportModpackOpen(true);

  const handleModpackImported = async (instanceId: string) => {
    await refreshInstances();
    setSelectedInstanceId(instanceId);
    showView("instance-detail");
  };

  const handleInstanceCreated = (newInstance: MinecraftInstance) => {
    // A brand-new instance has no files: open its pages straight into empty states, no skeleton.
    setCachedFiles(newInstance.id, EMPTY_FILES);
    setInstances((prev) => [...prev, newInstance]);
    setSelectedInstanceId(newInstance.id);
    showView("instance-detail");
  };

  useGlobalShortcuts(bootStage === "ready" && accounts.length > 0 && !showOnboarding, (action) => {
    if (action.type === "help") setIsShortcutsOpen(true);
    else if (action.type === "navigate") navigate(action.view);
    else {
      // The open instance page wins; elsewhere this is the QuickPlay instance.
      const target = currentView === "instance-detail" ? activeInstance : homeInstance;
      if (target && !target.needsSetup && !launchingInstanceIds[target.id] && !runningInstances[target.id]) {
        launchGame(target.id);
      }
    }
  });

  const titlebarProps = {
    newsNav: news.nav,
    onNewsNavChange: news.change,
    homeNav: home.nav,
    onHomeNavChange: home.change,
    settingsNav: settings.nav,
    onSettingsNavChange: settings.change,
    searchQuery,
    onSearchChange: setSearchQuery,
    onCreateInstance: handleCreateInstance,
    onImportInstance: handleImportInstance,
  };
  /** Shared by every page that slides vertically. */
  const pageMotion = {
    custom: viewDirection,
    variants: pageVariants,
    initial: "initial",
    animate: "animate",
    exit: "exit",
    className: "flex h-full w-full flex-col overflow-hidden",
  };

  return (
      <div className="dark relative flex h-screen w-screen flex-col overflow-hidden bg-canvas text-slate-100 select-none transition-colors duration-300">
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
            <AuthScreen onLoginSuccess={signInFirstAccount} />
          </div>
        ) : (
          <div
            key="app-workspace"
            className="relative flex flex-1 overflow-hidden"
          >
        {/* Background Ambient Glow (Focusite Emerald & Grass Green) */}
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <div className="absolute -top-[15%] -left-[10%] h-[450px] w-[450px] rounded-full bg-brand/15 blur-[130px]" />
          <div className="absolute -bottom-[15%] -right-[10%] h-[450px] w-[450px] rounded-full bg-brand-dark/20 blur-[130px]" />
        </div>

        <FriendsPanel account={activeAccount} visible={currentView === "home" && home.nav === "p2p"} />

        {/* Sidebar */}
        <Sidebar
          currentView={currentView}
          onNavigate={navigate}
          instances={instances}
          selectedInstanceId={selectedInstanceId}
          onSelectInstance={handleSelectInstance}
          accounts={accounts}
          activeAccount={activeAccount}
          onSelectAccount={selectAccount}
          onAddAccount={() => setIsLoginModalOpen(true)}
          onOpenSkinManager={() => navigate("skins")}
          onSignOut={signOut}
          onCreateInstance={handleCreateInstance}
          onImportInstance={handleImportInstance}
          runningInstances={runningInstances}
        />

        {/* Right content area: each page carries its own titlebar so both move together. */}
        <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 min-h-0 overflow-hidden relative">
            <AnimatePresence mode="popLayout" initial={false} custom={viewDirection}>
              {currentView === "news" && (
                <motion.div
                  key="news"
                  {...pageMotion}
                >
                  <DynamicTitlebar currentView="news" {...titlebarProps} />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <Suspense fallback={null}>
                      <NewsView subNav={news.nav} direction={news.direction} />
                    </Suspense>
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "home" && (
                <motion.div
                  key="home"
                  {...pageMotion}
                >
                  <DynamicTitlebar currentView="home" {...titlebarProps} />
                  <div className="flex-1 min-h-0 p-6">
                    <HomeView
                      subNav={home.nav}
                      direction={home.direction}
                      activeInstance={homeInstance}
                      onCreateInstance={handleCreateInstance}
                      onImportInstance={handleImportInstance}
                      instances={instances}
                      busyIds={{ ...launchingInstanceIds, ...runningInstances }}
                      account={activeAccount}
                      onQuickPlay={(instanceId, type, target) => launchGame(instanceId, type, target)}
                    />
                  </div>
                </motion.div>
              )}

              {currentView === "instances" && (
                <motion.div
                  key="instances"
                  {...pageMotion}
                >
                  <DynamicTitlebar currentView="instances" {...titlebarProps} />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <Suspense fallback={null}>
                      <InstancesView
                        instances={instances}
                        searchQuery={searchQuery}
                        runningInstances={runningInstances}
                        onInstancesChanged={refreshInstances}
                        onInstanceDuplicated={refreshInstances}
                        onSelectInstance={(id) => {
                          setSelectedInstanceId(id);
                          showView("instance-detail");
                        }}
                        onLaunchInstance={(id) => {
                          launchGame(id);
                        }}
                        onKillInstance={(id) => {
                          killGame(id);
                        }}
                      />
                    </Suspense>
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "instance-detail" && (
                <motion.div
                  key={`instance-detail-${selectedInstanceId}`}
                  {...pageMotion}
                >
                  <Suspense fallback={null}>
                    <InstanceDetailView
                      instance={activeInstance}
                      onLaunch={(id) => launchGame(id)}
                      onGoToInstances={() => navigate("instances")}
                      isLaunching={!!(activeInstance && launchingInstanceIds[activeInstance.id])}
                      isRunning={!!(activeInstance && runningInstances[activeInstance.id])}
                      runningPid={activeInstance ? runningInstances[activeInstance.id]?.pid ?? null : null}
                      runningAccountName={activeInstance ? runningInstances[activeInstance.id]?.accountName ?? null : null}
                      onKill={() => activeInstance && killGame(activeInstance.id)}
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
                  {...pageMotion}
                >
                  <DynamicTitlebar currentView="settings" {...titlebarProps} />
                  <ScrollArea
                    className="flex-1 min-h-0"
                    viewportClassName="p-6"
                  >
                    <Suspense fallback={null}>
                      <SettingsView subNav={settings.nav} direction={settings.direction} />
                    </Suspense>
                  </ScrollArea>
                </motion.div>
              )}

              {currentView === "skins" && (
                <motion.div
                  key="skins"
                  variants={scaleVariants}
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
                        onGoBack={() => navigate("home")}
                        onOpenLoginModal={() => setIsLoginModalOpen(true)}
                        onAccountUpdated={updateAccount}
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
      {loginMounted && (
        <Suspense fallback={null}>
          <MicrosoftLoginModal
            isOpen={isLoginModalOpen}
            onClose={() => setIsLoginModalOpen(false)}
            onSuccess={addAccount}
          />
        </Suspense>
      )}

      {/* First-run guide: only once the user is logged in and the workspace is visible */}
      {showOnboarding && accounts.length > 0 && bootStage === "ready" && (
        <OnboardingGuide
          onCreateInstance={handleCreateInstance}
          onImportInstance={handleImportInstance}
          onFinish={closeOnboarding}
        />
      )}

      {/* Create Instance Modal */}
      {createMounted && (
        <Suspense fallback={null}>
          <CreateInstanceDialog
            isOpen={isCreateInstanceOpen}
            onClose={() => setIsCreateInstanceOpen(false)}
            onCreated={handleInstanceCreated}
          />
        </Suspense>
      )}

      {/* Import Modpack Modal */}
      {importMounted && (
        <Suspense fallback={null}>
          <ImportModpackDialog
            isOpen={isImportModpackOpen}
            onClose={() => setIsImportModpackOpen(false)}
            onImportSuccess={handleModpackImported}
          />
        </Suspense>
      )}

      <Toaster />

      {/* Launch Install Progress Modal */}
      <Suspense fallback={null}>
        <LaunchInstallModal activeInstanceId={selectedInstanceId || activeInstance?.id || null} />
      </Suspense>

      <LocationConsentDialog open={askLocation && bootStage === "ready" && !showOnboarding} onAnswer={answerLocation} />

      <ShortcutsDialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen} />

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
