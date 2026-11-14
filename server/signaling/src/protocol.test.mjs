import test from "node:test";
import assert from "node:assert/strict";
import { cleanName, isId, isToken, parseClientMessage, readTokenProtocol, sameHex, sha256Hex } from "./protocol.ts";

const id = "a".repeat(32);

test("share messages are validated", () => {
  assert.deepEqual(parseClientMessage('{"type":"share","share":null}'), { type: "share", share: null });
  assert.deepEqual(parseClientMessage('{"type":"share","share":{"label":" World ","port":25565}}'), {
    type: "share",
    share: { label: "World", port: 25565 },
  });
  assert.equal(parseClientMessage('{"type":"share","share":{"label":"x","port":70000}}'), null);
  assert.equal(parseClientMessage('{"type":"share","share":{"label":"x","port":1.5}}'), null);
  assert.equal(parseClientMessage('{"type":"share"}'), null);
});

test("signal messages need a valid target and data", () => {
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: "signal", to: id, data: { a: 1 } })), {
    type: "signal",
    to: id,
    data: { a: 1 },
  });
  assert.equal(parseClientMessage(JSON.stringify({ type: "signal", to: "nope", data: 1 })), null);
  assert.equal(parseClientMessage(JSON.stringify({ type: "signal", to: id })), null);
});

test("garbage and oversized input is rejected", () => {
  assert.equal(parseClientMessage("not json"), null);
  assert.equal(parseClientMessage("[]"), null);
  assert.equal(parseClientMessage('{"type":"other"}'), null);
  assert.equal(parseClientMessage(new ArrayBuffer(4)), null);
  assert.equal(parseClientMessage(`{"type":"share","share":null,"pad":"${"x".repeat(70000)}"}`), null);
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
