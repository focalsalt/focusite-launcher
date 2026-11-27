import React, { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, RefreshCw, AlertCircle, Check } from "lucide-react";
import { UserAccount } from "@/types/navigation";
import { useI18n } from "@/i18n";
import { useDeviceCodeLogin } from "./useDeviceCodeLogin";
import { LoginSteps } from "./LoginSteps";

interface MicrosoftLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (account: UserAccount) => void;
}

export const MicrosoftLoginModal: React.FC<MicrosoftLoginModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { t } = useI18n();
  const {
    deviceInfo,
    isStarting,
    errorMessage,
    errorCategory,
    isCopied,
    pollingStatus,
    loginStep,
    start: startLoginFlow,
    stop,
    copyCode: handleCopyCode,
    openVerificationPage: handleOpenLink,
  } = useDeviceCodeLogin((account) => {
    onSuccess(account);
    onClose();
  });

  useEffect(() => {
    if (isOpen) startLoginFlow();
    else stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Once the Xbox / Minecraft chain runs, the dialog can no longer be dismissed.
  const verifying = loginStep !== null && !errorMessage;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !verifying && onClose()} preventBackdropClose>
      <DialogContent
        className="max-w-md border-white/10 bg-slate-900/95 text-slate-100 backdrop-blur-xl"
      >
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
            <div className="flex items-start gap-3 rounded-xl border border-danger-500/30 bg-danger-950/30 p-3.5 text-xs text-danger-200">
              <AlertCircle className="h-5 w-5 shrink-0 text-danger-400" />
              <div className="space-y-1">
                <p className="font-semibold">
                  {errorCategory === "missing_config"
                    ? t.auth.configIncomplete
                    : errorCategory === "expired"
                    ? t.auth.codeTimeout
                    : t.auth.connFailed}
                </p>
                <p className="leading-relaxed text-danger-300/90">{errorMessage}</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="glass" size="sm" onClick={onClose}>
                {t.auth.closeForNow}
              </Button>
              <Button
                size="sm"
                onClick={startLoginFlow}
                disabled={isStarting}
                className="gap-1.5 bg-brand hover:bg-brand-hover text-on-solid"
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
        ) : verifying ? (
          <LoginSteps step={loginStep!} />
        ) : (
          <div className="space-y-5 py-3">
            {isStarting && !deviceInfo && (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <RefreshCw className="h-6 w-6 animate-spin text-brand-light" />
                <p className="text-xs">{pollingStatus}</p>
              </div>
            )}

            {deviceInfo && (
              <>
                <div className="space-y-2 text-center">
                  <span className="text-xs text-slate-400">{t.auth.copyCode}</span>
                  <div className="flex items-center justify-center gap-3">
                    <span className="font-mono text-2xl font-black tracking-widest text-brand-light bg-scrim/50 px-4 py-2 rounded-xl border border-brand-light/30">
                      {deviceInfo.user_code}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={handleCopyCode}
                      className="h-10 w-10 border-white/10 bg-white/5 hover:bg-white/10"
                    >
                      {isCopied ? (
                        <Check className="h-4 w-4 text-success-400" />
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
                  <p className="text-2xs">
                    {t.auth.verifyEntry(deviceInfo.verification_uri)}
                  </p>
                  <p>{t.auth.step2b}</p>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs pt-1">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-light" />
                  <span>{pollingStatus}</span>
                </div>
              </>
            )}

            <div className="flex justify-center">
              <Button variant="glass" size="sm" onClick={onClose}>
                {t.common.cancel}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
