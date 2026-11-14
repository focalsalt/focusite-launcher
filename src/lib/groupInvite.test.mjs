import test from "node:test";
import assert from "node:assert/strict";
import { decodeInvite, encodeInvite, groupSocketProtocol, groupSocketUrl, normalizeServer, randomHex } from "./groupInvite.ts";

const group = { id: randomHex(16), name: "週末生存 ⛏", server: "https://sig.example.workers.dev", token: randomHex(24) };

test("an invite link round-trips, including non-ASCII names", () => {
  const link = encodeInvite(group);
  assert.ok(link.startsWith("focusite://group/"));
  assert.deepEqual(decodeInvite(link), group);
  assert.deepEqual(decodeInvite(`  ${link}\n`), group);
});

test("malformed invites are rejected", () => {
  assert.equal(decodeInvite("hello"), null);
  assert.equal(decodeInvite("focusite://group/!!!"), null);
  const bad = encodeInvite({ ...group, id: "short" });
  assert.equal(decodeInvite(bad), null);
  assert.equal(decodeInvite(encodeInvite({ ...group, token: "tiny" })), null);
  assert.equal(decodeInvite(encodeInvite({ ...group, token: "has space and more chars!!" })), null);
  assert.equal(decodeInvite(encodeInvite({ ...group, server: "http://insecure.example" })), null);
});

test("server addresses are normalized to an https origin", () => {
  assert.equal(normalizeServer("sig.example.workers.dev"), "https://sig.example.workers.dev");
  assert.equal(normalizeServer("https://sig.example.workers.dev/path?x=1"), "https://sig.example.workers.dev");
  assert.equal(normalizeServer("http://sig.example.workers.dev"), null);
  assert.equal(normalizeServer(""), null);
});

test("the socket url targets the group room", () => {
  const url = groupSocketUrl(group, "b".repeat(32), "Steve Jr");
  assert.ok(url.startsWith(`wss://sig.example.workers.dev/g/${group.id}?`));
  assert.ok(url.includes("name=Steve+Jr"));
  assert.ok(!url.includes(group.token), "the secret must not appear in the url");
  assert.equal(groupSocketProtocol(group), `focusite.${group.token}`);
});
