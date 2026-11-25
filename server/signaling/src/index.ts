import { DurableObject } from "cloudflare:workers";
import {
  allowMessage,
  allowWithin,
  INVITE_TTL_MS,
  isId,
  MAX_INVITES_PER_MINUTE,
  MAX_LAUNCHER_BODY_BYTES,
  MAX_MEMBERS,
  MAX_PENDING_INVITES,
  type MessageBudget,
  normalizePartyId,
  parseClientMessage,
  parseLoginBody,
  parseSyncBody,
  parseVerifyBody,
  readTokenProtocol,
  sameHex,
  sha256Hex,
} from "./protocol.ts";

interface Env {
  PARTY: DurableObjectNamespace<PartyRoom>;
  LAUNCHER: DurableObjectNamespace<LauncherPresence>;
  /** Launcher login and sync requests per IP. */
  LAUNCHER_LIMIT?: RateLimit;
  /** Connection attempts per IP; the free plan has no dashboard rate limiting, so the Worker does it. */
  CONNECT_LIMIT?: RateLimit;
  /** Brand new parties per IP. */
  CREATE_LIMIT?: RateLimit;
  /** Joining a party by its ID without an invite, per profile; the ID is short, so guessing must be slow. */
  JOIN_LIMIT?: RateLimit;
  /** Cloudflare Realtime TURN key (wrangler secrets). Without them /launcher/turn answers 404 and clients use STUN only. */
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  /** Origin of server/mojang-proxy (a host Mojang does not block) and its shared key (wrangler secret). Without them logins are not verified. */
  VERIFY_URL?: string;
  VERIFY_KEY?: string;
}

const tooMany = () => new Response("Too many requests", { status: 429 });

/** Headers the Worker sets after it verified the launcher; PartyRoom is never reachable without them. */
const VERIFIED_UUID = "X-Focusite-Uuid";
const VERIFIED_NAME = "X-Focusite-Name";
const PARTY_HEADER = "X-Focusite-Party";
const HOST_GRACE_MS = 30_000;
const CHAT_WINDOW_MS = 10_000;
const MAX_CHATS_PER_WINDOW = 8;

interface Member {
  id: string;
  name: string;
  joinedAt: number;
  /** The sharer whose world this member plays in. */
  playing?: string | null;
}

/**
 * One Durable Object per party (the Party ID is its name). It keeps who is in the party, who the host is,
 * and who may still join (invited by a member, or anybody when the host allows joining by ID).
 * Game traffic never passes through here.
 */
export class PartyRoom extends DurableObject<Env> {
  /** Per-socket budgets. Kept in memory: a flooding socket keeps the object awake, so they cannot be dodged. */
  private budgets = new WeakMap<WebSocket, MessageBudget>();
  private chatBudgets = new WeakMap<WebSocket, MessageBudget>();
  private inviteBudgets = new WeakMap<WebSocket, MessageBudget>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const uuid = request.headers.get(VERIFIED_UUID);
    const name = request.headers.get(VERIFIED_NAME);
    const secret = readTokenProtocol(request.headers.get("Sec-WebSocket-Protocol"));
    if (!isId(uuid) || !name || !secret) return new Response("Bad request", { status: 400 });
    const create = new URL(request.url).searchParams.get("create") === "1";
    // Remembered so invites sent later (from a message handler, which has no request) can name the party.
    const party = normalizePartyId(request.headers.get(PARTY_HEADER));

    const isMember = this.ctx.getWebSockets(uuid).length > 0;
    let hostId = await this.ctx.storage.get<string>("host");
    if (hostId === undefined) {
      // A brand new party: only a creator may open it, so a typo in an ID never makes an empty room.
      if (!create) return new Response("Not allowed", { status: 403 });
      hostId = uuid;
      await this.ctx.storage.put({ host: uuid, joinById: false });
    } else if (create) {
      return new Response("Party ID taken", { status: 409 });
    } else if (!isMember) {
      if (await this.ctx.storage.get(`ban:${uuid}`)) return new Response("Not allowed", { status: 403 });
      const invite = await this.ctx.storage.get<number>(`inv:${uuid}`);
      const open = (await this.ctx.storage.get<boolean>("joinById")) === true;
      if (!open && !(invite !== undefined && invite > Date.now())) return new Response("Not allowed", { status: 403 });
    }

