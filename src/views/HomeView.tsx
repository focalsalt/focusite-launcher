import React, { useState } from "react";
import { motion } from "motion/react";
import {
  Play,
  Download,
  Users2,
  Layers,
  Activity,
  Radio,
  Copy,
  Check,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { HomeSubNav, MinecraftInstance } from "@/types/navigation";

interface HomeViewProps {
  subNav: HomeSubNav;
  activeInstance: MinecraftInstance;
}

export const HomeView: React.FC<HomeViewProps> = ({ subNav, activeInstance }) => {
  const [isLaunching, setIsLaunching] = useState<boolean>(false);
  const [launchProgress, setLaunchProgress] = useState<number>(0);

  // P2P Room state
  const [roomCode, setRoomCode] = useState<string>("");
  const [hostRoomCode] = useState<string>("FC-7729");
  const [copied, setCopied] = useState<boolean>(false);
  const [p2pConnected, setP2pConnected] = useState<boolean>(false);

  const handleLaunch = () => {
    if (isLaunching) return;
    setIsLaunching(true);
    setLaunchProgress(20);
    const t1 = setTimeout(() => setLaunchProgress(55), 350);
    const t2 = setTimeout(() => setLaunchProgress(90), 800);
    const t3 = setTimeout(() => {
      setLaunchProgress(100);
      setTimeout(() => {
        setIsLaunching(false);
        setLaunchProgress(0);
      }, 500);
    }, 1200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  };

  const handleCopyHostCode = () => {
    navigator.clipboard.writeText(hostRoomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      key={subNav}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="space-y-6 max-w-5xl"
    >
      {/* 1. 主頁總覽 */}
      {subNav === "overview" && (
        <>
          {/* Main Hero Play Card with Brand Green Gradient */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-[#2E6B1D]/40 via-slate-900/40 to-transparent p-8 backdrop-blur-md">
            <div className="max-w-xl space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="success">{activeInstance.name}</Badge>
                <Badge variant="secondary">{activeInstance.loader}</Badge>
                <Badge variant="outline">MC {activeInstance.version}</Badge>
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-100">
                Focusite 啟動器
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Tauri 2.0 原生接管、全域 CAS 硬連結去重儲存、5ms 離線日誌 AST 崩潰診斷，以及免驅動 WebRTC 好友連線。
              </p>
            </div>

            <div className="mt-6 flex items-center gap-4">
              <Button
                size="lg"
                onClick={handleLaunch}
                disabled={isLaunching}
                className="gap-2 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] hover:from-[#469C2D] hover:to-[#357A21] font-semibold text-white shadow-lg shadow-[#3C8527]/30 hover:opacity-95"
              >
                <Play className="h-5 w-5 fill-current" />
                {isLaunching ? "正在準備遊戲環境..." : `立即啟動 ${activeInstance.name}`}
              </Button>
              <Button variant="glass" size="lg" className="gap-2">
                <Download className="h-4 w-4" />
                檢查遊戲依賴更新
              </Button>
            </div>

            {isLaunching && (
              <div className="mt-6 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>校驗 CAS 模組庫與原生 Hardlink 映射...</span>
                  <span>{launchProgress}%</span>
                </div>
                <Progress value={launchProgress} />
              </div>
            )}
          </div>

          {/* Core Feature Highlights Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Layers className="h-5 w-5 text-[#52A43A]" />}
              title="CAS 內容尋址去重"
              description="各實例獨立隔離，共用之 Mod 與函式庫透過作業系統 Hardlink 映射，磁碟零重複佔用。"
            />
            <FeatureCard
              icon={<Users2 className="h-5 w-5 text-[#52A43A]" />}
              title="免驅動 P2P 好友同遊"
              description="純使用者態 WebRTC TCP 隧道，無須安裝 TUN/TAP 虛擬網卡驅動與管理員提權。"
            />
            <FeatureCard
              icon={<Activity className="h-5 w-5 text-emerald-400" />}
              title="5ms 離線日誌 AST 診斷"
              description="秒解 95% 常見崩潰（Java 版本錯配、Fabric API 缺失、記憶體不足 OOM 與 Mod 衝突）。"
            />
          </div>
        </>
      )}

      {/* 2. P2P好友共遊 (Navbar 置中分頁) */}
      {subNav === "p2p" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-[#52A43A]" />
                <CardTitle className="text-base">加入好友房間</CardTitle>
              </div>
              <CardDescription className="text-xs">
                輸入房主透過 Focusite 產生的 6 位連線房間碼，啟動器將於本機建立 127.0.0.1 虛擬代理直連。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="輸入房間碼 (例如: FC-7729)"
                  className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-mono text-slate-100 placeholder-slate-500 focus:border-[#52A43A] focus:outline-none"
                />
                <Button
                  onClick={() => setP2pConnected(true)}
                  disabled={!roomCode}
                  className="bg-[#3C8527] hover:bg-[#469C2D] text-white"
                >
                  連線
                </Button>
              </div>

              {p2pConnected && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400 flex items-center justify-between">
                  <span>已建立 WebRTC 加密隧道：127.0.0.1:40023</span>
                  <Badge variant="success">已連線</Badge>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-[#52A43A]" />
                <CardTitle className="text-base">我的房主代碼</CardTitle>
              </div>
              <CardDescription className="text-xs">
                在 Minecraft 遊戲中點擊「對局域網開放」後，將下方房間碼發送給好友即可直連。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="font-mono text-lg font-bold text-slate-100">
                  {hostRoomCode}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyHostCode}
                  className="gap-1 text-xs border-white/10"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>已複製</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>複製代碼</span>
                    </>
                  )}
                </Button>
              </div>

              <div className="text-[11px] text-muted-foreground leading-relaxed">
                * 本功能採純使用者態 WebRTC SCTP 穿透技術，無須在路由器設定 Port Forwarding 或安裝虛擬網卡。
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </motion.div>
  );
};

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="hover:border-[#52A43A]/40 transition-colors border-white/10 bg-white/5">
      <CardHeader className="space-y-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 border border-white/10">
          {icon}
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs leading-relaxed text-slate-400">
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
