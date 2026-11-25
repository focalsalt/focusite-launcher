import test from "node:test";
import assert from "node:assert/strict";
import {
  allowMessage,
  allowWithin,
  MAX_CHAT_CHARS,
  MAX_INVITES_PER_MINUTE,
  normalizePartyId,
  parseVerifyBody,
  MAX_RTC_DATA,
  MAX_SPEC_CHARS,
  cleanName,
  isId,
  isJavaName,
  isToken,
  MAX_SYNC_IDS,
  MAX_MESSAGES_PER_WINDOW,
  MESSAGE_WINDOW_MS,
  parseClientMessage,
  parseLoginBody,
  parseSyncBody,
  readTokenProtocol,
  sameHex,
  sha256Hex,
} from "./protocol.ts";

test("a socket that sends too fast runs out of budget until the window passes", () => {
  const budget = { windowStart: 0, count: 0 };
  for (let i = 0; i < MAX_MESSAGES_PER_WINDOW; i++) assert.ok(allowMessage(budget, 1000));
  assert.equal(allowMessage(budget, 1000), false);
  assert.ok(allowMessage(budget, MESSAGE_WINDOW_MS + 1));
});

const id = "a".repeat(32);

test("party messages are validated", () => {
  assert.deepEqual(parseClientMessage('{"type":"chat","text":"  hi\\u0007 there "}'), { type: "chat", text: "hi  there" });
  assert.equal(parseClientMessage('{"type":"chat","text":"   "}'), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "chat", text: "x".repeat(900) })).text.length, MAX_CHAT_CHARS);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "invite", to: id, toName: "Steve" })), { type: "invite", to: id, toName: "Steve" });
  assert.equal(parseClientMessage(JSON.stringify({ type: "invite", to: "nope" })), null);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "kick", id })), { type: "kick", id });
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "transfer", to: id })), { type: "transfer", to: id });
  assert.deepEqual(parseClientMessage('{"type":"joinById","value":true}'), { type: "joinById", value: true });
  assert.equal(parseClientMessage('{"type":"joinById","value":"yes"}'), null);
});

test("party ids are six letters or digits in any case", () => {
  assert.equal(normalizePartyId(" ab12Cd "), "AB12CD");
  for (const bad of ["ABC12", "ABC1234", "AB-12C", "", null, 5]) assert.equal(normalizePartyId(bad), null);
});

test("invites are limited per window", () => {
  const budget = { windowStart: 0, count: 0 };
  for (let i = 0; i < MAX_INVITES_PER_MINUTE; i++) assert.ok(allowWithin(budget, 1000, 60_000, MAX_INVITES_PER_MINUTE));
  assert.equal(allowWithin(budget, 1000, 60_000, MAX_INVITES_PER_MINUTE), false);
  assert.ok(allowWithin(budget, 61_001, 60_000, MAX_INVITES_PER_MINUTE));
});

test("verify bodies need a profile id and a secret", () => {
  assert.deepEqual(parseVerifyBody({ uuid: id, secret: id }), { uuid: id, secret: id });
  assert.equal(parseVerifyBody({ uuid: id }), null);
});

test("garbage and oversized input is rejected", () => {
  assert.equal(parseClientMessage("not json"), null);
  assert.equal(parseClientMessage("[]"), null);
  assert.equal(parseClientMessage('{"type":"other"}'), null);
  assert.equal(parseClientMessage(new ArrayBuffer(4)), null);
  assert.equal(parseClientMessage(`{"type":"chat","text":"a","pad":"${"x".repeat(70000)}"}`), null);
});

test("ids, names and token hashes", async () => {
  assert.ok(isId(id));
  assert.ok(!isId("ABC"));
  assert.equal(cleanName("  \u0007Steve\n "), "Steve");
  assert.equal(cleanName(null), "Player");
  assert.equal(cleanName("x".repeat(100)).length, 32);
  const h = await sha256Hex("secret");
  assert.equal(h.length, 64);
  assert.ok(sameHex(h, await sha256Hex("secret")));
  assert.ok(!sameHex(h, await sha256Hex("other")));
});

