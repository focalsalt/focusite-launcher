import test from "node:test";
import assert from "node:assert/strict";
import { zhTW } from "./locales/zh-TW.ts";
import { enUS } from "./locales/en-US.ts";

/** Flattens a dictionary into `path -> value` entries. */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

const zh = flatten(zhTW);
const en = flatten(enUS);

test("zh-TW and en-US define exactly the same keys", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test("matching keys have the same kind and function arity", () => {
  for (const [key, zhValue] of Object.entries(zh)) {
    const enValue = en[key];
    assert.equal(typeof enValue, typeof zhValue, `type mismatch for ${key}`);
    if (typeof zhValue === "function") {
      assert.equal(enValue.length, zhValue.length, `arity mismatch for ${key}`);
    }
  }
});

test("no translation is empty", () => {
  for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
    if (typeof value === "string") {
      assert.ok(value.trim().length > 0, `empty string for ${key}`);
    }
  }
});

test("functions interpolate their arguments in both languages", () => {
  assert.match(zhTW.exit.running(3), /3/);
  assert.match(enUS.exit.running(3), /3/);
  assert.match(zhTW.shell.runningAs("Steve"), /Steve/);
  assert.match(enUS.shell.runningAs("Steve"), /Steve/);
});
