import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILES, clearCachedFiles, getCachedFiles, setCachedFiles } from "./instanceFilesCache.ts";

test("a cached listing is returned per instance until cleared", () => {
  assert.equal(getCachedFiles("a"), undefined);
  const files = { ...EMPTY_FILES, servers: [{ name: "S", ip: "1.2.3.4" }] };
  setCachedFiles("a", files);
  assert.equal(getCachedFiles("a"), files);
  assert.equal(getCachedFiles("b"), undefined);
  clearCachedFiles("a");
  assert.equal(getCachedFiles("a"), undefined);
});
