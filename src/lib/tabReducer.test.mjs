import test from "node:test";
import assert from "node:assert/strict";
import { tabReducer } from "./tabReducer.ts";

test("direction follows tab order and is kept for a plain replacement", () => {
  const order = { a: 0, b: 1 };
  const start = { tab: "a", direction: 0 };
  const forward = tabReducer(start, { to: "b", order });
  assert.deepEqual(forward, { tab: "b", direction: 1 });
  assert.deepEqual(tabReducer(forward, { to: "a", order }), { tab: "a", direction: -1 });
  assert.deepEqual(tabReducer(forward, { to: "a" }), { tab: "a", direction: 1 });
  assert.equal(tabReducer(start, { to: "a", order }), start);
});
