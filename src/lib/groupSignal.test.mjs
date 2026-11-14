import test from "node:test";
import assert from "node:assert/strict";
import { decideSignal } from "./groupSignal.ts";

const idle = { sharing: false, waitingForOffer: false, hostedSession: undefined, busy: false };

test("a join request is honoured only while sharing", () => {
  assert.deepEqual(decideSignal({ ...idle, sharing: true }, { kind: "join" }), { type: "make-offer" });
  assert.deepEqual(decideSignal(idle, { kind: "join" }), { type: "ignore" });
});

test("an offer is accepted only when this computer asked for it", () => {
  assert.deepEqual(decideSignal({ ...idle, waitingForOffer: true }, { kind: "offer", code: "abc" }), {
    type: "accept-offer",
    code: "abc",
  });
  assert.deepEqual(decideSignal(idle, { kind: "offer", code: "abc" }), { type: "ignore" });
  assert.deepEqual(decideSignal({ ...idle, waitingForOffer: true }, { kind: "offer" }), { type: "ignore" });
});

test("an answer applies only to the tunnel this computer offered", () => {
  assert.deepEqual(decideSignal({ ...idle, hostedSession: "s1" }, { kind: "answer", code: "xyz" }), {
    type: "apply-answer",
    session: "s1",
    code: "xyz",
  });
  assert.deepEqual(decideSignal(idle, { kind: "answer", code: "xyz" }), { type: "ignore" });
});

test("a repeated message while one is being handled is dropped (no orphan tunnel)", () => {
  assert.deepEqual(decideSignal({ ...idle, sharing: true, busy: true }, { kind: "join" }), { type: "ignore" });
});

test("garbage is ignored", () => {
  for (const data of [null, "join", 5, [], { kind: 7 }, { kind: "other" }]) {
    assert.deepEqual(decideSignal({ ...idle, sharing: true, waitingForOffer: true }, data), { type: "ignore" });
  }
});
