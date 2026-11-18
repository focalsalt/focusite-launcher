// Pure message rules shared by the Durable Object and its tests (no Cloudflare imports).

export const MAX_MEMBERS = 16;
export const MAX_MESSAGE_BYTES = 64 * 1024;

export interface Share {
  /** What the member is hosting, e.g. an instance name. */
  label: string;
  /** The Minecraft "Open to LAN" port on the member's computer. */
  port: number;
}

export type ClientMessage =
  | { type: "share"; share: Share | null }
  | { type: "signal"; to: string; data: unknown };

export const isId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

/** Group secrets are URL-safe characters only, so they are valid WebSocket subprotocol tokens. */
export const isToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);

export const TOKEN_PROTOCOL_PREFIX = "focusite.";

/** Reads the group secret from the Sec-WebSocket-Protocol header (kept out of the URL and its logs). */
export const readTokenProtocol = (header: string | null): { protocol: string; token: string } | null => {
  for (const part of (header ?? "").split(",")) {
    const protocol = part.trim();
    if (protocol.startsWith(TOKEN_PROTOCOL_PREFIX)) {
      const token = protocol.slice(TOKEN_PROTOCOL_PREFIX.length);
      if (isToken(token)) return { protocol, token };
    }
  }
  return null;
};

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export const cleanName = (value: string | null): string => {
  const name = (value ?? "").replace(CONTROL_CHARS, "").trim().slice(0, 32);
  return name || "Player";
};

const parseShare = (value: unknown): Share | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { label, port } = value as Record<string, unknown>;
  if (typeof label !== "string" || typeof port !== "number" || !Number.isInteger(port)) return undefined;
  if (port < 1 || port > 65535) return undefined;
  return { label: label.replace(CONTROL_CHARS, "").trim().slice(0, 64), port };
};

/** Returns null for anything that is not a well-formed client message. */
export const parseClientMessage = (raw: string | ArrayBuffer): ClientMessage | null => {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "share") {
    const share = parseShare(m.share);
    return share === undefined ? null : { type: "share", share };
  }
  if (m.type === "signal" && isId(m.to) && m.data !== undefined) {
    return { type: "signal", to: m.to, data: m.data };
  }
  return null;
};

/** Messages one socket may send per window. Signaling is a handful of messages per connection setup. */
export const MAX_MESSAGES_PER_WINDOW = 60;
export const MESSAGE_WINDOW_MS = 10_000;

export interface MessageBudget {
  windowStart: number;
  count: number;
}

/** Counts one message against the socket's budget; false once the socket sends too fast. */
export const allowMessage = (budget: MessageBudget, now: number): boolean => {
  if (now - budget.windowStart >= MESSAGE_WINDOW_MS) {
    budget.windowStart = now;
    budget.count = 0;
  }
  budget.count += 1;
  return budget.count <= MAX_MESSAGES_PER_WINDOW;
};

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Compares without stopping at the first different character. */
export const sameHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
