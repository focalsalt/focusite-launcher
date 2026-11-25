import { invoke } from "@tauri-apps/api/core";
import type { PartyInvite } from "@/services/partyService";

/** Names are the ones the game uses (`PresenceStatus` in authlib); UNKNOWN is a newer status, treated as online. */
export type PresenceStatus =
  | "ONLINE"
  | "PLAYING_OFFLINE"
  | "PLAYING_REALMS"
  | "PLAYING_SERVER"
  | "PLAYING_HOSTED_SERVER"
  | "OFFLINE"
  | "UNKNOWN";

export interface Friend {
  profileId: string;
  name: string;
  status: PresenceStatus;
  /** Also running this launcher right now (only known while we share our own status). */
  onLauncher: boolean;
}

/** A pending request, in either direction. */
export interface FriendRequest {
  profileId: string;
  name: string;
}

export interface FriendsList {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  /** Party invites from friends that were waiting for us. */
  invites: PartyInvite[];
}

/** What a friend action returns: the new lists, without presence. */
export interface FriendsSnapshot {
  friends: FriendRequest[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export interface LauncherConfig {
  server: string;
  name: string;
}

export type FriendAction =
  /** Send a request to a player by name. */
  | { kind: "add"; name: string }
  /** Accept a received request. */
  | { kind: "add"; profileId: string }
  /** Remove a friend, decline a received request or cancel a sent one. */
  | { kind: "remove"; profileId: string };

export const friendsService = {
  /** Java Edition friends. With `sharePresence` off we post nothing, so every status comes back OFFLINE. */
  list: (accountId: string, sharePresence: boolean, launcher: LauncherConfig | null): Promise<FriendsList> =>
    invoke<FriendsList>("friends_list", { accountId, sharePresence, launcher }),
  act: (accountId: string, action: FriendAction): Promise<FriendsSnapshot> =>
    invoke<FriendsSnapshot>("friends_act", { accountId, action }),
};
