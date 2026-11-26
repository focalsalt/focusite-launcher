import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Check, Eye, EyeOff, Send, UserMinus, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useParty } from "@/services/partyService";
import type { Friend, FriendAction, FriendRequest, PresenceStatus } from "@/services/friendsService";

interface FriendsDrawerProps {
  open: boolean;
  /** Only the friend-connection page shows the drawer; elsewhere it slides away. */
  visible: boolean;
  onToggle: () => void;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  loading: boolean;
  /** An action is in flight; the game also makes players wait between actions. */
  busy: boolean;
  error: string | null;
  sharePresence: boolean;
  onToggleShare: () => void;
  /** Resolves true when the action went through. */
  onAct: (action: FriendAction) => Promise<boolean>;
  /** Invites a friend who runs the launcher to the party. */
  onInvite: (friend: Friend) => void;
}

type Tab = "friends" | "requests";

const DRAWER_WIDTH = 288;
/** Height of the custom window bar, which stays on top and holds the window controls. */
const WINDOW_BAR_HEIGHT = 36;
/** The game's friends button caps its pending-request badge here. */
const MAX_BADGE = 5;
const SPRING = { type: "spring", stiffness: 420, damping: 40 } as const;

const isOnline = (status: PresenceStatus): boolean => status !== "OFFLINE";

const ICON_BUTTON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40";

/**
 * Collapsible overlay on the right edge of the whole window, laid out like the Java Edition friends list:
 * online friends first. It is portalled to body because page transitions use transforms, which would
 * otherwise make `fixed` relative to the page instead of the window.
 */
