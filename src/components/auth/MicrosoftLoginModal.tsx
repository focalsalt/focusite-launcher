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
import { openUrl } from "@tauri-apps/plugin-opener";

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
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCategory, setErrorCategory] = useState<ErrorCategory | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [pollingStatus, setPollingStatus] = useState<string>("等待授權...");
  const pollTimerRef = useRef<number | null>(null);

  const startLoginFlow = async () => {
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
          onSuccess(result.account);
          onClose();
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

  useEffect(() => {
    if (isOpen) {
      startLoginFlow();
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
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
    }
  };

  const handleOpenLink = async () => {
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-white/10 bg-slate-900/95 text-slate-100 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-100">
            微軟正版帳號登入 (Device Code)
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            遵循微軟 OAuth 2.0 官方規範，透過裝置代碼安全授權，無須輸入帳號密碼。
          </DialogDescription>
        </DialogHeader>

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
              <Button variant="glass" size="sm" onClick={onClose}>
                暫時關閉
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
          <div className="space-y-5 py-3">
            {isStarting && !deviceInfo && (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <RefreshCw className="h-6 w-6 animate-spin text-[#52A43A]" />
                <p className="text-xs text-muted-foreground">{pollingStatus}</p>
              </div>
            )}

            {deviceInfo && (
              <>
                <div className="space-y-2 text-center">
                  <span className="text-xs text-slate-400">請複製以下授權代碼：</span>
                  <div className="flex items-center justify-center gap-3">
                    <span className="font-mono text-2xl font-black tracking-widest text-[#52A43A] bg-black/50 px-4 py-2 rounded-xl border border-[#52A43A]/30">
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
                    <span>1. 開啟微軟授權驗證頁面</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleOpenLink}
                      className="gap-1.5 h-8 border-white/10 bg-white/5 hover:bg-white/10 text-xs"
                    >
                      <span>開啟頁面 (自動複製代碼)</span>
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    驗證入口：{deviceInfo.verification_uri}
                  </p>
                  <p>2. 貼上上方代碼並登入擁有 Minecraft 正版授權的微軟帳號。</p>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#52A43A]" />
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
