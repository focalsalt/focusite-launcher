import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronDown,
  UserPlus,
  RefreshCw,
  Shirt,
  LogOut,
  Check,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { UserAccount } from "@/types/navigation";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { preloadSkinManagerView, preloadMicrosoftLoginModal } from "@/lib/startupOrchestrator";
import { useI18n } from "@/i18n";

interface AccountDropdownProps {
  accounts: UserAccount[];
  activeAccount: UserAccount;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onOpenSkinManager: () => void;
  onSignOut: (accountId: string) => void;
}

export const AccountDropdown: React.FC<AccountDropdownProps> = ({
  accounts,
  activeAccount,
  onSelectAccount,
  onAddAccount,
  onOpenSkinManager,
  onSignOut,
}) => {
  const { t } = useI18n();
  const isVerified = activeAccount.accountType === "microsoft" && activeAccount.hasValidToken !== false;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);

  const updatePosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const menuHeight = 280;
      const spaceBelow = window.innerHeight - rect.bottom;
      const shouldFlip = spaceBelow < menuHeight && rect.top > menuHeight;

      setCoords({
        left: rect.left + 8,
        width: Math.max(rect.width - 16, 240),
        top: shouldFlip ? rect.top - menuHeight - 4 : rect.bottom + 4,
      });
    }
  }, []);

  const handleToggle = () => {
    if (!isOpen) {
      updatePosition();
    }
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, updatePosition]);

  return (
    <div ref={containerRef} className="relative h-14 w-full">
      {/* Trigger Button: Fills the entire h-14 header and aligns with Titlebar */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex h-14 w-full select-none items-center justify-between px-4 transition-colors hover:bg-white/5 active:bg-white/10"
      >
        <div className="flex min-w-0 items-center gap-3">
          {/* Avatar / Head indicator in Focusite Green */}
          <div className="relative shrink-0">
            <PlayerAvatar username={activeAccount.username} size={32} />
            <span
              className={`absolute bottom-0 right-0 h-2.5 w-2.5 translate-x-px translate-y-px rounded-full border-2 border-slate-900 ${
                isVerified
                  ? "bg-emerald-400"
                  : "bg-amber-400"
              }`}
            />
          </div>

          {/* User details */}
          <div className="flex flex-col text-left min-w-0">
            <span className="truncate text-xs font-bold tracking-tight text-slate-100">
              {activeAccount.username}
            </span>
            <div className="flex items-center gap-1 text-[10px]">
              {isVerified ? (
                <>
                  <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span className="text-emerald-400 font-medium truncate">
                    {t.account.premiumReady}
                  </span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3 w-3 text-amber-400 shrink-0" />
                  <span className="text-amber-400 font-medium truncate">
                    {activeAccount.accountType === "microsoft" ? t.account.needsRelogin : t.account.offlineMode}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-brand-light" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu Panel via Portal */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && coords && (
              <motion.div
                ref={dropdownRef}
                style={{
                  position: "fixed",
                  left: coords.left,
                  top: coords.top,
                  width: coords.width,
                }}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="z-[9999] overflow-hidden rounded-xl border border-white/15 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-2xl select-none"
              >
                {/* Account List Header */}
                <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                  {t.account.signedInList}
                </div>

                {/* List of Accounts inside custom ScrollArea */}
                <ScrollArea className="max-h-40 pr-1">
                  <div className="space-y-0.5">
                    {accounts.map((acc) => {
                      const isSelected = acc.id === activeAccount.id;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            onSelectAccount(acc.id);
                            setIsOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                            isSelected
                              ? "bg-brand/20 text-brand-light font-medium"
                              : "text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <PlayerAvatar username={acc.username} size={20} className="rounded" />
                            <span className="truncate">{acc.username}</span>
                          </div>
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 text-brand-light shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>

                <div className="my-1.5 h-px bg-white/10" />

                {/* Action Items */}
                <div className="space-y-0.5 text-xs">
                  <button
                    type="button"
                    onMouseEnter={preloadMicrosoftLoginModal}
                    onClick={() => {
                      onAddAccount();
                      setIsOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <UserPlus className="h-3.5 w-3.5 text-brand-light shrink-0" />
                    <span>{t.account.addMicrosoft}</span>
                  </button>

                  <button
                    type="button"
                    onMouseEnter={preloadSkinManagerView}
                    onClick={() => {
                      onOpenSkinManager();
                      setIsOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <Shirt className="h-3.5 w-3.5 text-brand-light shrink-0" />
                    <span>{t.account.skinManager}</span>
                  </button>

                  {activeAccount.accountType === "microsoft" && !isVerified && (
                    <button
                      type="button"
                      onClick={() => {
                        onAddAccount();
                        setIsOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-amber-300 hover:bg-white/10 transition-colors"
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                      <span>{t.account.relogin}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      onSignOut(activeAccount.id);
                      setIsOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5 shrink-0" />
                    <span>{t.account.signOut}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};