    for (const old of this.ctx.getWebSockets(uuid)) old.close(4000, "Replaced by a new connection");
    const others = this.members().filter((m) => m.id !== uuid);
    if (others.length >= MAX_MEMBERS) return new Response("Party is full", { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const me: Member = { id: uuid, name, joinedAt: Date.now() };
    this.ctx.acceptWebSocket(server, [uuid]);
    server.serializeAttachment(me);
    await this.ctx.storage.delete(`inv:${uuid}`);
    if (party) await this.ctx.storage.put("party", party);
    await this.ctx.storage.deleteAlarm();

    const joinById = (await this.ctx.storage.get<boolean>("joinById")) === true;
    const shares = await this.shares();
    server.send(
      JSON.stringify({
        type: "welcome",
        self: uuid,
        host: hostId,
        joinById,
        members: this.members(),
        shares,
      }),
    );
    this.broadcast({ type: "joined", member: me }, uuid);
    // The browser only accepts the connection when the server echoes the subprotocol it asked for.
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": secret.protocol } });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let budget = this.budgets.get(ws);
    if (!budget) this.budgets.set(ws, (budget = { windowStart: Date.now(), count: 0 }));
    // Every message wakes this object and is billed, so one client must not be able to send without limit.
    if (!allowMessage(budget, Date.now())) {
      ws.close(4008, "Too many messages");
      return;
    }
    const me = ws.deserializeAttachment() as Member | null;
    const msg = parseClientMessage(raw);
    if (!me || !msg) return;
    const now = Date.now();

    if (msg.type === "chat") {
      let chat = this.chatBudgets.get(ws);
      if (!chat) this.chatBudgets.set(ws, (chat = { windowStart: now, count: 0 }));
      if (allowWithin(chat, now, CHAT_WINDOW_MS, MAX_CHATS_PER_WINDOW)) {
        this.broadcast({ type: "chat", from: me.id, name: me.name, text: msg.text, ts: now }, null);
      }
      return;
    }
    if (msg.type === "invite") {
      let inv = this.inviteBudgets.get(ws);
      if (!inv) this.inviteBudgets.set(ws, (inv = { windowStart: now, count: 0 }));
      if (!allowWithin(inv, now, 60_000, MAX_INVITES_PER_MINUTE)) return;
      if (this.ctx.getWebSockets(msg.to).length > 0) return; // already in the party
      const party = await this.ctx.storage.get<string>("party");
      if (!party) return;
      const res = await this.env.LAUNCHER.get(this.env.LAUNCHER.idFromName("launcher")).fetch(
        new Request("https://launcher/internal/deliver", {
          method: "POST",
          body: JSON.stringify({ to: msg.to, from: me.id, fromName: me.name, party }),
        }),
      );
      if (res.ok) {
        await this.ctx.storage.put(`inv:${msg.to}`, now + INVITE_TTL_MS);
        this.broadcast({ type: "invited", by: me.id, to: msg.to, toName: msg.toName }, null);
      }
      return;
    }
    if (msg.type === "share") {
      // Every member may share one world of their own; a new share replaces the old one.
      await this.ctx.storage.put(`share:${me.id}`, JSON.stringify(msg.spec));
      this.broadcast({ type: "share", by: me.id, spec: msg.spec }, null);
      return;
    }
    if (msg.type === "unshare") {
      await this.endShare(me.id);
      return;
    }
    if (msg.type === "playing") {
      // Only a world somebody else shares can be played in.
      const target = msg.with !== null && msg.with !== me.id && (await this.ctx.storage.get(`share:${msg.with}`)) !== undefined ? msg.with : null;
      this.setPlaying(ws, me, target);
      return;
    }
    if (msg.type === "rtc") {
      // WebRTC offers and answers between two members; the Worker only forwards them.
      const text = JSON.stringify({ type: "rtc", from: me.id, kind: msg.kind, data: msg.data });
      for (const target of this.ctx.getWebSockets(msg.to)) target.send(text);
      return;
    }
    // Kick, transfer and the join-by-ID switch belong to the host.
    if ((await this.ctx.storage.get<string>("host")) !== me.id) return;
    if (msg.type === "kick" && msg.id !== me.id) {
      await this.ctx.storage.put(`ban:${msg.id}`, true);
      await this.ctx.storage.delete(`inv:${msg.id}`);
      for (const target of this.ctx.getWebSockets(msg.id)) target.close(4003, "Removed by the host");
    } else if (msg.type === "transfer" && this.ctx.getWebSockets(msg.to).length > 0) {
      await this.setHost(msg.to);
    } else if (msg.type === "joinById") {
      await this.ctx.storage.put("joinById", msg.value);
      this.broadcast({ type: "joinById", value: msg.value }, null);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  private async left(ws: WebSocket): Promise<void> {
    const me = ws.deserializeAttachment() as Member | null;
    // A replaced socket closes after its successor joined; only announce when nobody else holds the id.
    if (!me || !this.ctx.getWebSockets(me.id).every((other) => other === ws)) return;
    this.broadcast({ type: "left", id: me.id }, me.id);
    await this.endShare(me.id);
    // A host that drops gets a short grace period before the party moves on without them.
    if ((await this.ctx.storage.get<string>("host")) === me.id || this.members().length <= 1) {
      await this.ctx.storage.setAlarm(Date.now() + HOST_GRACE_MS);
    }
  }

  async alarm(): Promise<void> {
    const members = this.members().sort((a, b) => a.joinedAt - b.joinedAt);
    if (members.length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const host = await this.ctx.storage.get<string>("host");
    if (!members.some((m) => m.id === host)) await this.setHost(members[0].id);
  }

  private async setHost(id: string): Promise<void> {
    await this.ctx.storage.put("host", id);
    this.broadcast({ type: "host", id }, null);
  }

  /** Every shared world in the party, with the sharer's id. */
  private async shares(): Promise<{ by: string; spec: unknown }[]> {
    const stored = await this.ctx.storage.list<string>({ prefix: "share:" });
    return [...stored].map(([key, spec]) => ({ by: key.slice("share:".length), spec: JSON.parse(spec) }));
  }

  /** The member stops sharing (or left): the world closes for everyone who was playing in it. */
  private async endShare(id: string): Promise<void> {
    if (!(await this.ctx.storage.delete(`share:${id}`))) return;
    this.broadcast({ type: "unshare", by: id }, null);
    for (const ws of this.ctx.getWebSockets()) {
      const m = ws.deserializeAttachment() as Member | null;
      if (m?.playing === id) this.setPlaying(ws, m, null);
    }
  }

  private setPlaying(ws: WebSocket, member: Member, target: string | null): void {
    if ((member.playing ?? null) === target) return;
    ws.serializeAttachment({ ...member, playing: target });
    this.broadcast({ type: "playing", id: member.id, with: target }, null);
  }

  private members(): Member[] {
    return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Member);
  }

  private broadcast(message: unknown, exceptId: string | null): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Member | null)?.id !== exceptId) ws.send(text);
    }
  }
}

