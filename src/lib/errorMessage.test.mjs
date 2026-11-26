import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { isCancelled, toUserMessage } from "./errorMessage.ts";
import { enUS } from "../i18n/locales/en-US.ts";

let language = "zh-TW";
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => language } });

test("recognises the cancel code", () => {
  assert.equal(isCancelled("E_CANCELLED"), true);
  assert.equal(isCancelled(new Error("network down")), false);
});

test("localises known errors", () => {
  language = "zh-TW";
  assert.equal(toUserMessage("E_CANCELLED"), "已取消");
  language = "en-US";
  assert.equal(toUserMessage("E_CANCELLED"), "Cancelled");
  assert.match(toUserMessage("error sending request for url"), /network/i);
});

test("translates backend codes, preferring the innermost one", () => {
  language = "en-US";
  assert.equal(toUserMessage("E_INSTANCE_BUSY"), enUS.errorCodes.E_INSTANCE_BUSY);
  assert.equal(toUserMessage("E_PREPARE_FAILED: E_ALREADY_INSTALLING"), enUS.errorCodes.E_ALREADY_INSTALLING);
  assert.equal(toUserMessage("E_VERSION_FILE_BROKEN: a.json: expected value"), enUS.errorCodes.E_VERSION_FILE_BROKEN);
});

test("explains a failed step by its cause when the cause is known", () => {
  language = "en-US";
  assert.equal(toUserMessage("E_PREPARE_FAILED: error sending request"), enUS.errorText.network);
  assert.equal(toUserMessage("E_SPAWN_FAILED: boom"), enUS.errorCodes.E_SPAWN_FAILED);
  language = "zh-TW";
  assert.equal(toUserMessage("E_PREPARE_FAILED: 找不到版本"), "準備遊戲檔案失敗：找不到版本");
});

test("every code the backend returns has a message", () => {
  const codes = ["../../src-tauri/src/", "../../crates/"].flatMap((path) => {
    const root = new URL(path, import.meta.url);
    return readdirSync(root, { recursive: true })
      .filter((file) => file.endsWith(".rs"))
      .flatMap((file) => readFileSync(new URL(file.replaceAll("\\", "/"), root), "utf8").match(/(?<=")E_[A-Z_]+(?=[":])/g) ?? []);
  });
  assert.ok(codes.length > 0);
  assert.deepEqual([...new Set(codes)].filter((code) => !(code in enUS.errorCodes)), []);
});

test("keeps data details and reads the full-width colon of ctx()", () => {
  language = "en-US";
  assert.equal(toUserMessage("E_VERSION_NOT_FOUND: 1.99"), `${enUS.errorCodes.E_VERSION_NOT_FOUND}: 1.99`);
  assert.equal(toUserMessage("E_CONNECTION：error sending request"), enUS.errorText.network);
  assert.equal(toUserMessage("E_FILE_STORE_FAILED：boom"), enUS.errorCodes.E_FILE_STORE_FAILED);
});

test("shows backend Chinese text only in the Chinese UI", () => {
  language = "zh-TW";
  assert.equal(toUserMessage("找不到實例"), "找不到實例");
  language = "en-US";
  assert.equal(toUserMessage("找不到實例"), "Something went wrong. Please try again.");
  assert.equal(toUserMessage("找不到實例", "Search failed"), "Search failed");
});
