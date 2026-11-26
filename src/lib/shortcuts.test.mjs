import test from "node:test";
import assert from "node:assert/strict";
import { matchShortcut } from "./shortcuts.ts";

const press = (key, extra = {}) => ({ key, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, repeat: false, ...extra });

test("maps the global shortcuts", () => {
  assert.deepEqual(matchShortcut(press("1"), false), { type: "navigate", view: "news" });
  assert.deepEqual(matchShortcut(press("4"), true), { type: "navigate", view: "settings" });
  assert.deepEqual(matchShortcut(press("Enter"), false), { type: "launch" });
  assert.deepEqual(matchShortcut(press("F1", { ctrlKey: false }), true), { type: "help" });
});

test("ignores everything else", () => {
  assert.equal(matchShortcut(press("Enter"), true), null);
  assert.equal(matchShortcut(press("Enter", { repeat: true }), false), null);
  assert.equal(matchShortcut(press("Enter", { ctrlKey: false }), false), null);
  assert.equal(matchShortcut(press("1", { shiftKey: true }), false), null);
  assert.equal(matchShortcut(press("0"), false), null);
  assert.equal(matchShortcut(press("5"), false), null);
});
