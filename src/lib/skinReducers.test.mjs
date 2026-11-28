import test from "node:test";
import assert from "node:assert/strict";
import { createSkinPreview, skinPreviewReducer, skinProfileReducer } from "./skinReducers.ts";

test("reset returns to the last saved appearance", () => {
  let state = createSkinPreview("s0", "c0", "default");
  state = skinPreviewReducer(state, { type: "selectSkin", url: "s1", model: "slim" });
  state = skinPreviewReducer(state, { type: "saved", skinUrl: "s1", capeUrl: "c0" });
  state = skinPreviewReducer(state, { type: "selectCape", url: "c1" });
  state = skinPreviewReducer(state, { type: "reset", model: "auto-detect" });
  assert.deepEqual(state, createSkinPreview("s1", "c0", "auto-detect"));
});

test("a refreshed profile only replaces the fields it carries", () => {
  const state = { capes: ["a"], hasValidToken: true, isRefreshing: true };
  const next = skinProfileReducer(state, { type: "refreshed", account: { hasValidToken: false } });
  assert.deepEqual(next, { capes: ["a"], hasValidToken: false, isRefreshing: true });
});
