import test from "node:test";
import assert from "node:assert/strict";
import { instanceSettingsReducer, toSettingsDraft } from "./instanceSettingsReducer.ts";

test("sync replaces unsaved changes with the instance's settings and defaults", () => {
  const changed = instanceSettingsReducer(toSettingsDraft(null), { type: "change", changes: { maxRam: 8192 } });
  assert.equal(changed.maxRam, 8192);
  const synced = instanceSettingsReducer(changed, { type: "sync", instance: { javaPath: "java" } });
  assert.deepEqual(synced, { maxRam: 4096, javaPath: "java", showLogOnLaunch: false });
});
