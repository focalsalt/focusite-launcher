import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { friendsService } from "@/services/friendsService";
import type { UserAccount } from "@/types/navigation";
import { FriendEntry, FriendsDrawer } from "./FriendsDrawer";

/** App-wide friends list: mounted once in App so the drawer is available on every page. */
export const FriendsPanel: React.FC<{ account: UserAccount | null }> = ({ account }) => {
  const { t } = useI18n();
  const accountId = account?.id;
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFriends([]);
    setError(null);
    if (!accountId || account?.accountType !== "microsoft") return;
    let stale = false;
    setLoading(true);
    friendsService
      .listXuids(accountId)
      .then((xuids) => {
        // shortcut: only XUIDs are known so far, so rows show a placeholder name and no presence;
        // swap in Java profile names and presence once those Xbox calls are wired.
        if (!stale) setFriends(xuids.map((x) => ({ id: x, name: t.party.friendFallback(x.slice(-4)), online: false })));
      })
      .catch((e) => !stale && setError(toUserMessage(e)))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [accountId, account?.accountType, t]);

  return (
    <FriendsDrawer open={open} onToggle={() => setOpen((o) => !o)} friends={friends} loading={loading} error={error} />
  );
};
