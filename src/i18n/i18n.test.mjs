import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
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

// Language names are written in their own language on purpose.
const ALLOWED_CHINESE = new Set(["繁體中文 (台灣)"]);

test("no Chinese text is hard-coded outside the dictionaries", () => {
  const root = new URL("../", import.meta.url);
  const found = [];
  for (const name of readdirSync(root, { recursive: true })) {
    const file = name.replaceAll("\\", "/");
    if (!/\.tsx?$/.test(file) || file.startsWith("i18n/")) continue;
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      // Regular expressions are skipped: they match text the backend or the system produces.
      const isText =
        ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddleOrTemplateTail(node);
      if (isText && /[\u4e00-\u9fff]/.test(node.text) && !ALLOWED_CHINESE.has(node.text)) found.push(`${file}: ${node.text.trim()}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(found, []);
});