test("the group secret is read from the subprotocol header, never the url", () => {
  const token = "a".repeat(48);
  assert.deepEqual(readTokenProtocol(`focusite.${token}`), { protocol: `focusite.${token}`, token });
  assert.deepEqual(readTokenProtocol(`other, focusite.${token}`), { protocol: `focusite.${token}`, token });
  assert.equal(readTokenProtocol(null), null);
  assert.equal(readTokenProtocol("focusite.short"), null);
  assert.equal(readTokenProtocol(`focusite.${"a b".repeat(10)}`), null);
  assert.ok(isToken(token));
  assert.ok(!isToken("has space in it......"));
});

test("launcher login bodies need a profile id, a java name and a challenge id", () => {
  const ok = { uuid: id, name: "Notch", serverId: "b".repeat(32) };
  assert.deepEqual(parseLoginBody(ok), ok);
  assert.equal(parseLoginBody({ ...ok, uuid: "not-a-uuid" }), null);
  assert.equal(parseLoginBody({ ...ok, name: "bad name!" }), null);
  assert.equal(parseLoginBody({ ...ok, serverId: "x" }), null);
  assert.equal(parseLoginBody(null), null);
  assert.ok(isJavaName("A_b9") && !isJavaName("a".repeat(17)));
});

test("launcher sync keeps only valid, unique ids up to the cap", () => {
  const secret = "c".repeat(32);
  const many = Array.from({ length: MAX_SYNC_IDS + 50 }, (_, i) => i.toString(16).padStart(32, "0"));
  const body = parseSyncBody({ uuid: id, secret, uuids: [id, id, "nope", ...many] });
  assert.equal(body.uuids.length, MAX_SYNC_IDS);
  assert.equal(new Set(body.uuids).size, MAX_SYNC_IDS);
  assert.ok(!body.uuids.includes("nope"));
  assert.equal(parseSyncBody({ uuid: id, secret: "short", uuids: [] }), null);
  assert.equal(parseSyncBody({ uuid: id, secret, uuids: "x" }), null);
});

test("share and rtc messages are validated", () => {
  const spec = { instanceName: "Survival", mcVersion: "1.20.1", loader: "Fabric", mods: [{ filename: "a.jar", sha1: "a".repeat(40), size: 3, side: "both" }] };
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, instanceName: undefined } })), null);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "playing", with: id })), { type: "playing", with: id });
  assert.deepEqual(parseClientMessage('{"type":"playing","with":null}'), { type: "playing", with: null });
  assert.equal(parseClientMessage('{"type":"playing","with":"nope"}'), null);
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "share", spec })), { type: "share", spec });
  // One malformed entry would break every member's screen, so none may pass.
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, mods: [null] } })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, mods: [{ filename: "a.jar" }] } })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, instanceName: "x".repeat(65) } })), null);
  const jar = { filename: "c.jar", sha1: "b".repeat(40), size: 10 };
  assert.ok(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, customJar: jar } })));
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, customJar: { ...jar, sha1: "../x" } } })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, customJar: { ...jar, size: 1e12 } } })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, mods: "x" } })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "share", spec: { ...spec, pad: "x".repeat(MAX_SPEC_CHARS) } })), null);
  assert.deepEqual(parseClientMessage('{"type":"unshare"}'), { type: "unshare" });
  const rtc = { type: "rtc", to: id, kind: "offer", data: "x" };
  assert.deepEqual(parseClientMessage(JSON.stringify(rtc)), rtc);
  assert.equal(parseClientMessage(JSON.stringify({ ...rtc, kind: "hack" })), null);
  assert.equal(parseClientMessage(JSON.stringify({ ...rtc, data: "x".repeat(MAX_RTC_DATA + 1) })), null);
  // Only a share may be longer than an ordinary message.
  assert.equal(parseClientMessage(JSON.stringify({ type: "chat", text: "x", pad: "y".repeat(70_000) })), null);
});
