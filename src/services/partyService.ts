import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SIGNALING_SERVER } from "@/lib/signalingServer";
import { p2pService, type TurnServer } from "@/services/p2pService";
import { toUserMessage } from "@/lib/errorMessage";

export const MAX_CHAT_LINES = 100;

export interface PartyMember {
  /** Java profile id without dashes. */
  id: string;
  name: string;
  joinedAt: number;
  /** The sharer whose world this member plays in right now. */
  playing?: string | null;
}

export interface PartyInvite {
  from: string;
  fromName: string;
  party: string;
  /** Epoch milliseconds. */
  expires: number;
}

/** A mod of the shared world's instance; `side` comes from Modrinth and is "unknown" for files it does not know. */
export interface ShareMod {
  filename: string;
  sha1: string;
  size: number;
  side: "client" | "server" | "both" | "unknown";
  projectId?: string;
  versionId?: string;
  downloadUrl?: string;
}

/** The game setup behind a shared world: enough for another member to build a matching instance. */
export interface ShareSpec {
  /** The sharer's instance name; a guest names its copy the same. */
  instanceName: string;
  mcVersion: string;
  loader: string;
  loaderVersion?: string;
  /** Custom loaders only: the jar is fetched from the sharer through the tunnel. */
  customJar?: { filename: string; sha1: string; size: number };
  mods: ShareMod[];
}

export interface ShareInfo {
  by: string;
  spec: ShareSpec;
}

export type ChatLine =
  | { kind: "chat"; id: number; from: string; name: string; text: string }
  | { kind: "system"; id: number; code: SystemCode; name?: string; target?: string }
  | { kind: "invite"; id: number; invite: PartyInvite };

export type SystemCode = "joined" | "left" | "host" | "invited" | "joinOpen" | "joinClosed" | "connectFailed" | "shared" | "unshared" | "worldFailed";

export interface PartyState {
  /** "offline": the party server could not be reached; a retry is counting down in `retryIn`. */
  status: "idle" | "connecting" | "connected" | "offline";
  /** Seconds until the next connection attempt while offline. */
  retryIn: number;
  /** The connection in progress joins someone else's party (not a new one of our own). */
  joining: boolean;
  partyId: string | null;
  self: string | null;
  host: string | null;
  joinById: boolean;
  members: PartyMember[];
  lines: ChatLine[];
  /** The worlds members share right now (at most one per member). */
  shares: ShareInfo[];
  /** This computer's side of joining a shared world: asking, or linked through a tunnel to `with`. */
  world: { state: "idle" | "connecting" | "linked"; with: string | null };
}

interface Account {
  id: string;
  name: string;
}

const IDLE: PartyState = { status: "idle", retryIn: 0, joining: false, partyId: null, self: null, host: null, joinById: false, members: [], lines: [], shares: [], world: { state: "idle", with: null } };
/** Seconds between connection attempts while offline; the last value repeats. */
const RETRY_SECONDS = [3, 5, 10, 20, 30, 60] as const;
/** Letters and digits without look-alikes, so an ID read aloud is hard to get wrong. */
const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const newPartyId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ID_CHARS[b % ID_CHARS.length]).join("");

export const isPartyId = (value: string): boolean => /^[A-Za-z0-9]{6}$/.test(value.trim());

interface Credentials {
  uuid: string;
  secret: string;
}

/** Messages the Worker sends; see PartyRoom in server/signaling. */
type ServerMessage =
  | { type: "welcome"; self: string; host: string; joinById: boolean; members: PartyMember[]; shares: ShareInfo[] }
  | { type: "joined"; member: PartyMember }
  | { type: "left"; id: string }
  | { type: "host"; id: string }
  | { type: "joinById"; value: boolean }
  | { type: "chat"; from: string; name: string; text: string }
  | { type: "invited"; by: string; to: string; toName: string }
  | { type: "share"; by: string; spec: ShareSpec }
  | { type: "unshare"; by: string }
  | { type: "playing"; id: string; with: string | null }
  | { type: "rtc"; from: string; kind: "want" | "offer" | "answer" | "fail"; data: string };

/** One party at a time, held for as long as the launcher runs. */
class PartyService {
  private state: PartyState = IDLE;
  private listeners = new Set<() => void>();
  private account: Account | null = null;
  private socket: WebSocket | null = null;
  private nextLine = 1;
  /** Invites already shown, so a repeated poll never shows one twice. */
  private seen = new Set<string>();
  /** Set by the app: the host removed this computer from the party. */
  onKicked: () => void = () => undefined;
  /** The world this computer shares (its LAN port and instance), while `share.by` is us. */
  private local: { port: number; instanceId: string | null } | null = null;
  /** Tunnel sessions: `host:<guest id>` for each guest of our shared world, `join:<sharer id>` for the world we joined. */
  private peers = new Map<string, string>();
  /** The sharer this computer asked to join and has not heard back from. */
  private wanted: string | null = null;
  /** Why the last connection attempt failed, shown next to the failure message. */
  private lastError = "";
  private turnCache: { at: number; servers: TurnServer[] } | null = null;
  /** Failed attempts in a row, which picks the next wait; reset by a successful connection. */
  private attempt = 0;
  private retryTimer: number | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PartyState => this.state;

