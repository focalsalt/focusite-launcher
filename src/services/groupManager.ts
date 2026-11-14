import { useSyncExternalStore } from "react";
import { GroupInfo, groupSocketProtocol, groupSocketUrl, isGroupToken, isMemberId, normalizeServer, randomHex } from "@/lib/groupInvite";
import { toUserMessage } from "@/lib/errorMessage";
import { decideSignal } from "@/lib/groupSignal";
import { p2pService } from "@/services/p2pService";

export type LinkState = "connecting" | "online" | "offline";

export interface Share {
  label: string;
  port: number;
}

export interface GroupMember {
  id: string;
  name: string;
  share: Share | null;
}

/** What this computer shares into one group. `instanceId` is only used to label the tunnel session. */
export interface MyShare extends Share {
  instanceId: string | null;
}

export interface GroupView {
  info: GroupInfo;
  link: LinkState;
  members: GroupMember[];
  myShare: MyShare | null;
  /** Hosts this computer is joining, as host member id -> session id. */
  joined: Record<string, string>;
  /** Hosts whose tunnel is still being set up. */
  pending: string[];
  /** Friends connected to this computer's share, as member id -> session id. */
  hosted: Record<string, string>;
}

const GROUPS_KEY = "focusite_groups";
const MEMBER_KEY = "focusite_member_id";
const ALIAS_KEY = "focusite_p2p_alias";
const PENDING_TIMEOUT_MS = 30_000;

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the groups simply do not survive a restart.
  }
};

const loadMemberId = (): string => {
  const saved = readStorage(MEMBER_KEY);
  if (isMemberId(saved)) return saved;
  const fresh = randomHex(16);
  writeStorage(MEMBER_KEY, fresh);
  return fresh;
};

const loadGroups = (): GroupInfo[] => {
  try {
    const raw = JSON.parse(readStorage(GROUPS_KEY) ?? "[]") as GroupInfo[];
    return raw.filter((g) => isMemberId(g.id) && normalizeServer(g.server) && isGroupToken(g.token));
  } catch {
    return [];
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** One live connection to a group's room on the signaling server, with automatic reconnect. */
class Link {
  link: LinkState = "connecting";
  members = new Map<string, GroupMember>();
  myShare: MyShare | null = null;
  joined = new Map<string, string>();
  hosted = new Map<string, string>();
  pending = new Map<string, number>();
  /** Members whose last message is still being handled. */
  busy = new Set<string>();
  private socket: WebSocket | null = null;
  private attempts = 0;
  private timer: number | undefined;
  private closed = false;

  constructor(
    readonly info: GroupInfo,
    private readonly manager: GroupManager,
  ) {}

  open(): void {
    if (this.closed) return;
    this.setLink("connecting");
    const name = readStorage(ALIAS_KEY)?.trim() || "Player";
    const socket = new WebSocket(groupSocketUrl(this.info, this.manager.memberId, name), groupSocketProtocol(this.info));
    this.socket = socket;
    socket.onmessage = (event) => this.onMessage(event.data);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.members.clear();
      this.setLink("offline");
      if (!this.closed) {
        this.timer = window.setTimeout(() => this.open(), Math.min(1000 * 2 ** this.attempts, 15000));
        this.attempts += 1;
      }
    };
  }

  send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.timer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private setLink(state: LinkState): void {
    this.link = state;
    this.manager.emit();
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(msg)) return;
    switch (msg.type) {
      case "welcome":
        this.attempts = 0;
        this.members.clear();
        for (const m of Array.isArray(msg.members) ? msg.members : []) this.putMember(m);
        if (this.myShare) this.send({ type: "share", share: { label: this.myShare.label, port: this.myShare.port } });
        this.setLink("online");
        break;
      case "joined":
        this.putMember(msg.member);
        this.manager.emit();
        break;
      case "share": {
        const member = typeof msg.id === "string" ? this.members.get(msg.id) : undefined;
        if (member) {
          member.share = isRecord(msg.share) ? (msg.share as unknown as Share) : null;
          // A host that stopped sharing ends the tunnel that depended on it.
          if (!member.share) void this.manager.endJoined(this.info.id, member.id);
          this.manager.emit();
        }
        break;
      }
      case "left":
        if (typeof msg.id === "string") {
          this.members.delete(msg.id);
          void this.manager.endJoined(this.info.id, msg.id);
          void this.manager.endHosted(this.info.id, msg.id);
          this.manager.emit();
        }
        break;
      case "signal":
        if (typeof msg.from === "string") void this.manager.onSignal(this.info.id, msg.from, msg.data);
        break;
    }
  }

  private putMember(value: unknown): void {
    if (!isRecord(value) || !isMemberId(value.id) || value.id === this.manager.memberId) return;
    this.members.set(value.id, {
      id: value.id,
      name: typeof value.name === "string" ? value.name : "Player",
      share: isRecord(value.share) ? (value.share as unknown as Share) : null,
    });
  }
}

class GroupManager {
  readonly memberId = loadMemberId();
  private links = new Map<string, Link>();
  private listeners = new Set<() => void>();
  private snapshot: GroupView[] = [];
  private started = false;
  onError: (message: string) => void = () => undefined;

