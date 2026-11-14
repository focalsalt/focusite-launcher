import React, { useEffect, useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, RefreshCw, AlertCircle, Check } from "lucide-react";
import { authService, DeviceCodeInfo } from "@/services/authService";
import { UserAccount } from "@/types/navigation";
import { openExternal } from "@/lib/openExternal";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";

interface MicrosoftLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (account: UserAccount) => void;
}

type ErrorCategory = "missing_config" | "expired" | "general";

export const MicrosoftLoginModal: React.FC<MicrosoftLoginModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { t } = useI18n();
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
          onSuccess(result.account);
          onClose();
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

  useEffect(() => {
    if (isOpen) {
      startLoginFlow();
    } else {
      startSeqRef.current++;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      startSeqRef.current++; // a code request still in flight must not start polling after close
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen]);

  const handleCopyCode = () => {
    if (deviceInfo?.user_code) {
      navigator.clipboard.writeText(deviceInfo.user_code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast(t.common.copied, "success");
    }
  };

  const handleOpenLink = async () => {
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-white/10 bg-slate-900/95 text-slate-100 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-100">
            {t.auth.modalTitle}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            {t.auth.modalDesc}
          </DialogDescription>
        </DialogHeader>

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
              <Button variant="glass" size="sm" onClick={onClose}>
                {t.auth.closeForNow}
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
          <div className="space-y-5 py-3">
            {isStarting && !deviceInfo && (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <RefreshCw className="h-6 w-6 animate-spin text-brand-light" />
                <p className="text-xs text-muted-foreground">{pollingStatus}</p>
              </div>
            )}

            {deviceInfo && (
              <>
                <div className="space-y-2 text-center">
                  <span className="text-xs text-slate-400">{t.auth.copyCode}</span>
                  <div className="flex items-center justify-center gap-3">
                    <span className="font-mono text-2xl font-black tracking-widest text-brand-light bg-black/50 px-4 py-2 rounded-xl border border-brand-light/30">
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
                    <span>{t.auth.step1b}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleOpenLink}
                      className="gap-1.5 h-8 border-white/10 bg-white/5 hover:bg-white/10 text-xs"
                    >
                      <span>{t.auth.openPage}</span>
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t.auth.verifyEntry(deviceInfo.verification_uri)}
                  </p>
                  <p>{t.auth.step2b}</p>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-light" />
                  <span>{pollingStatus}</span>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
