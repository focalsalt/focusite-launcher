import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { authService, DeviceCodeInfo } from "@/services/authService";
import { UserAccount } from "@/types/navigation";
import { openUrl } from "@tauri-apps/plugin-opener";

interface AuthScreenProps {
  onLoginSuccess: (account: UserAccount) => void;
}

type ErrorCategory = "missing_config" | "expired" | "general";

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess }) => {
  const [stage, setStage] = useState<"welcome" | "device_code">("welcome");
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCategory, setErrorCategory] = useState<ErrorCategory | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [pollingStatus, setPollingStatus] = useState<string>("等待授權...");
  const pollTimerRef = useRef<number | null>(null);

  const startLoginFlow = async () => {
    setStage("device_code");
    setIsStarting(true);
    setErrorMessage(null);
    setErrorCategory(null);
    setDeviceInfo(null);
    setPollingStatus("正在向微軟申請裝置登入碼...");

    try {
      const info = await authService.startDeviceCode();
      setDeviceInfo(info);
      setPollingStatus("等待於瀏覽器輸入驗證碼...");
      startPolling(info.device_code, info.interval || 5);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isMissing =
        msg.toLowerCase().includes("client_id") ||
        msg.toLowerCase().includes("missingclientid");
      setErrorCategory(isMissing ? "missing_config" : "general");
      setErrorMessage(
        isMissing
          ? "未在 .env 檔案中檢測到 MICROSOFT_CLIENT_ID 配置。"
          : msg
      );
      setPollingStatus("啟動失敗");
    } finally {
      setIsStarting(false);
    }
  };

  const startPolling = (deviceCode: string, intervalSec: number) => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }

    pollTimerRef.current = window.setInterval(async () => {
      try {
        const result = await authService.pollDeviceCode(deviceCode);
        if (result.status === "success" && result.account) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          onLoginSuccess(result.account);
        } else if (result.status === "expired") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setErrorCategory("expired");
          setErrorMessage("裝置驗證代碼已超過有效期限，請重新獲取。");
        } else if (result.status === "error") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          const msg = result.error_message || "微軟驗證發生錯誤";
          const isMissing =
            msg.toLowerCase().includes("client_id") ||
            msg.toLowerCase().includes("missingclientid");
          setErrorCategory(isMissing ? "missing_config" : "general");
          setErrorMessage(msg);
        } else if (result.status === "pending") {
          setPollingStatus("等待使用者於微軟頁面同意授權...");
        }
      } catch (e: unknown) {
        console.error("Polling error:", e);
      }
    }, Math.max(intervalSec, 3) * 1000);
  };

  const handleOpenBrowser = async () => {
    if (!deviceInfo) return;
    // 自動將驗證代碼寫入使用者剪貼簿
    if (deviceInfo.user_code) {
      navigator.clipboard.writeText(deviceInfo.user_code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }

    // 開啟微軟官方指定之驗證入口 (https://www.microsoft.com/link)，維持原生乾淨 URL 嚴禁附加 ?otc= 參數
    const targetUrl = deviceInfo.verification_uri;

    try {
      await openUrl(targetUrl);
    } catch {
      window.open(targetUrl, "_blank");
    }
  };

  const handleCopyCode = () => {
    if (deviceInfo?.user_code) {
      navigator.clipboard.writeText(deviceInfo.user_code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleBackToWelcome = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setStage("welcome");
    setErrorMessage(null);
    setErrorCategory(null);
    setDeviceInfo(null);
  };

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#0B0F17] via-[#0E1524] to-[#080B12] select-none overflow-hidden relative">
      {/* Decorative ambient background glows */}
      <div className="absolute top-1/4 -left-20 w-80 h-80 rounded-full bg-[#3C8527]/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 w-80 h-80 rounded-full bg-[#52A43A]/10 blur-[100px] pointer-events-none" />

      <AnimatePresence mode="wait">
        {stage === "welcome" ? (
          <motion.div
            key="welcome-stage"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md space-y-6 text-center"
          >
            <div className="space-y-3">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-[#3C8527] to-[#2E6B1D] shadow-xl shadow-[#3C8527]/20 border border-white/20">
                <ShieldCheck className="h-9 w-9 text-white" />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight text-slate-100">
                    Focusite Launcher
                  </h1>
                  <Badge variant="outline" className="text-[10px] border-[#52A43A]/40 text-[#52A43A]">
                    v26.1.0
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">
                  次世代高效能 Minecraft 啟動器
                </p>
              </div>
            </div>

            <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
              <CardHeader className="pb-3 text-left">
                <CardTitle className="text-base text-slate-100">正版微軟帳號登入</CardTitle>
                <CardDescription className="text-xs text-slate-300 leading-relaxed">
                  Focusite 依據官方協議要求正版身分驗證。登入後即可啟用全域實例隔離、CAS 去重與高速下載。
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 pt-2">
                <Button
                  size="lg"
                  onClick={startLoginFlow}
                  className="w-full gap-2.5 bg-gradient-to-r from-[#3C8527] to-[#2E6B1D] hover:from-[#469C2D] hover:to-[#357A21] font-semibold text-white shadow-lg shadow-[#3C8527]/25"
                >
                  <KeyRound className="h-4 w-4" />
                  <span>以微軟帳號登入 (Device Code)</span>
                </Button>

                <div className="text-[11px] text-muted-foreground text-center leading-relaxed">
                  點擊後將產生專屬裝置授權代碼，無須在此輸入帳號密碼。
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="device-code-stage"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md"
          >
            <Card className="border-white/10 bg-slate-900/95 backdrop-blur-2xl shadow-2xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold text-slate-100">
                    微軟裝置代碼授權
                  </CardTitle>
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={handleBackToWelcome}
                    className="h-7 px-2 gap-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    <span>返回</span>
                  </Button>
                </div>
                <CardDescription className="text-xs text-slate-400">
                  請至微軟授權頁面確認身分完成登入。
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {errorMessage ? (
                  <div className="space-y-4 py-2">
                    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-950/30 p-3.5 text-xs text-red-200">
                      <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
                      <div className="space-y-1">
                        <p className="font-semibold">
                          {errorCategory === "missing_config"
                            ? "登入設定未完成"
                            : errorCategory === "expired"
                            ? "驗證代碼已逾時"
                            : "微軟驗證連線失敗"}
                        </p>
                        <p className="leading-relaxed text-red-300/90">{errorMessage}</p>
                      </div>
                    </div>

                    {errorCategory === "missing_config" && (
                      <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] font-mono text-slate-300">
                        <p className="text-muted-foreground mb-1"># 請在 .env 檔案中配置：</p>
                        <p className="text-[#52A43A]">MICROSOFT_CLIENT_ID=&lt;您的 Azure 應用程式識別碼&gt;</p>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="glass" size="sm" onClick={handleBackToWelcome}>
                        返回
                      </Button>
                      <Button
                        size="sm"
                        onClick={startLoginFlow}
                        disabled={isStarting}
                        className="gap-1.5 bg-[#3C8527] hover:bg-[#469C2D] text-white"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isStarting ? "animate-spin" : ""}`} />
                        {errorCategory === "expired"
                          ? "重新獲取代碼"
                          : errorCategory === "missing_config"
                          ? "重新檢測"
                          : "重新重試"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {isStarting && !deviceInfo && (
                      <div className="flex flex-col items-center justify-center py-8 space-y-3">
                        <RefreshCw className="h-6 w-6 animate-spin text-[#52A43A]" />
                        <p className="text-xs text-muted-foreground">{pollingStatus}</p>
                      </div>
                    )}

                    {deviceInfo && (
                      <div className="space-y-4">
                        <div className="space-y-2 text-center">
                          <span className="text-xs text-slate-400">您的微軟授權代碼：</span>
                          <div className="flex items-center justify-center gap-2">
                            <span className="font-mono text-2xl font-black tracking-widest text-[#52A43A] bg-black/60 px-4 py-2 rounded-xl border border-[#52A43A]/40 shadow-inner">
                              {deviceInfo.user_code}
                            </span>
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={handleCopyCode}
                              className="h-10 w-10 border-white/10 bg-white/5 hover:bg-white/10"
                            >
                              {isCopied ? (
                                <Check className="h-4 w-4 text-emerald-400" />
                              ) : (
                                <Copy className="h-4 w-4 text-slate-300" />
                              )}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 text-xs text-slate-300">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-200">1. 開啟微軟驗證頁面</span>
                            <Button
                              size="sm"
                              onClick={handleOpenBrowser}
                              className="gap-1.5 h-8 bg-[#3C8527] hover:bg-[#469C2D] text-white text-xs font-semibold shadow-md shadow-[#3C8527]/20"
                            >
                              <span>開啟頁面 (自動複製代碼)</span>
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            點擊將自動為您複製代碼並開啟微軟官方裝置驗證入口：
                            <span className="text-slate-400 block mt-0.5 font-mono">
                              {deviceInfo.verification_uri}
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-300">
                            2. 於瀏覽器頁面貼上代碼，並登入擁有 Minecraft 正版授權之微軟帳號。
                          </p>
                        </div>

                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#52A43A]" />
                          <span>{pollingStatus}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
