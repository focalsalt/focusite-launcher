import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRemainingSplashDelay,
  runSequentialPrefetch,
} from "./startupOrchestrator.ts";

test("computeRemainingSplashDelay enforces minimum splash contract", () => {
  // Case 1: 100ms elapsed -> should wait remaining 300ms
  const delay1 = computeRemainingSplashDelay({
    bootStartTimeMs: 1000,
    nowMs: 1100,
    minSplashDurationMs: 400,
  });
  assert.equal(delay1, 300);

  // Case 2: 450ms elapsed -> already exceeded, 0ms delay
  const delay2 = computeRemainingSplashDelay({
    bootStartTimeMs: 1000,
    nowMs: 1450,
    minSplashDurationMs: 400,
  });
  assert.equal(delay2, 0);

  // Case 3: Clock skew or negative elapsed -> safe fallback
  const delay3 = computeRemainingSplashDelay({
    bootStartTimeMs: 2000,
    nowMs: 1900,
    minSplashDurationMs: 400,
  });
  assert.equal(delay3, 400);
});

test("runSequentialPrefetch executes tasks sequentially with error isolation", async () => {
  const executionOrder = [];

  const tasks = [
    async () => {
      executionOrder.push("task-1");
      return "res-1";
    },
    async () => {
      executionOrder.push("task-2");
      throw new Error("Simulated network glitch");
    },
    async () => {
      executionOrder.push("task-3");
      return "res-3";
    },
  ];

  const completed = await runSequentialPrefetch(tasks, 10);
  assert.equal(completed, 2);
  assert.deepEqual(executionOrder, ["task-1", "task-2", "task-3"]);
});

test("runSequentialPrefetch aborts immediately when signal fires", async () => {
  const executionOrder = [];
  const ac = new AbortController();

  const tasks = [
    async () => {
      executionOrder.push("task-1");
      ac.abort();
    },
    async () => {
      executionOrder.push("task-2");
    },
  ];

  const completed = await runSequentialPrefetch(tasks, 50, ac.signal);
  assert.equal(completed, 1);
  assert.deepEqual(executionOrder, ["task-1"]);
});
