import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play,
  FolderOpen,
  Settings,
  Package,
  HardDrive,
  Activity,
  CheckCircle2,
  Cpu,
  Image as ImageIcon,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InstanceDetailSubNav, MinecraftInstance } from "@/types/navigation";

// 水平分頁空間索引映射
const SUB_TAB_ORDER: Record<InstanceDetailSubNav, number> = {
  settings: 0,
  mods: 1,
  saves: 2,
  logs: 3,
};

// 預設 Minecraft 官方版本背景圖 (1.21 / 1.21.4 官方主視覺)
const DEFAULT_MC_BG =
  "https://launchercontent.mojang.com/images/1.21.0.jpg";

interface InstanceDetailViewProps {
  instance: MinecraftInstance;
  onLaunch: (id: string) => void;
}

export const InstanceDetailView: React.FC<InstanceDetailViewProps> = ({
  instance,
  onLaunch,
}) => {
  const [activeSubTab, setActiveSubTab] =
    useState<InstanceDetailSubNav>("settings");
  const [tabDirection, setTabDirection] = useState<number>(1);
  const [maxRam, setMaxRam] = useState<number>(4096);
  const [javaPath] = useState<string>("系統自動探測 (Java 21 OpenJDK)");

  // 處理水平物理方向的子分頁切換
  const handleSelectSubTab = (newTab: InstanceDetailSubNav) => {
    if (newTab === activeSubTab) return;
    const dir = SUB_TAB_ORDER[newTab] > SUB_TAB_ORDER[activeSubTab] ? 1 : -1;
    setTabDirection(dir);
    setActiveSubTab(newTab);
  };

  // 模組狀態 (支援 Switch 切換)
  const [mods, setMods] = useState([
    { id: "mod-1", name: "Fabric API", version: "0.92.0+1.21.4", desc: "必備核心運行庫", enabled: true },
    { id: "mod-2", name: "Sodium / Embeddium", version: "0.6.0", desc: "現代開源高效能渲染最佳化引擎", enabled: true },
    { id: "mod-3", name: "Iris Shaders", version: "1.7.0", desc: "現代光影包加載管線", enabled: true },
    { id: "mod-4", name: "Lithium", version: "0.12.0", desc: "通用物理運算與伺服端效能最佳化", enabled: true },
  ]);

  const toggleMod = (id: string, enabled: boolean) => {
    setMods((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled } : m))
    );
  };

  // 可自訂背景圖狀態 (預設為 Minecraft 官方版本圖，可自訂更換)
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

  const navTabs: { id: InstanceDetailSubNav; label: string; icon: React.ReactNode }[] = [
    {
      id: "settings",
      label: "實例設定",
      icon: <Settings className="h-4 w-4" />,
    },
    {
      id: "mods",
      label: `模組清單 (${instance.modCount || mods.length})`,
      icon: <Package className="h-4 w-4" />,
    },
    {
      id: "saves",
      label: "存檔與世界",
      icon: <HardDrive className="h-4 w-4" />,
    },
    {
      id: "logs",
      label: "日誌與診斷",
      icon: <Activity className="h-4 w-4" />,
    },
  ];

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

  return (
    <div className="flex flex-col w-full min-h-full select-none pb-12">
      {/* 隱藏的自訂背景檔案選取器 */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCustomBgChange}
        accept="image/*"
        className="hidden"
      />

      {/* 1. 紅框：貼合的背景圖 (預設為 Minecraft 官方版本圖，可自訂義) */}
      <div className="relative w-full h-64 shrink-0 overflow-hidden border-b border-white/10 bg-slate-950">
        {/* 背景大圖與漸變遮罩 */}
        {!bgLoadError ? (
          <img
            src={bgImage}
            alt="Minecraft Official Artwork"
            onError={() => setBgLoadError(true)}
            className="absolute inset-0 h-full w-full object-cover object-center filter brightness-85"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#1E4A13] via-[#0E260A] to-slate-950" />
        )}

        {/* 氛圍遮罩與暗部漸層以確保文字與按鈕清晰可讀 */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/65 to-slate-950/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/40 to-slate-950/70" />
        <div className="pointer-events-none absolute bottom-0 left-6 h-36 w-96 rounded-full bg-[#3C8527]/25 blur-3xl" />

        {/* Hero 內部下緣內容：紫框 (左側實例資訊) 與 綠框 (右側按鈕群) */}
        <div className="relative z-10 flex h-full w-full items-end justify-between px-8 pb-6">
          {/* 紫框：實例 Icon、實例名稱、實例版本 (MC與Loader版本) */}
          <div className="flex items-center gap-5">
            <div className="flex h-18 w-18 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#3C8527] to-[#2E6B1D] text-white shadow-2xl shadow-[#3C8527]/30 border border-white/20">
              <Package className="h-9 w-9 drop-shadow" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-black tracking-tight text-white drop-shadow-md">
                  {instance.name}
                </h1>
                <Badge variant="success" className="bg-[#3C8527] text-white font-mono shadow-sm">
                  MC {instance.version}
                </Badge>
                <Badge variant="outline" className="border-white/20 bg-black/40 text-slate-200 backdrop-blur-sm">
                  {instance.loader}
                </Badge>
              </div>
              <p className="text-xs text-slate-300 drop-shadow">
                獨立遊戲目錄：
                <span className="font-mono text-slate-400">
                  instances/{instance.id}/.minecraft
                </span>
              </p>
            </div>
          </div>

          {/* 綠框：按鈕群 (更換背景、開啟遊戲資料夾、立即啟動遊戲) */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5 text-xs h-9 rounded-xl border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-200"
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
                className="gap-1 text-xs h-9 rounded-xl border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-300"
                title="恢復預設官方圖"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-9 rounded-xl border-white/15 bg-black/40 backdrop-blur-md hover:bg-white/10 text-slate-200"
            >
              <FolderOpen className="h-4 w-4 text-slate-300" />
              <span>開啟遊戲資料夾</span>
            </Button>

            <Button
              type="button"
              size="lg"
              onClick={() => onLaunch(instance.id)}
              className="gap-2 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] hover:from-[#469C2D] hover:to-[#357A21] text-white font-bold px-6 rounded-xl shadow-xl shadow-[#3C8527]/30"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>立即啟動遊戲</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 2. 黃框：Tab 按鈕，高亮顯示使用底部水平滑動膠囊 */}
      <div className="relative w-full border-b border-white/10 bg-slate-950/70 backdrop-blur-md px-8">
        <div className="flex items-center gap-8">
          {navTabs.map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectSubTab(tab.id)}
                className={`relative flex items-center gap-2 py-3.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span
                  className={
                    isActive ? "text-[#52A43A]" : "text-slate-400"
                  }
                >
                  {tab.icon}
                </span>
                <span>{tab.label}</span>

                {/* 底部水平滑動膠囊 */}
                {isActive && (
                  <motion.div
                    layoutId="instance-detail-tab-pill"
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.7)]"
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

      {/* 3. 藍框：Tab 頁面內容 (雙向水平物理動態轉場) */}
      <div className="p-8 space-y-6 max-w-6xl overflow-hidden">
        <AnimatePresence mode="wait" custom={tabDirection}>
          {activeSubTab === "settings" && (
            <motion.div
              key="settings"
              custom={tabDirection}
              variants={tabContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              <Card className="border-white/10 bg-white/5 backdrop-blur-md">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-[#52A43A]" />
                    <CardTitle className="text-base">JVM 記憶體分配</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    建議依目前系統記憶體與 Mod 數量調校最大 Heap 記憶體大小。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      最大分配記憶體 (Max Heap)
                    </span>
                    <span className="font-bold font-mono text-[#52A43A]">
                      {maxRam} MB
                    </span>
                  </div>

                  {/* Shadcn Slider 元件 */}
                  <Slider
                    value={maxRam}
                    min={1024}
                    max={16384}
                    step={512}
                    onChange={setMaxRam}
                  />

                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>1024 MB</span>
                    <span>4096 MB (推薦)</span>
                    <span>8192 MB</span>
                    <span>16384 MB</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5 backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="text-base">Java 執行階段環境</CardTitle>
                  <CardDescription className="text-xs">
                    此 Minecraft 版本建議使用 Java 21 (64-bit)。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs font-mono text-slate-300">
                    {javaPath}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 rounded-lg border-white/10 bg-white/5 hover:bg-white/10"
                  >
                    手動選擇其他 Java JRE...
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {activeSubTab === "mods" && (
            <motion.div
              key="mods"
              custom={tabDirection}
              variants={tabContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <Card className="border-white/10 bg-white/5 backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="text-base">已安裝模組 (CAS 去重)</CardTitle>
                  <CardDescription className="text-xs">
                    共用 Mod 檔案由全域雜湊庫管理並透過作業系統原生 Hardlink 映射至此實例。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {mods.map((mod) => (
                    <ModItem
                      key={mod.id}
                      name={mod.name}
                      version={mod.version}
                      desc={mod.desc}
                      enabled={mod.enabled}
                      onToggle={(checked) => toggleMod(mod.id, checked)}
                    />
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {activeSubTab === "saves" && (
            <motion.div
              key="saves"
              custom={tabDirection}
              variants={tabContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <Card className="border-white/10 bg-white/5 backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="text-base">存檔與世界</CardTitle>
                  <CardDescription className="text-xs">
                    本實例獨立擁有的世界資料夾與本機備份存檔。
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  目前檢測到 1 個單人世界：
                  <span className="text-slate-200 font-semibold ml-1">
                    New World (生存模式)
                  </span>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {activeSubTab === "logs" && (
            <motion.div
              key="logs"
              custom={tabDirection}
              variants={tabContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <Card className="border-white/10 bg-white/5 backdrop-blur-md">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <CardTitle className="text-base">離線日誌 AST 診斷狀態</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    最近一次進程退出未檢測到 Java 錯配、缺失依賴或記憶體溢出。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl bg-black/40 p-4 font-mono text-[11px] text-slate-300 leading-relaxed border border-white/5">
                    [Focusite Engine] Process spawned with PID: 14820<br />
                    [JVM] Java 21 OpenJDK 64-Bit Server VM initialized.<br />
                    [Client] Initializing Minecraft 1.21.4 with Fabric Loader...<br />
                    [Fabric] Loaded 12 active mods with CAS hardlink deduplication rate 100%.<br />
                    [Sound] Web Audio latency: 2.1ms.<br />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

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
          <Badge variant="outline" className="text-[10px] py-0 px-1.5">
            {version}
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
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
