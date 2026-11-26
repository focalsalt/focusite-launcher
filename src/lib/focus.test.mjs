import test from "node:test";
import assert from "node:assert/strict";
import { wrapTarget } from "./focus.ts";

test("wraps focus only at the edges of a trap", () => {
  assert.equal(wrapTarget(3, 2, false), 0);
  assert.equal(wrapTarget(3, 0, true), 2);
  assert.equal(wrapTarget(3, 1, false), null);
  assert.equal(wrapTarget(3, -1, false), 0);
  assert.equal(wrapTarget(3, -1, true), 2);
});
