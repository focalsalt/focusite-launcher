import test from "node:test";
import assert from "node:assert/strict";
import { filtersReducer, initialFilters, initialResults, resultsReducer } from "./workshopReducers.ts";

test("categories toggle without mutating the previous set, and reset restores the given version", () => {
  const on = filtersReducer(initialFilters, { type: "toggleCategory", name: "magic" });
  assert.deepEqual([...on.picked], ["magic"]);
  assert.equal(initialFilters.picked.size, 0);
  assert.equal(filtersReducer(on, { type: "toggleCategory", name: "magic" }).picked.size, 0);

  const reset = filtersReducer({ ...on, sort: "downloads", env: "client" }, { type: "reset", gameVersion: "1.20.1" });
  assert.deepEqual(reset, { sort: "relevance", env: null, gameVersion: "1.20.1", picked: new Set() });
  assert.notEqual(reset.picked, initialFilters.picked);
});

test("a first page replaces results, a later page appends, a failure keeps them", () => {
  const first = resultsReducer(resultsReducer(initialResults, { type: "started", offset: 0 }), {
    type: "loaded",
    offset: 0,
    results: ["a", "b"],
    pageSize: 2,
  });
  assert.equal(first.hasMore, true);
  assert.equal(first.isLoading, false);
  const more = resultsReducer(first, { type: "started", offset: 2 });
  assert.equal(more.isLoadingMore, true);
  const second = resultsReducer(more, { type: "loaded", offset: 2, results: ["c"], pageSize: 2 });
  assert.deepEqual(second.projects, ["a", "b", "c"]);
  assert.equal(second.hasMore, false);
  assert.deepEqual(resultsReducer(more, { type: "failed" }).projects, ["a", "b"]);
});
