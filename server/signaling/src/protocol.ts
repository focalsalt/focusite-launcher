// Pure message rules shared by the Durable Object and its tests (no Cloudflare imports).

export const MAX_MEMBERS = 8;
export const MAX_MESSAGE_BYTES = 64 * 1024;

export type ClientMessage =
  | { type: "chat"; text: string }
  | { type: "invite"; to: string; toName: string }
  | { type: "kick"; id: string }
  | { type: "transfer"; to: string }
  | { type: "joinById"; value: boolean }
  | { type: "share"; spec: ShareSpec }
  | { type: "unshare" }
  /** Whose shared world this member plays in right now (null: none). */
  | { type: "playing"; with: string | null }
  | { type: "rtc"; to: string; kind: RtcKind; data: string };

/** What a member shares with the party: the game setup behind the world. Members validate it again before using it. */
export interface ShareSpec {
  /** The sharer's instance name; guests name their copy the same. */
  instanceName: string;
  mcVersion: string;
  loader: string;
  mods: unknown[];
  [key: string]: unknown;
}

export const RTC_KINDS = ["want", "offer", "answer", "fail"] as const;
export type RtcKind = (typeof RTC_KINDS)[number];
export const MAX_RTC_DATA = 16 * 1024;
export const MAX_SPEC_CHARS = 100_000;
export const MAX_SPEC_MODS = 1000;
/** A custom loader jar bigger than this is not shared (the guest would have to hold it in memory). */
export const MAX_CUSTOM_JAR_BYTES = 256 * 1024 * 1024;
/** Only a share message may be longer than MAX_MESSAGE_BYTES. */
export const MAX_SHARE_MESSAGE_BYTES = MAX_SPEC_CHARS + 1024;

export const parseShareSpec = (value: unknown): ShareSpec | null => {
  const s = asRecord(value);
  if (!s || typeof s.mcVersion !== "string" || s.mcVersion.length > 64) return null;
  if (typeof s.loader !== "string" || s.loader.length > 64) return null;
  if (typeof s.instanceName !== "string" || s.instanceName.length > 64) return null;
  if (!Array.isArray(s.mods) || s.mods.length > MAX_SPEC_MODS) return null;
  // Every member renders these entries, so one malformed entry must never get past the Worker.
  const goodMod = (m: unknown) => {
    const r = asRecord(m);
    return !!r && typeof r.filename === "string" && typeof r.sha1 === "string" && typeof r.side === "string" && typeof r.size === "number";
  };
  if (!s.mods.every(goodMod)) return null;
  if (s.customJar !== undefined) {
    const j = asRecord(s.customJar);
    const ok = !!j && typeof j.filename === "string" && typeof j.sha1 === "string" && /^[a-f0-9]{40}$/.test(j.sha1) && typeof j.size === "number" && j.size > 0 && j.size <= MAX_CUSTOM_JAR_BYTES;
    if (!ok) return null;
  }
  if (JSON.stringify(s).length > MAX_SPEC_CHARS) return null;
  return s as ShareSpec;
};

export const MAX_CHAT_CHARS = 256;

/** A Party ID is six letters or digits; people type it in any case, the server keeps it upper case. */
export const normalizePartyId = (value: unknown): string | null => {
  const id = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9]{6}$/.test(id) ? id : null;
};

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

/** Returns null for anything that is not a well-formed client message. */
export const parseClientMessage = (raw: string | ArrayBuffer): ClientMessage | null => {
  if (typeof raw !== "string" || raw.length > MAX_SHARE_MESSAGE_BYTES) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "share") {
    const spec = parseShareSpec(m.spec);
    return spec ? { type: "share", spec } : null;
  }
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  if (m.type === "unshare") return { type: "unshare" };
  if (m.type === "playing" && (m.with === null || isId(m.with))) return { type: "playing", with: m.with };
  if (m.type === "rtc" && isId(m.to) && RTC_KINDS.includes(m.kind as RtcKind)) {
    const data = typeof m.data === "string" ? m.data : "";
    return data.length <= MAX_RTC_DATA ? { type: "rtc", to: m.to, kind: m.kind as RtcKind, data } : null;
  }
  if (m.type === "chat" && typeof m.text === "string") {
    const text = m.text.replace(CONTROL_CHARS, " ").trim().slice(0, MAX_CHAT_CHARS);
    return text ? { type: "chat", text } : null;
  }
  if (m.type === "invite" && isUuid(m.to)) {
    return { type: "invite", to: m.to, toName: cleanName(typeof m.toName === "string" ? m.toName : null) };
  }
  if (m.type === "kick" && isId(m.id)) return { type: "kick", id: m.id };
  if (m.type === "transfer" && isId(m.to)) return { type: "transfer", to: m.to };
  if (m.type === "joinById" && typeof m.value === "boolean") return { type: "joinById", value: m.value };
  return null;
};

/** Messages one socket may send per window. Signaling is a handful of messages per connection setup. */
export const MAX_MESSAGES_PER_WINDOW = 60;
export const MESSAGE_WINDOW_MS = 10_000;

export interface MessageBudget {
  windowStart: number;
  count: number;
}

/** Counts one event against a fixed window; false once more than `max` happen within `windowMs`. */
export const allowWithin = (budget: MessageBudget, now: number, windowMs: number, max: number): boolean => {
  if (now - budget.windowStart >= windowMs) {
    budget.windowStart = now;
    budget.count = 0;
  }
  budget.count += 1;
  return budget.count <= max;
};

/** Counts one message against the socket's budget; false once the socket sends too fast. */
export const allowMessage = (budget: MessageBudget, now: number): boolean =>
  allowWithin(budget, now, MESSAGE_WINDOW_MS, MAX_MESSAGES_PER_WINDOW);

export const MAX_INVITES_PER_MINUTE = 5;
export const MAX_PENDING_INVITES = 10;
export const INVITE_TTL_MS = 300_000;

export interface VerifyBody {
  uuid: string;
  secret: string;
}

/** Body of /internal/verify; the same shape a launcher sends to prove who it is. */
export const parseVerifyBody = (value: unknown): VerifyBody | null => {
  const b = asRecord(value);
  return b && isUuid(b.uuid) && isId(b.secret) ? { uuid: b.uuid, secret: b.secret } : null;
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

/** A Minecraft profile id without dashes, lowercase. */
export const isUuid = isId;

export const MAX_SYNC_IDS = 200;
export const MAX_LAUNCHER_BODY_BYTES = 16 * 1024;

export interface LoginBody {
  uuid: string;
  name: string;
  serverId: string;
}

export interface SyncBody {
  uuid: string;
  secret: string;
  uuids: string[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Java names are 3-16 characters of letters, digits and underscore. */
export const isJavaName = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_]{1,16}$/.test(value);

export const parseLoginBody = (value: unknown): LoginBody | null => {
  const b = asRecord(value);
  if (!b || !isUuid(b.uuid) || !isJavaName(b.name) || !isId(b.serverId)) return null;
  return { uuid: b.uuid, name: b.name, serverId: b.serverId };
};

/** Ids that are not valid profile ids are dropped; duplicates and anything past the cap are ignored. */
export const parseSyncBody = (value: unknown): SyncBody | null => {
  const b = asRecord(value);
  if (!b || !isUuid(b.uuid) || !isId(b.secret) || !Array.isArray(b.uuids)) return null;
  const uuids = [...new Set(b.uuids.filter(isUuid))].slice(0, MAX_SYNC_IDS);
  return { uuid: b.uuid, secret: b.secret, uuids };
};
