import { useCallback, useEffect, useRef, useState } from "react";
import { authService, DeviceCodeInfo } from "@/services/authService";
import { UserAccount } from "@/types/navigation";
import { openExternal } from "@/lib/openExternal";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";

export type ErrorCategory = "missing_config" | "expired" | "general";

const isMissingClientId = (msg: string) => /client_id|missingclientid/i.test(msg);

/**
 * Microsoft device-code login shared by the welcome screen and the add-account dialog: requests a code,
 * then polls until the user approves it in the browser.
 */
export function useDeviceCodeLogin(onSuccess: (account: UserAccount) => void) {
  const { t } = useI18n();
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCategory, setErrorCategory] = useState<ErrorCategory | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<string>(t.auth.waiting);
  const timerRef = useRef<number | null>(null);
  // Bumped by every start and stop: a request or poll from an older round must not touch the state.
  const roundRef = useRef(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const stop = useCallback(() => {
    roundRef.current++;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const showError = (msg: string, category: ErrorCategory) => {
    setErrorCategory(category);
    setErrorMessage(msg);
  };

  const start = async () => {
    stop();
    const round = roundRef.current;
    setIsStarting(true);
    setErrorMessage(null);
    setErrorCategory(null);
    setDeviceInfo(null);
    setPollingStatus(t.auth.requestingCode);

    try {
      const info = await authService.startDeviceCode();
      if (round !== roundRef.current) return;
      setDeviceInfo(info);
      setPollingStatus(t.auth.waitingBrowser);

      let delayMs = Math.max(info.interval || 5, 3) * 1000;
      // The next poll is scheduled only after this one finished: a successful poll runs the whole
      // Xbox/Minecraft login and can take longer than the interval, and an overlapping poll would
      // report the already-used code as an error.
      const poll = async () => {
        timerRef.current = null;
        const result = await authService.pollDeviceCode(info.device_code).catch((e: unknown) => {
          console.error("Polling error:", e);
          return null;
        });
        if (round !== roundRef.current) return;
        if (result?.status === "success" && result.account) {
          stop();
          onSuccessRef.current(result.account);
          return;
        }
        if (result?.status === "expired") return showError(t.auth.codeExpired, "expired");
        if (result?.status === "error") {
          const msg = result.error_message || t.auth.authError;
          return isMissingClientId(msg)
            ? showError(t.auth.missingClientId, "missing_config")
            : showError(toUserMessage(msg), "general");
        }
        if (result?.status === "pending") setPollingStatus(t.auth.waitingConsent);
        // RFC 8628: slow_down asks for 5 more seconds between polls.
        if (result?.status === "slow_down") delayMs += 5000;
        timerRef.current = window.setTimeout(poll, delayMs);
      };
      timerRef.current = window.setTimeout(poll, delayMs);
    } catch (err: unknown) {
      if (round !== roundRef.current) return;
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (isMissingClientId(rawMsg)) showError(t.auth.missingClientId, "missing_config");
      else showError(toUserMessage(err), "general");
      setPollingStatus(t.auth.startFailed);
    } finally {
      if (round === roundRef.current) setIsStarting(false);
    }
  };

  /** Stops polling and clears the code and any error. */
  const reset = () => {
    stop();
    setErrorMessage(null);
    setErrorCategory(null);
    setDeviceInfo(null);
  };

  const copyCode = () => {
    if (!deviceInfo?.user_code) return;
    navigator.clipboard.writeText(deviceInfo.user_code);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast(t.common.copied, "success");
  };

  /** Copies the code, then opens Microsoft's own entry page (kept clean: no `?otc=` parameter). */
  const openVerificationPage = async () => {
    if (!deviceInfo) return;
    copyCode();
    await openExternal(deviceInfo.verification_uri).catch((err) => console.error("Failed to open link:", err));
  };

  // A request still in flight must not start polling after unmount.
  useEffect(() => stop, [stop]);

  return {
    deviceInfo,
    isStarting,
    errorMessage,
    errorCategory,
    isCopied,
    pollingStatus,
    start,
    stop,
    reset,
    copyCode,
    openVerificationPage,
  };
}
