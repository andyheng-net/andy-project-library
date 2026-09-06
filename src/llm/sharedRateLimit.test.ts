import { test } from "node:test";
import assert from "node:assert/strict";
import { clampWaitMs, MAX_WAIT_MS } from "./sharedRateLimit.ts";

test("clampWaitMs passes through a server wait within budget", () => {
  assert.equal(clampWaitMs(5000, 0), 5000);
});

test("clampWaitMs caps at the remaining time budget", () => {
  assert.equal(clampWaitMs(5000, MAX_WAIT_MS - 100), 100);
});

test("clampWaitMs never goes negative once the budget is exhausted", () => {
  assert.equal(clampWaitMs(5000, MAX_WAIT_MS), 0);
  assert.equal(clampWaitMs(5000, MAX_WAIT_MS + 1000), 0);
});

test("clampWaitMs never returns negative for a negative server value", () => {
  assert.equal(clampWaitMs(-100, 0), 0);
});
