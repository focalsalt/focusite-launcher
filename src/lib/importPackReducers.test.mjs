import test from "node:test";
import assert from "node:assert/strict";
import { formReducer, initialForm, initialInspection, initialJob, inspectionReducer, jobReducer } from "./importPackReducers.ts";

test("suggested names stop once the user types one", () => {
  const browsed = formReducer(initialForm, { type: "browsed", path: "a.zip", suggestedName: "a" });
  assert.equal(browsed.customName, "a");
  const typed = formReducer(browsed, { type: "name", name: "mine" });
  assert.equal(formReducer(typed, { type: "browsed", path: "b.zip", suggestedName: "b" }).customName, "mine");
  const picked = formReducer(typed, { type: "pick", project: { title: "Pack" }, version: { id: "1", label: "1.0" } });
  assert.equal(picked.customName, "mine");
  assert.deepEqual(formReducer(picked, { type: "reset" }), initialForm);
});

test("clearing an inspection drops its data and error", () => {
  const failed = inspectionReducer(initialInspection, { type: "failed", error: "bad" });
  assert.equal(failed.error, "bad");
  assert.deepEqual(inspectionReducer(failed, { type: "clear" }), initialInspection);
});

test("a finished job keeps its result until reset", () => {
  const running = jobReducer(jobReducer(initialJob, { type: "started" }), { type: "cancelRequested" });
  const result = { missingMods: [{ fileName: "x.jar" }] };
  const done = jobReducer(jobReducer(running, { type: "succeeded", result }), { type: "finished" });
  assert.equal(done.isImporting, false);
  assert.equal(done.cancelling, false);
  assert.equal(done.missingMods.length, 1);
  assert.equal(jobReducer(done, { type: "reset" }).result, null);
});
