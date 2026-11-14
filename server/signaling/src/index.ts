import { DurableObject } from "cloudflare:workers";
import { cleanName, isId, MAX_MEMBERS, parseClientMessage, readTokenProtocol, sameHex, sha256Hex, type Share } from "./protocol.ts";

interface Env {
  GROUP: DurableObjectNamespace<GroupRoom>;
  /** Connection attempts per IP; the free plan has no dashboard rate limiting, so the Worker does it. */
  CONNECT_LIMIT?: RateLimit;
  /** Brand new groups per IP. */
  CREATE_LIMIT?: RateLimit;
}

const tooMany = () => new Response("Too many requests", { status: 429 });

interface Member {
  id: string;
  name: string;
  share: Share | null;
}

/**
 * One Durable Object per group. It keeps who is online and what each member shares, and relays
 * WebRTC connection data between two members. Game traffic never passes through here.
 * The first connection to a group id sets its token (only a hash is stored); later ones must match.
 */
export class GroupRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });

    const url = new URL(request.url);
    const memberId = url.searchParams.get("member");
    const secret = readTokenProtocol(request.headers.get("Sec-WebSocket-Protocol"));
    if (!isId(memberId) || !secret) return new Response("Bad request", { status: 400 });

    const hash = await sha256Hex(secret.token);
    const stored = await this.ctx.storage.get<string>("tokenHash");
    if (stored === undefined) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (this.env.CREATE_LIMIT && !(await this.env.CREATE_LIMIT.limit({ key: ip })).success) return tooMany();
      await this.ctx.storage.put("tokenHash", hash);
    } else if (!sameHex(stored, hash)) {
      return new Response("Wrong group token", { status: 403 });
    }

    // A reconnecting member replaces its old socket.
    for (const old of this.ctx.getWebSockets(memberId)) old.close(4000, "Replaced by a new connection");
    const others = this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Member | null)?.id !== memberId);
    if (others.length >= MAX_MEMBERS) return new Response("Group is full", { status: 409 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const me: Member = { id: memberId, name: cleanName(url.searchParams.get("name")), share: null };
    this.ctx.acceptWebSocket(server, [memberId]);
    server.serializeAttachment(me);

    server.send(JSON.stringify({ type: "welcome", self: memberId, members: this.members() }));
    this.broadcast({ type: "joined", member: me }, memberId);
    // The browser only accepts the connection when the server echoes the subprotocol it asked for.
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": secret.protocol } });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    const me = ws.deserializeAttachment() as Member | null;
    const msg = parseClientMessage(raw);
    if (!me || !msg) return;
    if (msg.type === "share") {
      me.share = msg.share;
      ws.serializeAttachment(me);
      this.broadcast({ type: "share", id: me.id, share: me.share }, me.id);
    } else {
      for (const target of this.ctx.getWebSockets(msg.to)) {
        target.send(JSON.stringify({ type: "signal", from: me.id, data: msg.data }));
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.left(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.left(ws);
  }

  private left(ws: WebSocket): void {
    const me = ws.deserializeAttachment() as Member | null;
    // A replaced socket closes after its successor joined; only announce when nobody else holds the id.
    if (me && this.ctx.getWebSockets(me.id).every((other) => other === ws)) {
      this.broadcast({ type: "left", id: me.id }, me.id);
    }
  }

  private members(): Member[] {
    return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Member);
  }

  private broadcast(message: unknown, exceptId: string): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Member | null)?.id !== exceptId) ws.send(text);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const match = /^\/g\/([a-f0-9]{32})$/.exec(pathname);
    if (!match) return new Response("Focusite signaling server", { status: 200 });
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (env.CONNECT_LIMIT && !(await env.CONNECT_LIMIT.limit({ key: ip })).success) return tooMany();
    return env.GROUP.get(env.GROUP.idFromName(match[1])).fetch(request);
  },
};
