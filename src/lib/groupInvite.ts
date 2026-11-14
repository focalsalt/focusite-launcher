/** A friend group: created once, shared with an invite link. The token is the group's shared secret. */
export interface GroupInfo {
  /** 32 hex characters. */
  id: string;
  name: string;
  /** HTTPS origin of the signaling server, without a trailing slash. */
  server: string;
  token: string;
}

const INVITE_PREFIX = "focusite://group/";
const HEX_ID = /^[a-f0-9]{32}$/;

export const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

export const isMemberId = (value: unknown): value is string => typeof value === "string" && HEX_ID.test(value);

/** Accepts "name.workers.dev" or a full https URL; anything else is rejected. */
export const normalizeServer = (input: string): string | null => {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

/** WebSocket address that joins a group as one member. The secret is not part of it. */
export const groupSocketUrl = (group: GroupInfo, memberId: string, name: string): string => {
  const params = new URLSearchParams({ member: memberId, name });
  return `${group.server.replace(/^https:/, "wss:")}/g/${group.id}?${params.toString()}`;
};

/** Carries the group secret in the Sec-WebSocket-Protocol header, which servers do not log like a URL. */
export const groupSocketProtocol = (group: GroupInfo): string => `focusite.${group.token}`;

export const isGroupToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);

const toBase64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): string => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

export const encodeInvite = (group: GroupInfo): string =>
  INVITE_PREFIX + toBase64Url(JSON.stringify({ i: group.id, n: group.name, s: group.server, t: group.token }));

/** Returns null when the text is not a well-formed invite link. */
export const decodeInvite = (text: string): GroupInfo | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(INVITE_PREFIX)) return null;
  try {
    const raw = JSON.parse(fromBase64Url(trimmed.slice(INVITE_PREFIX.length))) as Record<string, unknown>;
    const server = typeof raw.s === "string" ? normalizeServer(raw.s) : null;
    if (!isMemberId(raw.i) || !server) return null;
    if (!isGroupToken(raw.t)) return null;
    const name = typeof raw.n === "string" ? raw.n.trim().slice(0, 32) : "";
    return { id: raw.i, name: name || "Group", server, token: raw.t };
  } catch {
    return null;
  }
};