  private set(patch: Partial<PartyState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private addLine(line: DistributiveOmit<ChatLine, "id">): void {
    const lines = [...this.state.lines, { ...line, id: this.nextLine++ } as ChatLine].slice(-MAX_CHAT_LINES);
    this.set({ lines });
  }

  /** Signing in as someone else (or out) ends the current party. */
  setAccount(account: Account | null): void {
    if (this.account?.id === account?.id) {
      this.account = account;
      return;
    }
    this.leave();
    this.attempt = 0;
    this.account = account;
    this.seen.clear();
  }

  get isConfigured(): boolean {
    return SIGNALING_SERVER !== null && this.account !== null;
  }

  private async credentials(fresh: boolean): Promise<Credentials> {
    if (!this.account || !SIGNALING_SERVER) throw new Error("not configured");
    return invoke<Credentials>("party_credentials", {
      accountId: this.account.id,
      launcher: { server: SIGNALING_SERVER, name: this.account.name },
      fresh,
    });
  }

  /**
   * Opens the connection to `partyId`. Before the welcome message a close means the Worker said no (browsers
   * hide the reason): the secret may be stale, so it retries once with a new login, then gives up.
   */
  private async connect(partyId: string, create: boolean): Promise<boolean> {
    if (!SIGNALING_SERVER) return false;
    this.lastError = "";
    this.leave();
    this.set({ ...IDLE, status: "connecting", joining: !create, partyId });
    for (const fresh of [false, true]) {
      let creds: Credentials;
      try {
        creds = await this.credentials(fresh);
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        break;
      }
      if (this.state.partyId !== partyId) return false; // left or switched meanwhile
      if (await this.open(partyId, create, creds)) return true;
    }
    if (this.state.partyId === partyId) {
      this.set(IDLE);
      // Our own party failing is shown by the offline screen; only a failed join needs a chat line.
      if (!create) this.addLine({ kind: "system", code: "connectFailed", target: toUserMessage(this.lastError) });
    }
    return false;
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) window.clearInterval(this.retryTimer);
    this.retryTimer = null;
  }

  /** The party server is unreachable: show the offline state and retry after 3, 5, 10, 20, 30, then every 60 seconds. */
  private goOffline(): void {
    this.clearRetry();
    if (!this.isConfigured || this.state.status !== "idle") return;
    const wait = RETRY_SECONDS[Math.min(this.attempt, RETRY_SECONDS.length - 1)];
    this.attempt++;
    this.set({ status: "offline", retryIn: wait });
    this.retryTimer = window.setInterval(() => {
      const left = this.state.retryIn - 1;
      if (left > 0) {
        this.set({ retryIn: left });
        return;
      }
      this.clearRetry();
      void this.create();
    }, 1000);
  }

  private open(partyId: string, create: boolean, creds: Credentials): Promise<boolean> {
    return new Promise((resolve) => {
      const params = new URLSearchParams({ member: creds.uuid });
      if (create) params.set("create", "1");
      const url = `${SIGNALING_SERVER!.replace(/^https:/, "wss:")}/p/${partyId}?${params.toString()}`;
      const socket = new WebSocket(url, [`focusite.${creds.secret}`]);
      let welcomed = false;
      socket.onmessage = (event) => {
        const msg = parseServerMessage(event.data);
        if (!msg) return;
        if (msg.type === "welcome") {
          welcomed = true;
          this.attempt = 0;
          this.clearRetry();
          this.socket = socket;
          this.set({
            status: "connected",
            joining: false,
            partyId,
            self: msg.self,
            host: msg.host,
            joinById: msg.joinById,
            members: msg.members,
            lines: [],
            shares: msg.shares,
            world: { state: "idle", with: null },
          });
          resolve(true);
        } else if (welcomed) {
          this.onMessage(msg);
        }
      };
      socket.onclose = (event) => {
        if (!welcomed) {
          this.lastError = `WebSocket closed (${event.code})`;
          return resolve(false);
        }
        if (this.socket !== socket) return;
        this.socket = null;
        this.set(IDLE);
        if (event.code === 4003) this.onKicked();
        // The party is gone (server restart, network drop): build a new one right away. If that cannot
        // connect either, create() switches to the offline state and keeps retrying.
        else if (this.isConfigured) void this.create();
      };
      socket.onerror = () => undefined; // onclose follows and carries the outcome
    });
  }

