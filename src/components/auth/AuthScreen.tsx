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
import { openExternal } from "@/lib/openExternal";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useAppVersion } from "@/lib/useAppVersion";
import { useI18n } from "@/i18n";

interface AuthScreenProps {
  onLoginSuccess: (account: UserAccount) => void;
}

type ErrorCategory = "missing_config" | "expired" | "general";

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess }) => {
  const { t } = useI18n();
  const appVersion = useAppVersion();
  const [stage, setStage] = useState<"welcome" | "device_code">("welcome");
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCategory, setErrorCategory] = useState<ErrorCategory | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [pollingStatus, setPollingStatus] = useState<string>(t.auth.waiting);
  const pollTimerRef = useRef<number | null>(null);
  // Only the newest request may show its code; a second start (double click, StrictMode) must not swap it.
  const startSeqRef = useRef<number>(0);

  const startLoginFlow = async () => {
    const seq = ++startSeqRef.current;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setStage("device_code");
    setIsStarting(true);
    setErrorMessage(null);
    setErrorCategory(null);
    setDeviceInfo(null);
    setPollingStatus(t.auth.requestingCode);

    try {
      const info = await authService.startDeviceCode();
      if (seq !== startSeqRef.current) return;
      setDeviceInfo(info);
      setPollingStatus(t.auth.waitingBrowser);
      startPolling(info.device_code, info.interval || 5);
    } catch (err: unknown) {
      if (seq !== startSeqRef.current) return;
      const msg = toUserMessage(err);
      const isMissing =
        msg.toLowerCase().includes("client_id") ||
        msg.toLowerCase().includes("missingclientid");
      setErrorCategory(isMissing ? "missing_config" : "general");
      setErrorMessage(
        isMissing
          ? t.auth.missingClientId
          : msg
      );
      setPollingStatus(t.auth.startFailed);
    } finally {
      if (seq === startSeqRef.current) setIsStarting(false);
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
          setErrorMessage(t.auth.codeExpired);
        } else if (result.status === "error") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          const msg = result.error_message || t.auth.authError;
          const isMissing =
            msg.toLowerCase().includes("client_id") ||
            msg.toLowerCase().includes("missingclientid");
          setErrorCategory(isMissing ? "missing_config" : "general");
          setErrorMessage(msg);
        } else if (result.status === "pending") {
          setPollingStatus(t.auth.waitingConsent);
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
      toast(t.common.copied, "success");
    }

    // 開啟微軟官方指定之驗證入口 (https://www.microsoft.com/link)，維持原生乾淨 URL 嚴禁附加 ?otc= 參數
    const targetUrl = deviceInfo.verification_uri;

    await openExternal(targetUrl).catch((err) => console.error("Failed to open link:", err));
  };

  const handleCopyCode = () => {
    if (deviceInfo?.user_code) {
      navigator.clipboard.writeText(deviceInfo.user_code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast(t.common.copied, "success");
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
      startSeqRef.current++; // a code request still in flight must not start polling after unmount
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-canvas via-slate-900 to-canvas select-none overflow-hidden relative">
      {/* Decorative ambient background glows */}
      <div className="absolute top-1/4 -left-20 w-80 h-80 rounded-full bg-brand/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 w-80 h-80 rounded-full bg-brand-light/10 blur-[100px] pointer-events-none" />

      <AnimatePresence mode="popLayout">
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
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-brand to-brand-dark shadow-xl shadow-brand/20 border border-white/20">
                <ShieldCheck className="h-9 w-9 text-white" />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <h1 className="text-2xl font-black tracking-tight text-slate-100">
                    Focusite Launcher
                  </h1>
                  <Badge variant="outline" className="text-[10px] border-brand-light/40 text-brand-light">
                    {appVersion ? `v${appVersion}` : ""}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">
                  {t.auth.tagline}
                </p>
              </div>
            </div>

            <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
              <CardHeader className="pb-3 text-left">
                <CardTitle className="text-base text-slate-100">{t.auth.loginTitle}</CardTitle>
                <CardDescription className="text-xs text-slate-300 leading-relaxed">
                  {t.auth.loginDesc}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 pt-2">
                <Button
                  size="lg"
                  onClick={startLoginFlow}
                  className="w-full gap-2.5 bg-gradient-to-r from-brand to-brand-dark hover:from-brand-hover hover:to-brand-dark font-semibold text-white shadow-lg shadow-brand/25"
                >
                  <KeyRound className="h-4 w-4" />
                  <span>{t.auth.loginButton}</span>
                </Button>

                <div className="text-[11px] text-muted-foreground text-center leading-relaxed">
                  {t.auth.loginNote}
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
                    {t.auth.deviceCodeTitle}
                  </CardTitle>
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={handleBackToWelcome}
                    className="h-7 px-2 gap-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    <span>{t.auth.back}</span>
                  </Button>
                </div>
                <CardDescription className="text-xs text-slate-400">
                  {t.auth.confirmIdentity}
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
                            ? t.auth.configIncomplete
                            : errorCategory === "expired"
                            ? t.auth.codeTimeout
                            : t.auth.connFailed}
                        </p>
                        <p className="leading-relaxed text-red-300/90">{errorMessage}</p>
                      </div>
                    </div>

                    {errorCategory === "missing_config" && (
                      <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] font-mono text-slate-300">
                        <p className="text-muted-foreground mb-1">{t.auth.envHint}</p>
                        <p className="text-brand-light">{t.auth.envLine}</p>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="glass" size="sm" onClick={handleBackToWelcome}>
                        {t.auth.back}
                      </Button>
                      <Button
                        size="sm"
                        onClick={startLoginFlow}
                        disabled={isStarting}
                        className="gap-1.5 bg-brand hover:bg-brand-hover text-white"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isStarting ? "animate-spin" : ""}`} />
                        {errorCategory === "expired"
                          ? t.auth.refetchCode
                          : errorCategory === "missing_config"
                          ? t.auth.recheck
                          : t.common.retry}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {isStarting && !deviceInfo && (
                      <div className="flex flex-col items-center justify-center py-8 space-y-3">
                        <RefreshCw className="h-6 w-6 animate-spin text-brand-light" />
                        <p className="text-xs text-muted-foreground">{pollingStatus}</p>
                      </div>
                    )}

                    {deviceInfo && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className="space-y-4"
                      >
                        <div className="space-y-2 text-center">
                          <span className="text-xs text-slate-400">{t.auth.yourCode}</span>
                          <div className="flex items-center justify-center gap-2">
                            <span className="font-mono text-2xl font-black tracking-widest text-brand-light bg-black/60 px-4 py-2 rounded-xl border border-brand-light/40 shadow-inner">
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
                            <span className="font-medium text-slate-200">{t.auth.step1}</span>
                            <Button
                              size="sm"
                              onClick={handleOpenBrowser}
                              className="gap-1.5 h-8 bg-brand hover:bg-brand-hover text-white text-xs font-semibold shadow-md shadow-brand/20"
                            >
                              <span>{t.auth.openPage}</span>
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {t.auth.openPageHint}
                            <span className="text-slate-400 block mt-0.5 font-mono">
                              {deviceInfo.verification_uri}
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-300">
                            {t.auth.step2}
                          </p>
                        </div>

                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-light" />
                          <span>{pollingStatus}</span>
                        </div>
                      </motion.div>
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
