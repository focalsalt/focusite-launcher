import test from "node:test";
import assert from "node:assert/strict";
import { diagnosisReducer, initialDiagnosis, initialProcess, processReducer } from "./logWindowReducers.ts";

test("an exit event keeps the exit code and drops the pid", () => {
  const running = processReducer(initialProcess, { type: "running", pid: 7 });
  const same = processReducer(running, { type: "statusEvent", event: { status: "running" } });
  assert.equal(same.activePid, 7);
  const crashed = processReducer(running, { type: "statusEvent", event: { status: "crashed", exit_code: 1, pid: 7 } });
  assert.deepEqual(crashed, { status: "crashed", activePid: null, exitCode: 1 });
  const next = processReducer(crashed, { type: "statusEvent", event: { status: "launching", exit_code: null } });
  assert.equal(next.exitCode, 1);
});

test("a new diagnosis shows the card again", () => {
  const dismissed = diagnosisReducer(initialDiagnosis, { type: "dismiss" });
  assert.equal(diagnosisReducer(dismissed, { type: "started" }).dismissed, false);
});
