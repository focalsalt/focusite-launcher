import { useEffect, useRef, useState } from "react";
import { authService } from "@/services/authService";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { UserAccount } from "@/types/navigation";

/** Signed-in accounts, the active one, and the "add account" login modal. */
export function useAccounts() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>("");
  // Microsoft device code modal, for adding accounts when already signed in.
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);

  const fallbackAccount: UserAccount = {
    id: "guest",
    username: t.app.noAccount,
    accountType: "microsoft",
    isReady: false,
    hasValidToken: false,
    isActive: true,
  };
  const activeAccount =
    accounts.find((a) => a.id === activeAccountId) || accounts[0] || fallbackAccount;

  // The stored status is never proof of a live login: verify the active Microsoft account on start,
  // on switch, when the window regains focus, and every 10 minutes (the backend refreshes silently).
  const hasAccounts = accounts.length > 0;
  // A check that started before a sign-in finished holds the old, expired login: its result must be dropped.
  const loginEpochRef = useRef(0);
  const loginOpenRef = useRef(false);
  loginOpenRef.current = isLoginModalOpen;
  useEffect(() => {
    if (!hasAccounts || !activeAccountId) return;
    let last = 0;
    const verify = () => {
      if (loginOpenRef.current || Date.now() - last < 60_000) return;
      last = Date.now();
      const epoch = loginEpochRef.current;
      authService.refreshProfile(activeAccountId).then((updated) => {
        if (updated && epoch === loginEpochRef.current) updateAccount(updated);
      });
    };
    verify();
    const timer = window.setInterval(verify, 10 * 60_000);
    window.addEventListener("focus", verify);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", verify);
    };
  }, [activeAccountId, hasAccounts]);

  const updateAccount = (updated: UserAccount) => {
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  /** The very first sign-in, from the auth screen. */
  const signInFirstAccount = (account: UserAccount) => {
    setAccounts([account]);
    setActiveAccountId(account.id);
  };

  /** A sign-in from the modal; it becomes the active account. */
  const addAccount = (account: UserAccount) => {
    loginEpochRef.current++;
    setAccounts((prev) => {
      const filtered = prev.filter((a) => a.id !== account.id);
      return [account, ...filtered.map((a) => ({ ...a, isActive: false }))];
    });
    setActiveAccountId(account.id);
  };

  const selectAccount = (id: string) => {
    setActiveAccountId(id);
    authService.setActiveAccount(id).catch((err) => toast(toUserMessage(err), "error"));
    setAccounts((prev) =>
      prev.map((acc) => ({
        ...acc,
        isActive: acc.id === id,
      }))
    );
  };

  const signOut = async (id: string) => {
    try {
      await authService.removeAccount(id);
    } catch (err) {
      toast(toUserMessage(err), "error");
      return;
    }
    const remaining = accounts.filter((a) => a.id !== id);
    setAccounts(remaining);
    if (activeAccountId === id) {
      if (remaining.length > 0) {
        setActiveAccountId(remaining[0].id);
        authService.setActiveAccount(remaining[0].id).catch((err) => toast(toUserMessage(err), "error"));
      } else {
        setActiveAccountId("");
        setIsLoginModalOpen(true);
      }
    }
  };

  return {
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
  };
}