const CHALLENGE_TTL_MS = 60_000;
const MAX_TURN_PER_DAY = 24;
const TURN_TTL_SECONDS = 6 * 3600;
const SECRET_TTL_MS = 24 * 3600_000;
/** A launcher counts as online this long after its last sync (the launcher syncs about once a minute). */
const ONLINE_TTL_MS = 300_000;
/** A profile that synced within this time cannot be signed in again (the launcher syncs about once a minute). */
const LOGIN_LOCK_MS = 120_000;

interface StoredSecret {
  hash: string;
  expires: number;
  /** The Java name the Mojang session server confirmed at login. */
  name: string;
}

interface StoredInvite {
  from: string;
  fromName: string;
  party: string;
  expires: number;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * One global Durable Object that knows which Java profiles are running the launcher right now.
 * A profile id is only accepted after the Mojang session server confirms the client really joined our
 * one-time challenge as that profile, so nobody can claim someone else's id and no token is shared with us.
 */
export class LauncherPresence extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let body: unknown = {};
    try {
      body = JSON.parse(await request.text());
    } catch {
      return json({ error: "Bad JSON" }, 400);
    }
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 3600_000);

    if (path === "/launcher/challenge") {
      const serverId = crypto.randomUUID().replaceAll("-", "");
      await this.ctx.storage.put(`n:${serverId}`, Date.now() + CHALLENGE_TTL_MS);
      // `verify` tells the launcher to join the challenge at the session server; without a verifier that call is pointless.
      return json({ serverId, verify: !!(this.env.VERIFY_URL && this.env.VERIFY_KEY) });
    }
    if (path === "/launcher/login") return this.login(body);
    if (path === "/launcher/sync") return this.sync(body);
    if (path === "/launcher/turn") return this.turn(body);
    // Only the Worker itself calls these: the public routes are limited to /launcher/*.
    if (path === "/internal/verify") return this.verify(body);
    if (path === "/internal/deliver") return this.deliver(body);
    return json({ error: "Not found" }, 404);
  }

  private async verifySecret(uuid: string, secret: string): Promise<StoredSecret | null> {
    const stored = await this.ctx.storage.get<StoredSecret>(`s:${uuid}`);
    if (!stored || stored.expires < Date.now() || !sameHex(stored.hash, await sha256Hex(secret))) return null;
    return stored;
  }

  private async verify(raw: unknown): Promise<Response> {
    const body = parseVerifyBody(raw);
    const stored = body && (await this.verifySecret(body.uuid, body.secret));
    return stored ? json({ name: stored.name }) : json({ error: "Login again" }, 401);
  }

  /** Puts a party invite in the recipient's inbox until their launcher collects it. */
  private async deliver(raw: unknown): Promise<Response> {
    const b = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const party = normalizePartyId(b.party);
    if (!isId(b.to) || !isId(b.from) || !party || typeof b.fromName !== "string") return json({ error: "Bad request" }, 400);
    const pending = await this.ctx.storage.list({ prefix: `i:${b.to}:`, limit: MAX_PENDING_INVITES });
    if (pending.size >= MAX_PENDING_INVITES && !pending.has(`i:${b.to}:${b.from}`)) return json({ error: "Inbox full" }, 429);
    const invite: StoredInvite = { from: b.from, fromName: b.fromName.slice(0, 32), party, expires: Date.now() + INVITE_TTL_MS };
    await this.ctx.storage.put(`i:${b.to}:${b.from}`, invite);
    return json({ ok: true });
  }

  /** Short-lived TURN credentials for a verified launcher, a few per day so the free allowance cannot be drained. */
  private async turn(raw: unknown): Promise<Response> {
    if (!this.env.TURN_KEY_ID || !this.env.TURN_API_TOKEN) return json({ error: "No relay" }, 404);
    const body = parseVerifyBody(raw);
    if (!body || !(await this.verifySecret(body.uuid, body.secret))) return json({ error: "Login again" }, 401);
    const key = `t:${body.uuid}`;
    const now = Date.now();
    const used = await this.ctx.storage.get<{ count: number; expires: number }>(key);
    const count = used && used.expires > now ? used.count : 0;
    if (count >= MAX_TURN_PER_DAY) return json({ error: "Too many" }, 429);
    await this.ctx.storage.put(key, { count: count + 1, expires: used && used.expires > now ? used.expires : now + 24 * 3600_000 });

    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_KEY_ID}/credentials/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.TURN_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
    if (!res.ok) return json({ error: "Relay unavailable" }, 502);
    const data = (await res.json()) as { iceServers?: unknown };
    const iceServers = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return json({ iceServers });
  }

  private async login(raw: unknown): Promise<Response> {
    const body = parseLoginBody(raw);
    if (!body) return json({ error: "Bad request" }, 400);
    const key = `n:${body.serverId}`;
    const expires = await this.ctx.storage.get<number>(key);
    await this.ctx.storage.delete(key); // one use only
    if (expires === undefined || expires < Date.now()) return json({ error: "Challenge expired" }, 401);

    if (this.env.VERIFY_URL && this.env.VERIFY_KEY) {
      // The launcher joined our challenge as this profile at the session server; the proxy asks Mojang (which
      // refuses Cloudflare's addresses) whether that happened.
      const query = new URLSearchParams({ username: body.name, serverId: body.serverId });
      let res: Response;
      try {
        res = await fetch(`${this.env.VERIFY_URL}/has-joined?${query}`, { headers: { Authorization: `Bearer ${this.env.VERIFY_KEY}` } });
      } catch {
        return json({ error: "Verification unavailable" }, 502);
      }
      if (res.status >= 500 || res.status === 429) return json({ error: "Verification unavailable" }, 502);
      const profile = res.ok ? ((await res.json().catch(() => null)) as { id?: unknown; name?: unknown } | null) : null;
      if (profile?.id !== body.uuid || String(profile.name).toLowerCase() !== body.name.toLowerCase()) {
        return json({ error: "Not verified" }, 401);
      }
    } else {
      // shortcut: without VERIFY_URL the profile is not checked. A profile that synced a moment ago cannot be
      // signed in again, so nobody takes over an online account, but an offline one can be claimed first.
      // Deploy server/mojang-proxy and set VERIFY_URL / VERIFY_KEY to close that.
      const lastSeen = await this.ctx.storage.get<number>(`o:${body.uuid}`);
      if (lastSeen !== undefined && lastSeen - ONLINE_TTL_MS > Date.now() - LOGIN_LOCK_MS) {
        return json({ error: "This profile is signed in already; try again in a few minutes" }, 409);
      }
    }

    const secret = crypto.randomUUID().replaceAll("-", "");
    const stored: StoredSecret = { hash: await sha256Hex(secret), expires: Date.now() + SECRET_TTL_MS, name: body.name };
    await this.ctx.storage.put({ [`s:${body.uuid}`]: stored, [`o:${body.uuid}`]: Date.now() + ONLINE_TTL_MS });
    return json({ secret });
  }

  private async sync(raw: unknown): Promise<Response> {
    const body = parseSyncBody(raw);
    if (!body) return json({ error: "Bad request" }, 400);
    const stored = await this.verifySecret(body.uuid, body.secret);
    if (!stored) return json({ error: "Login again" }, 401);
    const now = Date.now();
    // The secret lives as long as the launcher keeps syncing, so a running launcher is never asked to log in again.
    await this.ctx.storage.put({ [`o:${body.uuid}`]: now + ONLINE_TTL_MS, [`s:${body.uuid}`]: { ...stored, expires: now + SECRET_TTL_MS } });

    const online: string[] = [];
    // Durable Object storage reads at most 128 keys at once.
    for (let i = 0; i < body.uuids.length; i += 128) {
      const chunk = body.uuids.slice(i, i + 128);
      const found = await this.ctx.storage.get<number>(chunk.map((id) => `o:${id}`));
      for (const id of chunk) if ((found.get(`o:${id}`) ?? 0) > now) online.push(id);
    }

    // Invites are handed over once; the launcher shows them and the sender's party keeps the permission.
    const inbox = await this.ctx.storage.list<StoredInvite>({ prefix: `i:${body.uuid}:`, limit: MAX_PENDING_INVITES });
    const invites = [...inbox.values()].filter((i) => i.expires > now);
    if (inbox.size > 0) await this.ctx.storage.delete([...inbox.keys()]);
    return json({ online, invites });
  }

  /** Hourly cleanup of expired challenges, secrets and presence entries. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];
    for (const [key, value] of await this.ctx.storage.list<number | StoredSecret | StoredInvite>()) {
      const until = typeof value === "number" ? value : value.expires;
      if (until < now) expired.push(key);
    }
    for (let i = 0; i < expired.length; i += 128) await this.ctx.storage.delete(expired.slice(i, i + 128));
    if ((await this.ctx.storage.list({ limit: 1 })).size > 0) await this.ctx.storage.setAlarm(now + 3600_000);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/launcher/")) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (env.LAUNCHER_LIMIT && !(await env.LAUNCHER_LIMIT.limit({ key: ip })).success) return tooMany();
      const size = Number(request.headers.get("Content-Length") ?? 0);
      if (size > MAX_LAUNCHER_BODY_BYTES) return new Response("Too large", { status: 413 });
      return env.LAUNCHER.get(env.LAUNCHER.idFromName("launcher")).fetch(request);
    }
    const match = /^\/p\/([A-Za-z0-9]{6})$/.exec(pathname);
    const partyId = match && normalizePartyId(match[1]);
    if (!partyId) return new Response("Focusite signaling server", { status: 200 });
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (env.CONNECT_LIMIT && !(await env.CONNECT_LIMIT.limit({ key: ip })).success) return tooMany();

    // Only a launcher that proved its profile may enter; the party then sees the verified id and name.
    const url = new URL(request.url);
    const uuid = url.searchParams.get("member");
    const secret = readTokenProtocol(request.headers.get("Sec-WebSocket-Protocol"));
    if (!isId(uuid) || !secret) return new Response("Bad request", { status: 400 });
    const verified = await env.LAUNCHER.get(env.LAUNCHER.idFromName("launcher")).fetch(
      new Request("https://launcher/internal/verify", { method: "POST", body: JSON.stringify({ uuid, secret: secret.token }) }),
    );
    if (!verified.ok) return new Response("Login again", { status: 401 });
    const { name } = (await verified.json()) as { name: string };

    const creating = url.searchParams.get("create") === "1";
    const limit = creating ? env.CREATE_LIMIT : env.JOIN_LIMIT;
    if (limit && !(await limit.limit({ key: creating ? ip : uuid })).success) return tooMany();

    const headers = new Headers(request.headers);
    headers.set(VERIFIED_UUID, uuid);
    headers.set(VERIFIED_NAME, name);
    headers.set(PARTY_HEADER, partyId);
    return env.PARTY.get(env.PARTY.idFromName(partyId)).fetch(new Request(request, { headers }));
  },
};
