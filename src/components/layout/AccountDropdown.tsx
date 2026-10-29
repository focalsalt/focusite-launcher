import React, { useState, useRef, useEffect } from "react";
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

interface AccountDropdownProps {
  accounts: UserAccount[];
  activeAccount: UserAccount;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onOpenSkinManager: () => void;
  onSignOut: (accountId: string) => void;
}

import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { preloadSkinManagerView, preloadMicrosoftLoginModal } from "@/lib/startupOrchestrator";

export const AccountDropdown: React.FC<AccountDropdownProps> = ({
  accounts,
  activeAccount,
  onSelectAccount,
  onAddAccount,
  onOpenSkinManager,
  onSignOut,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative h-14 w-full">
      {/* Trigger Button: Fills the entire h-14 header and aligns with Titlebar */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-14 w-full select-none items-center justify-between px-4 transition-colors hover:bg-white/5 active:bg-white/10"
      >
        <div className="flex items-center gap-3 overflow-hidden">
          {/* Avatar / Head indicator in Focusite Green */}
          <div className="relative shrink-0">
            <PlayerAvatar username={activeAccount.username} size={32} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-900 ${
                activeAccount.accountType === "microsoft"
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
              {activeAccount.accountType === "microsoft" ? (
                <>
                  <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span className="text-emerald-400 font-medium truncate">
                    微軟正版已就緒
                  </span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3 w-3 text-amber-400 shrink-0" />
                  <span className="text-amber-400 font-medium truncate">
                    離線模式
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            isOpen ? "rotate-180 text-[#52A43A]" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-2 right-2 top-[calc(100%+4px)] z-50 overflow-hidden rounded-xl border border-white/15 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-2xl"
          >
            {/* Account List Header */}
            <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              已登入帳號清單
            </div>

            {/* List of Accounts */}
            <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
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
                        ? "bg-[#3C8527]/20 text-[#52A43A] font-medium"
                        : "text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <PlayerAvatar username={acc.username} size={20} className="rounded" />
                      <span className="truncate">{acc.username}</span>
                    </div>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-[#52A43A] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

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
                <UserPlus className="h-3.5 w-3.5 text-[#52A43A] shrink-0" />
                <span>新增微軟正版帳號</span>
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
                <Shirt className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                <span>外觀與披風管理</span>
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>重新驗證憑證</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onSignOut(activeAccount.id);
                  setIsOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span>登出此帳號</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
