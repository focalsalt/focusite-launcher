import React, { useCallback, useEffect, useRef, useState } from "react";
import { toUserMessage } from "@/lib/errorMessage";
import { SIGNALING_SERVER } from "@/lib/signalingServer";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";
import {
  type Friend,
  type FriendAction,
  type FriendRequest,
  type FriendsSnapshot,
  friendsService,
} from "@/services/friendsService";
import { partyApi, partyService, type PartyInvite } from "@/services/partyService";
import { initWorldSharing } from "@/services/worldShare";
import type { UserAccount } from "@/types/navigation";
import { FriendsDrawer } from "./FriendsDrawer";

const SHARE_KEY = "focusite_share_presence";
/** The game polls every minute while the list is open and every five minutes otherwise. */
const POLL_OPEN_MS = 60_000;
const POLL_CLOSED_MS = 300_000;
/** Invites need to arrive quickly; this call only asks our own Worker, not the Minecraft service. */
const INVITE_POLL_MS = 15_000;

const readShare = (): boolean => {
  try {
    return localStorage.getItem(SHARE_KEY) !== "0";
  } catch {
    return true;
  }
};

/** App-wide friends list: mounted once in App so the drawer is available on every page. */
export const FriendsPanel: React.FC<{ account: UserAccount | null; visible: boolean }> = ({ account, visible }) => {
  const { t } = useI18n();
  const accountId = account?.id;
  const accountName = account?.username;
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState(readShare);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const friendsRef = useRef<Friend[]>([]);
  friendsRef.current = friends;
  const shareRef = useRef(share);
  shareRef.current = share;
  const reqRef = useRef(0);

  const notifyInvite = useCallback(
    (invite: PartyInvite) => toast(t.party.inviteReceived(invite.fromName), "info", 8000),
    [t],
  );

  const microsoft = account?.accountType === "microsoft";
  useEffect(() => {
    partyService.setAccount(microsoft && accountId && accountName ? { id: accountId, name: accountName } : null);
  }, [microsoft, accountId, accountName]);
  useEffect(() => initWorldSharing(), []);
  useEffect(() => {
    partyService.onKicked = () => toast(t.party.kicked, "info");
  }, [t]);

  // Invites only reach launchers that registered, which happens while we share our status.
  useEffect(() => {
    if (!microsoft || !accountId || !accountName || !share || !SIGNALING_SERVER) return;
    let stale = false;
    const poll = () =>
      partyApi
        .poll(accountId, SIGNALING_SERVER!, accountName, friendsRef.current.map((f) => f.profileId))
        .then((invites) => !stale && partyService.receiveInvites(invites, notifyInvite))
        .catch(() => undefined);
    const timer = window.setInterval(poll, INVITE_POLL_MS);
    return () => {
      stale = true;
      window.clearInterval(timer);
    };
  }, [microsoft, accountId, accountName, share, notifyInvite]);

  // Only an account change clears the lists; toggling sharing or the drawer must not reload them.
  useEffect(() => {
    reqRef.current++;
    setFriends([]);
    setIncoming([]);
    setOutgoing([]);
    setError(null);
  }, [accountId]);

  const fetchList = useCallback(() => {
    if (!accountId || account?.accountType !== "microsoft") return;
    const id = ++reqRef.current;
    const launcher = SIGNALING_SERVER && accountName ? { server: SIGNALING_SERVER, name: accountName } : null;
    // Show the loading state only when there is nothing to show yet.
    if (friendsRef.current.length === 0) setLoading(true);
    friendsService
      .list(accountId, shareRef.current, launcher)
      .then((list) => {
        if (id !== reqRef.current) return;
        setError(null);
        setFriends(list.friends);
        setIncoming(list.incoming);
        setOutgoing(list.outgoing);
        partyService.receiveInvites(list.invites, notifyInvite);
      })
      .catch((e) => id === reqRef.current && setError(toUserMessage(e)))
      .finally(() => id === reqRef.current && setLoading(false));
  }, [accountId, accountName, account?.accountType, notifyInvite]);

  useEffect(() => {
    fetchList();
    const timer = window.setInterval(fetchList, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    return () => window.clearInterval(timer);
  }, [fetchList, open]);

  // Switching sharing updates the list in place: off shows everyone offline (that is what the service
  // would answer), on refreshes silently in the background.
  const firstShareRun = useRef(true);
  useEffect(() => {
    if (firstShareRun.current) {
      firstShareRun.current = false;
      return;
    }
    reqRef.current++;
    setLoading(false);
    if (share) fetchList();
    else setFriends((prev) => prev.map((f) => ({ ...f, status: "OFFLINE", onLauncher: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share]);

  const applySnapshot = useCallback((snap: FriendsSnapshot) => {
    // Presence is not part of an action's answer, so people who stay on the list keep what we knew.
    setFriends((prev) => {
      const known = new Map(prev.map((f) => [f.profileId, f]));
      return snap.friends.map((f) => known.get(f.profileId) ?? { ...f, status: "OFFLINE", onLauncher: false });
    });
    setIncoming(snap.incoming);
    setOutgoing(snap.outgoing);
  }, []);

  /** Runs one friend action; true when the service accepted it. */
  const act = useCallback(
    async (action: FriendAction): Promise<boolean> => {
      if (!accountId) return false;
      setBusy(true);
      try {
        applySnapshot(await friendsService.act(accountId, action));
        if (action.kind === "add" && "name" in action) toast(t.party.requestSent(action.name), "success");
        return true;
      } catch (e) {
        toast(t.party.actionFailed(toUserMessage(e)), "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [accountId, applySnapshot, t],
  );

  const invite = useCallback(
    async (friend: Friend) => {
      const ok = await partyService.invite({ id: friend.profileId.replaceAll("-", ""), name: friend.name });
      if (!ok) toast(t.party.inviteFailed, "error");
    },
    [t],
  );

  const toggleShare = () =>
    setShare((v) => {
      try {
        localStorage.setItem(SHARE_KEY, v ? "0" : "1");
      } catch {
        // Not persisted; the choice still applies until the launcher closes.
      }
      return !v;
    });

  return (
    <FriendsDrawer
      open={open}
      visible={visible}
      onToggle={() => setOpen((o) => !o)}
      friends={friends}
      incoming={incoming}
      outgoing={outgoing}
      loading={loading}
      busy={busy}
      error={error}
      sharePresence={share}
      onToggleShare={toggleShare}
      onAct={act}
      onInvite={invite}
    />
  );
};