export const FriendsDrawer: React.FC<FriendsDrawerProps> = ({
  open: openProp,
  visible,
  onToggle,
  friends,
  incoming,
  outgoing,
  loading,
  busy,
  error,
  sharePresence,
  onToggleShare,
  onAct,
  onInvite,
}) => {
  const open = openProp && visible;
  const { t } = useI18n();
  const party = useParty();
  const [tab, setTab] = useState<Tab>("friends");
  const [name, setName] = useState("");
  const [removing, setRemoving] = useState<Friend | null>(null);

  const toggleRef = useRef<HTMLButtonElement>(null);

  const statusText = (status: PresenceStatus): string => {
    switch (status) {
      case "OFFLINE":
        return t.party.offline;
      case "PLAYING_OFFLINE":
        return t.party.playingWorld;
      case "PLAYING_REALMS":
        return t.party.playingRealms;
      case "PLAYING_SERVER":
        return t.party.playingServer;
      case "PLAYING_HOSTED_SERVER":
        return t.party.playing;
      default:
        return t.party.online;
    }
  };

  // Without sharing the service reports nobody's status, so online-first ordering would be meaningless.
  const sorted = [...friends].sort(
    (a, b) =>
      (sharePresence ? Number(isOnline(b.status)) - Number(isOnline(a.status)) : 0) || a.name.localeCompare(b.name),
  );
  const pending = incoming.length;
  const badge = pending > MAX_BADGE ? `${MAX_BADGE}+` : String(pending);

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = name.trim();
    if (!target || busy) return;
    if (await onAct({ kind: "add", name: target })) setName("");
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const target = removing;
    setRemoving(null);
    await onAct({ kind: "remove", profileId: target.profileId });
  };

  const tabButton = (id: Tab, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
        tab === id ? "border-brand-light text-white" : "border-transparent text-slate-400 hover:text-slate-200"
      }`}
    >
      {label}
      {count ? (
        <span className="rounded-full bg-brand px-1.5 text-3xs font-bold leading-4 text-white">{count}</span>
      ) : null}
    </button>
  );

  const requestRow = (r: FriendRequest, actions: React.ReactNode) => (
    <div key={r.profileId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
      <PlayerAvatar username={r.name} size={28} />
      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{r.name}</p>
      {actions}
    </div>
  );

  return createPortal(
    <>
      <motion.aside
        initial={false}
        animate={{ x: open ? 0 : DRAWER_WIDTH }}
        transition={SPRING}
        style={{ width: DRAWER_WIDTH, top: WINDOW_BAR_HEIGHT }}
        className="fixed bottom-0 right-0 z-40 flex flex-col border-l border-white/10 bg-slate-950/85 backdrop-blur-md"
        aria-hidden={!open}
        inert={!open}
        aria-label={t.party.friendsCount(friends.length)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key !== "Escape" || removing) return;
          onToggle();
          toggleRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Users className="h-4 w-4 text-brand-light" />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
            {t.party.friendsCount(friends.length)}
          </h3>
          <Tip label={sharePresence ? t.party.shareOn : t.party.shareOff} side="bottom">
            <button
              type="button"
              onClick={onToggleShare}
              aria-label={sharePresence ? t.party.shareOn : t.party.shareOff}
              className={ICON_BUTTON}
            >
              {sharePresence ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </Tip>
        </div>

        <div className="flex border-b border-white/10">
          {tabButton("friends", t.party.tabFriends)}
          {tabButton("requests", t.party.tabRequests, pending)}
        </div>

        {tab === "friends" && (
          <form onSubmit={submitAdd} className="flex gap-1.5 border-b border-white/10 p-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.party.addPlaceholder}
              maxLength={16}
              className="h-8 border-white/10 bg-black/30 text-xs"
            />
            <Tip label={t.party.addFriend} side="bottom">
              <Button
                type="submit"
                size="sm"
                disabled={busy || !name.trim()}
                aria-label={t.party.addFriend}
                className="h-8 w-8 bg-brand p-0 text-white hover:bg-brand-light"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </Tip>
          </form>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
          {loading && friends.length === 0 && <p className="p-2 text-xs text-slate-400">{t.party.loading}</p>}
          {error && <p className="p-2 text-xs text-rose-300">{t.party.loadFailed(error)}</p>}

          {tab === "friends" && (
            <>
              {!loading && !error && sorted.length === 0 && <p className="p-2 text-xs text-slate-400">{t.party.noFriends}</p>}
              {sorted.map((f) => (
                <div key={f.profileId} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <div className="relative shrink-0">
                    <PlayerAvatar username={f.name} size={28} />
                    {f.onLauncher && (
                      <Tip label={t.party.launcherBadge} className="absolute -left-1 -top-1">
                        <img src="/focusite-icon.svg" alt={t.party.launcherBadge} className="h-3.5 w-3.5 rounded-sm ring-2 ring-slate-950" />
                      </Tip>
                    )}
                    {sharePresence && isOnline(f.status) && (
                      <Tip label={statusText(f.status)} className="absolute -bottom-0.5 -right-0.5">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950" />
                      </Tip>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-slate-100">{f.name}</p>
                    {sharePresence && (
                      <p className={`text-2xs ${isOnline(f.status) ? "text-emerald-400" : "text-slate-400"}`}>
                        {statusText(f.status)}
                      </p>
                    )}
                  </div>
                  {sharePresence && f.onLauncher && !party.members.some((m) => m.id === f.profileId.replaceAll("-", "")) && (
                    <Tip label={t.party.invite}>
                      <button
                        type="button"
                        disabled={party.status === "connecting"}
                        onClick={() => onInvite(f)}
                        aria-label={t.party.invite}
                        className={`${ICON_BUTTON} opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </Tip>
                  )}
                  <Tip label={t.party.removeFriend}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRemoving(f)}
                      aria-label={t.party.removeFriend}
                      className={`${ICON_BUTTON} opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  </Tip>
                </div>
              ))}
            </>
          )}

          {tab === "requests" && (
            <>
              {!loading && !error && pending === 0 && outgoing.length === 0 && (
                <p className="p-2 text-xs text-slate-400">{t.party.noRequests}</p>
              )}
              {incoming.length > 0 && (
                <h4 className="px-2 pt-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                  {t.party.incomingTitle}
                </h4>
              )}
              {incoming.map((r) =>
                requestRow(
                  r,
                  <div className="flex gap-0.5">
                    <Tip label={t.party.accept}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onAct({ kind: "add", profileId: r.profileId })}
                        aria-label={t.party.accept}
                        className={`${ICON_BUTTON} text-emerald-400`}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </Tip>
                    <Tip label={t.party.decline}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onAct({ kind: "remove", profileId: r.profileId })}
                        aria-label={t.party.decline}
                        className={`${ICON_BUTTON} text-rose-300`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </Tip>
                  </div>,
                ),
              )}
              {outgoing.length > 0 && (
                <h4 className="px-2 pt-2 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                  {t.party.outgoingTitle}
                </h4>
              )}
              {outgoing.map((r) =>
                requestRow(
                  r,
                  <Tip label={t.party.cancelRequest}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onAct({ kind: "remove", profileId: r.profileId })}
                      aria-label={t.party.cancelRequest}
                      className={ICON_BUTTON}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Tip>,
                ),
              )}
            </>
          )}
          </div>
        </ScrollArea>
      </motion.aside>

      <Tip label={open ? t.party.hideFriends : t.party.showFriends}>
        <motion.button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          initial={false}
          animate={{ x: !visible ? 80 : open ? -DRAWER_WIDTH : 0, opacity: visible ? 1 : 0 }}
          inert={!visible}
          transition={SPRING}
          onClick={onToggle}
          aria-label={open ? t.party.hideFriends : t.party.showFriends}
          style={{ bottom: 24, pointerEvents: visible ? undefined : "none" }}
          className="fixed right-0 z-50 flex h-11 w-10 items-center justify-center rounded-l-xl border border-r-0 border-brand-light/40 bg-brand text-white shadow-lg shadow-black/40 transition-colors hover:bg-brand-hover"
        >
          {open ? <X className="h-5 w-5" /> : <Users className="h-5 w-5" />}
          {!open && pending > 0 && (
            <span className="absolute -left-2 -top-1.5 min-w-4 rounded-full bg-brand px-1 text-center text-3xs font-bold leading-4 text-white">
              {badge}
            </span>
          )}
        </motion.button>
      </Tip>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="max-w-sm border-white/10 bg-slate-900/98 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">{t.party.removeTitle(removing?.name ?? "")}</DialogTitle>
            <DialogDescription className="text-xs text-slate-400">{t.party.removeBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setRemoving(null)} className="border-white/10 bg-white/5 text-xs">
              {t.party.keep}
            </Button>
            <Button size="sm" onClick={() => void confirmRemove()} variant="destructive" className="text-xs">
              {t.party.removeFriend}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
    document.body,
  );
};