  private onMessage(msg: ServerMessage): void {
    const members = this.state.members;
    const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "";
    switch (msg.type) {
      case "joined":
        this.set({ members: [...members.filter((m) => m.id !== msg.member.id), msg.member] });
        this.addLine({ kind: "system", code: "joined", name: msg.member.name });
        break;
      case "left":
        this.set({ members: members.filter((m) => m.id !== msg.id) });
        this.dropPeer(msg.id);
        this.addLine({ kind: "system", code: "left", name: nameOf(msg.id) });
        break;
      case "host":
        this.set({ host: msg.id });
        this.addLine({ kind: "system", code: "host", name: nameOf(msg.id) });
        break;
      case "joinById":
        this.set({ joinById: msg.value });
        this.addLine({ kind: "system", code: msg.value ? "joinOpen" : "joinClosed" });
        break;
      case "chat":
        this.addLine({ kind: "chat", from: msg.from, name: msg.name, text: msg.text });
        break;
      case "invited":
        this.addLine({ kind: "system", code: "invited", name: nameOf(msg.by), target: msg.toName });
        break;
      case "share":
        this.set({ shares: [...this.state.shares.filter((s) => s.by !== msg.by), { by: msg.by, spec: msg.spec }] });
        if (msg.by !== this.state.self) this.addLine({ kind: "system", code: "shared", name: nameOf(msg.by) });
        break;
      case "unshare":
        this.endShare(msg.by);
        this.addLine({ kind: "system", code: "unshared", name: nameOf(msg.by) });
        break;
      case "playing":
        this.set({ members: members.map((m) => (m.id === msg.id ? { ...m, playing: msg.with } : m)) });
        break;
      case "rtc":
        this.onRtc(msg);
        break;
    }
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** Starts a new party; a Party ID that is already taken is replaced by another one. */
  async create(): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      if (await this.connect(newPartyId(), true)) return true;
      // Only a taken ID is worth another try; a failed login retried here would just hit the Mojang rate limit.
      if (!this.lastError.startsWith("WebSocket")) break;
    }
    this.goOffline();
    return false;
  }

  /** Joins by Party ID (the host must have allowed it) or by an invite. */
  join(partyId: string): Promise<boolean> {
    return this.connect(partyId.trim().toUpperCase(), false);
  }

  /** Tunnel relays for NAT traversal; empty when the Worker has none (then only STUN is used). */
  private async turn(): Promise<TurnServer[]> {
    if (this.turnCache && Date.now() - this.turnCache.at < 3600_000) return this.turnCache.servers;
    const servers =
      this.account && SIGNALING_SERVER
        ? await p2pService.iceServers(this.account.id, SIGNALING_SERVER, this.account.name).catch(() => [])
        : [];
    this.turnCache = { at: Date.now(), servers };
    return servers;
  }

  private closePeer(key: string): void {
    const session = this.peers.get(key);
    this.peers.delete(key);
    if (session) void p2pService.stopSession(session).catch(() => undefined);
  }

  /** Closes every tunnel with this member, in either direction. */
  private dropPeer(id: string): void {
    this.closePeer(`host:${id}`);
    this.closePeer(`join:${id}`);
  }

  private closeAllPeers(): void {
    for (const key of [...this.peers.keys()]) this.closePeer(key);
  }

  /** A shared world is gone (its owner stopped or left): close its tunnels, and ours if it was the one shared here. */
  private endShare(by: string): void {
    this.set({ shares: this.state.shares.filter((s) => s.by !== by) });
    this.closePeer(`join:${by}`);
    if (this.wanted === by) this.wanted = null;
    if (this.state.world.with === by) this.set({ world: { state: "idle", with: null } });
    if (by === this.state.self) {
      for (const key of [...this.peers.keys()]) if (key.startsWith("host:")) this.closePeer(key);
      this.local = null;
    }
  }

  /** Shares the world this computer opened to LAN on `port` with the party. */
  share(spec: ShareSpec, port: number, instanceId: string | null): void {
    this.local = { port, instanceId };
    this.send({ type: "share", spec });
  }

  unshare(): void {
    this.send({ type: "unshare" });
  }

  /** Asks `sharer` for a tunnel; the sharer answers with an offer through the party. */
  requestJoin(sharer: string): void {
    const share = this.state.shares.find((s) => s.by === sharer);
    if (!share || sharer === this.state.self || this.state.world.state !== "idle") return;
    this.wanted = sharer;
    this.set({ world: { state: "connecting", with: sharer } });
    this.send({ type: "rtc", to: sharer, kind: "want", data: "" });
    window.setTimeout(() => {
      if (this.wanted === sharer) this.worldFailed();
    }, 30_000);
  }

  /** The tunnel session of the world this computer joined, if any. */
  joinedSession(): string | null {
    const sharer = this.state.world.with;
    return sharer ? (this.peers.get(`join:${sharer}`) ?? null) : null;
  }

  /** Leaves the world this computer joined. */
  leaveWorld(): void {
    const sharer = this.state.world.with;
    if (!sharer) return;
    this.closePeer(`join:${sharer}`);
    this.wanted = null;
    this.set({ world: { state: "idle", with: null } });
    this.send({ type: "playing", with: null });
  }

  private worldFailed(): void {
    this.wanted = null;
    if (this.state.world.state === "connecting") this.set({ world: { state: "idle", with: null } });
    this.addLine({ kind: "system", code: "worldFailed" });
  }

  private onRtc(msg: Extract<ServerMessage, { type: "rtc" }>): void {
    const { from, kind, data } = msg;
    const name = this.account?.name ?? "Player";
    const mine = this.state.shares.some((s) => s.by === this.state.self);
    void (async () => {
      try {
        if (kind === "want" && this.local && mine) {
          this.closePeer(`host:${from}`);
          const res = await p2pService.createOffer(this.local.instanceId, this.local.port, name, await this.turn());
          this.peers.set(`host:${from}`, res.session.sessionId);
          // A custom loader jar is the one file a guest may ask for through the tunnel.
          const files = this.local.instanceId ? await invoke<Record<string, string>>("instance_share_files", { instanceId: this.local.instanceId }) : {};
          if (Object.keys(files).length > 0) await p2pService.serveFiles(res.session.sessionId, files);
          this.send({ type: "rtc", to: from, kind: "offer", data: res.code });
        } else if (kind === "offer" && this.wanted === from) {
          this.wanted = null;
          this.closePeer(`join:${from}`);
          const res = await p2pService.joinWithOffer(data, await this.turn());
          this.peers.set(`join:${from}`, res.session.sessionId);
          this.set({ world: { state: "linked", with: from } });
          this.send({ type: "playing", with: from });
          this.send({ type: "rtc", to: from, kind: "answer", data: res.code });
        } else if (kind === "answer") {
          const session = this.peers.get(`host:${from}`);
          if (session) await p2pService.applyAnswer(session, data);
        } else if (kind === "fail" && this.wanted === from) {
          this.worldFailed();
        }
      } catch {
        if (kind === "want") this.send({ type: "rtc", to: from, kind: "fail", data: "" });
        else this.worldFailed();
      }
    })();
  }

  leave(): void {
    this.clearRetry();
    this.closeAllPeers();
    this.local = null;
    this.wanted = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    if (this.state !== IDLE) this.set(IDLE);
  }

  /** Invites a friend; starts a party first when this computer is not in one. */
  async invite(friend: { id: string; name: string }): Promise<boolean> {
    if (this.state.status === "connecting") return false;
    if (this.state.status === "idle" && !(await this.create())) return false;
    this.send({ type: "invite", to: friend.id, toName: friend.name });
    return true;
  }

  chat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.send({ type: "chat", text: trimmed });
  }

  kick(id: string): void {
    this.send({ type: "kick", id });
  }

  transfer(id: string): void {
    this.send({ type: "transfer", to: id });
  }

  setJoinById(value: boolean): void {
    this.send({ type: "joinById", value });
  }

  /** Shows invites from the inbox once; `notify` is called for each new one (the app shows a toast). */
  receiveInvites(invites: PartyInvite[], notify: (invite: PartyInvite) => void): void {
    const now = Date.now();
    for (const invite of invites) {
      const key = `${invite.party}:${invite.from}`;
      if (invite.expires <= now || this.seen.has(key) || invite.party === this.state.partyId) continue;
      this.seen.add(key);
      this.addLine({ kind: "invite", invite });
      notify(invite);
    }
  }

  /** Removes an invite line after the player answered it. */
  dismissInvite(lineId: number): void {
    this.set({ lines: this.state.lines.filter((l) => l.id !== lineId) });
  }
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

const parseServerMessage = (data: unknown): ServerMessage | null => {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data) as ServerMessage;
    return typeof msg === "object" && msg !== null && typeof msg.type === "string" ? msg : null;
  } catch {
    return null;
  }
};

export const partyService = new PartyService();

export const useParty = (): PartyState => useSyncExternalStore(partyService.subscribe, partyService.getSnapshot);

/** Friends poll: invites arrive within this long of being sent. */
export const partyApi = {
  poll: (accountId: string, server: string, name: string, friendIds: string[]): Promise<PartyInvite[]> =>
    invoke<PartyInvite[]>("party_poll", { accountId, launcher: { server, name }, friendIds }),
};