  /** Connects every saved group. Safe to call repeatedly; connections live as long as the app. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const info of loadGroups()) this.attach(info);
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GroupView[] => this.snapshot;

  emit(): void {
    this.snapshot = [...this.links.values()].map((l) => ({
      info: l.info,
      link: l.link,
      members: [...l.members.values()],
      myShare: l.myShare,
      joined: Object.fromEntries(l.joined),
      pending: [...l.pending.keys()],
      hosted: Object.fromEntries(l.hosted),
    }));
    for (const listener of this.listeners) listener();
  }

  private attach(info: GroupInfo): void {
    if (this.links.has(info.id)) return;
    const link = new Link(info, this);
    this.links.set(info.id, link);
    link.open();
  }

  private persist(): void {
    writeStorage(GROUPS_KEY, JSON.stringify([...this.links.values()].map((l) => l.info)));
  }

  /** Creates a brand new group on `server` and connects to it. */
  create(name: string, server: string): GroupInfo | null {
    const origin = normalizeServer(server);
    if (!origin) return null;
    const info: GroupInfo = { id: randomHex(16), name: name.trim().slice(0, 32) || "Group", server: origin, token: randomHex(24) };
    this.attach(info);
    this.persist();
    this.emit();
    return info;
  }

  /** Joins a group from a decoded invite. Returns false when it is already saved. */
  add(info: GroupInfo): boolean {
    if (this.links.has(info.id)) return false;
    this.attach(info);
    this.persist();
    this.emit();
    return true;
  }

  async remove(groupId: string): Promise<void> {
    const link = this.links.get(groupId);
    if (!link) return;
    await this.stopShare(groupId);
    for (const id of [...link.joined.keys()]) await this.endJoined(groupId, id);
    link.close();
    this.links.delete(groupId);
    this.persist();
    this.emit();
  }

  startShare(groupId: string, share: MyShare): void {
    const link = this.links.get(groupId);
    if (!link) return;
    link.myShare = share;
    link.send({ type: "share", share: { label: share.label, port: share.port } });
    this.emit();
  }

  async stopShare(groupId: string): Promise<void> {
    const link = this.links.get(groupId);
    if (!link?.myShare) return;
    link.myShare = null;
    link.send({ type: "share", share: null });
    for (const id of [...link.hosted.keys()]) await this.endHosted(groupId, id);
    this.emit();
  }

  /** Asks a member that shares a world to open a tunnel to this computer. */
  join(groupId: string, hostId: string): void {
    const link = this.links.get(groupId);
    if (!link || link.pending.has(hostId)) return;
    link.pending.set(
      hostId,
      window.setTimeout(() => {
        if (link.pending.delete(hostId)) this.emit();
      }, PENDING_TIMEOUT_MS),
    );
    link.send({ type: "signal", to: hostId, data: { kind: "join" } });
    this.emit();
  }

  async endJoined(groupId: string, hostId: string): Promise<void> {
    const link = this.links.get(groupId);
    const session = link?.joined.get(hostId);
    if (!link || !session) return;
    link.joined.delete(hostId);
    await p2pService.stopSession(session).catch(() => undefined);
    this.emit();
  }

  async endHosted(groupId: string, memberId: string): Promise<void> {
    const link = this.links.get(groupId);
    const session = link?.hosted.get(memberId);
    if (!link || !session) return;
    link.hosted.delete(memberId);
    await p2pService.stopSession(session).catch(() => undefined);
    this.emit();
  }

  /** Connection data from another member: join request (host), offer (guest) or answer (host). */
  async onSignal(groupId: string, from: string, data: unknown): Promise<void> {
    const link = this.links.get(groupId);
    if (!link) return;
    const action = decideSignal(
      {
        sharing: link.myShare !== null,
        waitingForOffer: link.pending.has(from),
        hostedSession: link.hosted.get(from),
        busy: link.busy.has(from),
      },
      data,
    );
    if (action.type === "ignore") return;
    link.busy.add(from);
    try {
      if (action.type === "make-offer" && link.myShare) {
        await this.endHosted(groupId, from);
        const alias = readStorage(ALIAS_KEY)?.trim() || "Player";
        const res = await p2pService.createOffer(link.myShare.instanceId, link.myShare.port, alias);
        link.hosted.set(from, res.session.sessionId);
        link.send({ type: "signal", to: from, data: { kind: "offer", code: res.code } });
      } else if (action.type === "accept-offer") {
        window.clearTimeout(link.pending.get(from));
        await this.endJoined(groupId, from);
        const res = await p2pService.joinWithOffer(action.code);
        link.joined.set(from, res.session.sessionId);
        link.pending.delete(from);
        link.send({ type: "signal", to: from, data: { kind: "answer", code: res.code } });
      } else if (action.type === "apply-answer") {
        await p2pService.applyAnswer(action.session, action.code);
      }
    } catch (e) {
      link.pending.delete(from);
      this.onError(toUserMessage(e));
    } finally {
      link.busy.delete(from);
    }
    this.emit();
  }

  /** Forgets tunnels whose session no longer exists (the backend removes failed or closed ones). */
  reconcile(liveSessionIds: ReadonlySet<string>): void {
    let changed = false;
    for (const link of this.links.values()) {
      for (const map of [link.joined, link.hosted]) {
        for (const [member, session] of map) {
          if (!liveSessionIds.has(session)) {
            map.delete(member);
            changed = true;
          }
        }
      }
    }
    if (changed) this.emit();
  }
}

export const groupManager = new GroupManager();

export const useGroups = (): GroupView[] => useSyncExternalStore(groupManager.subscribe, groupManager.getSnapshot);
