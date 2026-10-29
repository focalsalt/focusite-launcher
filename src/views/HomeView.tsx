import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Play,
  Square,
  RefreshCw,
  Users2,
  Layers,
  Activity,
  Radio,
  Copy,
  Check,
  Server,
  Plus,
  Package,
  FolderOpen,
  ArrowRight,
  Sparkles,
  Wifi,
  Globe,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HomeSubNav, MinecraftInstance } from "@/types/navigation";
import { convertFileSrc } from "@tauri-apps/api/core";
import { instanceService } from "@/services/instanceService";
import { p2pService, P2pSessionDto, P2pHandshakeResult } from "@/services/p2pService";

const HOME_SUB_NAV_ORDER: Record<HomeSubNav, number> = {
  overview: 0,
  p2p: 1,
};

const subTabVariants = {
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

const getIconSrc = (path?: string) => {
  if (!path) return undefined;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      return convertFileSrc(path);
    } catch {
      return path;
    }
  }
  return path;
};

interface HomeViewProps {
  subNav: HomeSubNav;
  activeInstance: MinecraftInstance | null;
  onCreateInstance: () => void;
  onGoToInstanceDetail?: (id: string) => void;
  direction?: number;
  isLaunching?: boolean;
  isRunning?: boolean;
  runningPid?: number | null;
  runningAccountName?: string | null;
  onLaunch?: () => void;
  onKill?: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  subNav,
  activeInstance,
  onCreateInstance,
  onGoToInstanceDetail,
  direction: directionProp,
  isLaunching = false,
  isRunning = false,
  runningPid = null,
  runningAccountName = null,
  onLaunch,
  onKill,
}) => {
  const prevNavRef = useRef<HomeSubNav>(subNav);
  const direction =
    directionProp ??
    (HOME_SUB_NAV_ORDER[subNav] >= HOME_SUB_NAV_ORDER[prevNavRef.current] ? 1 : -1);

  useEffect(() => {
    prevNavRef.current = subNav;
  }, [subNav]);

  // Real P2P Room state
  const [alias, setAlias] = useState<string>(() => {
    return localStorage.getItem("focusite_p2p_alias") || runningAccountName || "Focusite Player";
  });
  const [hostPort, setHostPort] = useState<number>(25565);
  const [joinRoomCode, setJoinRoomCode] = useState<string>("");
  const [activeSessions, setActiveSessions] = useState<P2pSessionDto[]>([]);
  const [isP2pLoading, setIsP2pLoading] = useState<boolean>(false);
  const [p2pError, setP2pError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [handshakeResults, setHandshakeResults] = useState<
    Record<string, { loading: boolean; res?: P2pHandshakeResult }>
  >({});

  const handleVerifyHandshake = async (sessionId: string) => {
    setHandshakeResults((prev) => ({ ...prev, [sessionId]: { loading: true } }));
    try {
      const res = await p2pService.verifyHandshake(sessionId);
      setHandshakeResults((prev) => ({ ...prev, [sessionId]: { loading: false, res } }));
      await refreshSessions();
    } catch (e: any) {
      setHandshakeResults((prev) => ({
        ...prev,
        [sessionId]: {
          loading: false,
          res: {
            sessionId,
            success: false,
            latencyMs: 0,
            motd: String(e),
            serverVersion: "錯誤",
          },
        },
      }));
    }
  };

  const refreshSessions = async () => {
    try {
      const list = await p2pService.listSessions();
      setActiveSessions(list);
    } catch (e) {
      console.error("Failed to list P2P sessions:", e);
    }
  };

  useEffect(() => {
    if (subNav === "p2p") {
      refreshSessions();
      const interval = setInterval(refreshSessions, 3000);
      return () => clearInterval(interval);
    }
  }, [subNav]);

  const handleAliasChange = (newAlias: string) => {
    setAlias(newAlias);
    localStorage.setItem("focusite_p2p_alias", newAlias);
  };

  const handleCreateHostRoom = async () => {
    setIsP2pLoading(true);
    setP2pError(null);
    try {
      await p2pService.startHost(
        activeInstance?.id || "instance",
        Number(hostPort) || 25565,
        alias
      );
      await refreshSessions();
    } catch (e: any) {
      setP2pError(String(e));
    } finally {
      setIsP2pLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!joinRoomCode.trim()) return;
    setIsP2pLoading(true);
    setP2pError(null);
    try {
      await p2pService.joinRoom(joinRoomCode.trim(), alias);
      setJoinRoomCode("");
      await refreshSessions();
    } catch (e: any) {
      setP2pError(String(e));
    } finally {
      setIsP2pLoading(false);
    }
  };

  const handleStopSession = async (sessionId: string) => {
    try {
      await p2pService.stopSession(sessionId);
      await refreshSessions();
    } catch (e: any) {
      console.error("Failed to stop session:", e);
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={subNav}
        custom={direction}
        variants={subTabVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="space-y-6 max-w-5xl w-full"
      >
        {/* 1. 主頁總覽 (Focusite 現代化高對比儀表板) */}
        {subNav === "overview" && (
          <>
            {!activeInstance ? (
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/80 to-[#0b0f17] p-8 shadow-2xl backdrop-blur-xl">
                <div className="max-w-xl space-y-3">
                  <Badge variant="outline" className="border-[#52A43A]/40 text-[#52A43A]">
                    快速入門
                  </Badge>
                  <h2 className="text-3xl font-extrabold tracking-tight text-white">
                    尚未建立任何 Minecraft 實例
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Focusite 採用完全隔離的獨立實例架構（存放於 instances/）與全域 CAS 硬連結儲存。點擊下方按鈕，自官方版本清單快速配置全新遊戲環境。
                  </p>
                </div>

                <div className="mt-6 flex items-center gap-4">
                  <Button
                    size="lg"
                    onClick={onCreateInstance}
                    className="gap-2 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] hover:from-[#469C2D] hover:to-[#357A21] font-semibold text-white shadow-lg shadow-[#3C8527]/30"
                  >
                    <Plus className="h-5 w-5" />
                    建立第一個實例
                  </Button>
                </div>
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-3xl border border-[#52A43A]/25 bg-gradient-to-br from-[#16330e]/70 via-slate-950/80 to-[#0b0f17]/95 p-8 shadow-2xl shadow-[#3C8527]/10 backdrop-blur-xl">
                {/* 裝飾性幾何光暈 */}
                <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-[#52A43A]/15 blur-3xl" />
                <div className="pointer-events-none absolute bottom-0 left-12 h-36 w-60 rounded-full bg-[#3C8527]/15 blur-2xl" />

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  {/* 左側實例基本概覽 */}
                  <div className="flex items-start gap-5">
                    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#3C8527] to-[#2E6B1D] text-white shadow-xl shadow-[#3C8527]/30 border border-white/20 overflow-hidden">
                      {activeInstance.hasIcon && activeInstance.iconPath ? (
                        <img
                          src={getIconSrc(activeInstance.iconPath)}
                          alt={activeInstance.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Package className="h-9 w-9 drop-shadow" />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="success" className="bg-[#3C8527] text-white text-[11px] font-mono shadow-sm">
                          MC {activeInstance.version}
                        </Badge>
                        <Badge variant="outline" className="border-white/15 bg-black/40 text-[11px] text-slate-200 backdrop-blur-sm">
                          {activeInstance.loader} {activeInstance.loaderVersion || ""}
                        </Badge>
                        {isRunning && (
                          <Badge className="bg-[#3C8527]/20 border-[#52A43A]/50 text-[#52A43A] text-[10px] gap-1.5 animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#52A43A]" />
                            運行中
                          </Badge>
                        )}
                      </div>

                      <h2 className="text-2xl font-black tracking-tight text-white drop-shadow">
                        {activeInstance.name}
                      </h2>

                      <p className="text-xs text-slate-300 line-clamp-1 max-w-lg">
                        {activeInstance.description || "CAS 尋址去重技術已啟用，實例模組與存檔完全獨立隔離。"}
                      </p>
                    </div>
                  </div>

                  {/* 右側呼叫行動群 (CTA) */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    {isRunning ? (
                      <Button
                        size="lg"
                        variant="destructive"
                        onClick={onKill}
                        className="gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm h-11 px-5 shadow-lg shadow-rose-950/40"
                      >
                        <Square className="h-4 w-4 fill-current" />
                        <span>
                          強制終止 (PID: {runningPid}
                          {runningAccountName ? ` • ${runningAccountName}` : ""})
                        </span>
                      </Button>
                    ) : isLaunching ? (
                      <Button
                        size="lg"
                        disabled
                        className="gap-2 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] opacity-80 cursor-wait text-white font-bold text-sm h-11 px-6 shadow-lg"
                      >
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>正在啟動實例...</span>
                      </Button>
                    ) : (
                      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Button
                          size="lg"
                          onClick={onLaunch}
                          className="w-full gap-2.5 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] hover:from-[#469C2D] hover:to-[#357A21] text-white font-bold text-sm h-11 px-7 rounded-xl shadow-xl shadow-[#3C8527]/35 ring-1 ring-white/20"
                        >
                          <Play className="h-4 w-4 fill-current" />
                          <span>立即啟動遊戲</span>
                        </Button>
                      </motion.div>
                    )}

                    {onGoToInstanceDetail && (
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={() => onGoToInstanceDetail(activeInstance.id)}
                        className="gap-1.5 text-xs h-11 px-4 border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 rounded-xl"
                      >
                        <span>管理實例</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* 實例快速捷徑列 */}
                <div className="mt-6 pt-5 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => instanceService.openInstanceDirectory(activeInstance.id, "minecraft")}
                      className="flex items-center gap-1.5 hover:text-white transition-colors"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-[#52A43A]" />
                      <span>開啟遊戲資料夾</span>
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={() => instanceService.openInstanceDirectory(activeInstance.id, "screenshots")}
                      className="flex items-center gap-1.5 hover:text-white transition-colors"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[#52A43A]" />
                      <span>查看遊戲截圖庫</span>
                    </button>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCreateInstance}
                    className="text-xs h-7 gap-1 text-slate-400 hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    建立新實例
                  </Button>
                </div>
              </div>
            )}

            {/* Core Feature Highlights Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <FeatureCard
                icon={<Layers className="h-5 w-5 text-[#52A43A]" />}
                title="CAS 內容尋址去重"
                description="各實例獨立隔離，共用之 Mod 與函式庫透過作業系統原生 Hardlink 映射，磁碟零重複佔用。"
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
          <div className="space-y-6">
            {/* Alias Configuration Header */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3C8527]/20 border border-[#52A43A]/30 text-[#52A43A]">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    P2P 玩家身份與廣播標識
                  </div>
                  <div className="text-xs text-slate-400">
                    此名稱將注入局域網 UDP 4445 廣播與房主 MOTD
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                <div className="flex items-center gap-2 w-full md:w-64">
                  <Input
                    type="text"
                    value={alias}
                    onChange={(e) => handleAliasChange(e.target.value)}
                    placeholder="輸入聯機暱稱..."
                    className="h-8 text-xs bg-black/30 border-white/10 text-slate-200 focus-visible:border-[#52A43A]"
                  />
                </div>
                <Badge className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-[11px] gap-1 shrink-0 py-1">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  使用者態免驅動
                </Badge>
              </div>
            </div>

            {p2pError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-300">
                連線錯誤：{p2pError}
              </div>
            )}

            {/* Join & Host Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Join Room Card */}
              <Card className="border-white/10 bg-white/5">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Radio className="h-5 w-5 text-[#52A43A]" />
                    <CardTitle className="text-base">加入好友房間</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    輸入房主提供的 6 位代碼，啟動器將於本機 127.0.0.1 建立虛擬反向代理並於局域網廣播。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={joinRoomCode}
                      onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                      placeholder="輸入 6 位房間碼 (例: FC-8F2B)"
                      className="h-9 text-xs font-mono bg-black/20 border-white/10 text-slate-100 placeholder-slate-500 focus-visible:border-[#52A43A]"
                    />
                    <Button
                      onClick={handleJoinRoom}
                      disabled={!joinRoomCode.trim() || isP2pLoading}
                      className="h-9 bg-[#3C8527] hover:bg-[#469C2D] text-white text-xs shrink-0 px-4"
                    >
                      {isP2pLoading ? "連線中..." : "加入房間"}
                    </Button>
                  </div>

                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    * 連線成功後，Minecraft「多人遊戲」清單底部的局域網世界將自動出現該房間。
                  </div>
                </CardContent>
              </Card>

              {/* Host Room Card */}
              <Card className="border-white/10 bg-white/5">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Server className="h-5 w-5 text-[#52A43A]" />
                    <CardTitle className="text-base">建立房主房間</CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    在 Minecraft 點擊「對局域網開放」後，輸入遊戲顯示的端口即可生成邀請代碼。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={hostPort}
                      onChange={(e) => setHostPort(Number(e.target.value) || 25565)}
                      placeholder="遊戲端口 (例如 25565)"
                      className="h-9 text-xs font-mono bg-black/20 border-white/10 text-slate-100 placeholder-slate-500 focus-visible:border-[#52A43A]"
                    />
                    <Button
                      onClick={handleCreateHostRoom}
                      disabled={isP2pLoading}
                      className="h-9 bg-[#3C8527] hover:bg-[#469C2D] text-white text-xs shrink-0 px-4"
                    >
                      {isP2pLoading ? "建立中..." : "建立同遊房間"}
                    </Button>
                  </div>

                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    * 採用 WebRTC SCTP 穿透技術，無須在路由器設定 Port Forwarding 或安裝虛擬網卡驅動。
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Active Tunnels Section */}
            {activeSessions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-[#52A43A]" />
                    <span className="text-sm font-semibold text-slate-200">
                      當前活躍之虛擬隧道 ({activeSessions.length})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={refreshSessions}
                    className="h-7 text-xs text-slate-400 hover:text-white gap-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重新整理
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeSessions.map((session) => {
                    const sessionId = session.sessionId || session.session_id || "";
                    const localAddress = `127.0.0.1:${session.localPort ?? session.local_port}`;
                    const isCopied = copiedId === sessionId;

                    return (
                      <div
                        key={sessionId}
                        className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono text-base font-bold text-slate-100">
                              {session.roomCode || session.room_code}
                            </span>
                            <Badge
                              className={
                                session.role === "host"
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 text-[10px]"
                                  : "bg-sky-500/10 border-sky-500/30 text-sky-400 text-[10px]"
                              }
                            >
                              {session.role === "host" ? "房主 (Host)" : "訪客 (Client)"}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[11px] font-mono text-emerald-400">
                              {session.latencyMs ?? session.latency_ms ?? 0} ms
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/30 border border-white/5 font-mono text-xs">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-400 uppercase font-sans">
                              本機代理位址 (Local Proxy)
                            </span>
                            <span className="text-slate-200 font-semibold">
                              {localAddress}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleVerifyHandshake(sessionId)}
                              disabled={handshakeResults[sessionId]?.loading}
                              className="h-7 text-xs gap-1 border-white/10 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                            >
                              <Activity className={`h-3 w-3 ${handshakeResults[sessionId]?.loading ? "animate-spin" : ""}`} />
                              <span>{handshakeResults[sessionId]?.loading ? "測試中..." : "握手測試"}</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopyText(localAddress, sessionId)}
                              className="h-7 text-xs gap-1 border-white/10 text-slate-300 hover:text-white"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" />
                                  <span>已複製</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>複製位址</span>
                                </>
                              )}
                            </Button>
                          </div>
                        </div>

                        {handshakeResults[sessionId]?.res && (
                          <div
                            className={`p-2 rounded-lg border text-[11px] font-mono leading-relaxed ${
                              handshakeResults[sessionId].res?.success
                                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                                : "bg-rose-950/40 border-rose-500/30 text-rose-300"
                            }`}
                          >
                            <div className="flex items-center justify-between font-sans font-semibold mb-0.5">
                              <span>
                                {handshakeResults[sessionId].res?.success
                                  ? "✓ Minecraft 握手成功"
                                  : "✕ 握手失敗"}
                              </span>
                              <span>
                                {handshakeResults[sessionId].res?.latencyMs} ms
                              </span>
                            </div>
                            <div className="truncate">
                              MOTD: {handshakeResults[sessionId].res?.motd}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
                          <span className="truncate max-w-[240px]">
                            廣播：[Focusite · {session.alias}]
                          </span>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleStopSession(sessionId)}
                            className="h-7 text-xs bg-rose-600/80 hover:bg-rose-600 text-white"
                          >
                            {session.role === "host" ? "關閉房間" : "中斷連線"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
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
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
      <Card className="hover:border-[#52A43A]/40 transition-colors border-white/10 bg-white/5 h-full">
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
    </motion.div>
  );
}
