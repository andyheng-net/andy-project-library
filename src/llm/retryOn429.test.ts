import { test } from "node:test";
import assert from "node:assert/strict";
import { withRateLimitRetry } from "./retryOn429.ts";

test("returns the first result immediately when it's ok", async () => {
  let calls = 0;
  const result = await withRateLimitRetry(async () => {
    calls++;
    return { ok: true };
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test("retries once on a 429", async () => {
  let calls = 0;
  const result = await withRateLimitRetry(async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, retryAfterMs: 1 };
    return { ok: true };
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test("retries once on an unusable 2xx", async () => {
  let calls = 0;
  const result = await withRateLimitRetry(async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 200, retryAfterMs: 1 };
    return { ok: true };
  });
  assert.equal(calls, 2);
});

test("never retries a blocked result", async () => {
  let calls = 0;
  const result = await withRateLimitRetry(async () => {
    calls++;
    return { ok: false, status: 429, blocked: true };
  });
  assert.equal(calls, 1);
  assert.equal(result.blocked, true);
});

test("does not retry a non-retryable status (e.g. 400)", async () => {
  let calls = 0;
  await withRateLimitRetry(async () => {
    calls++;
    return { ok: false, status: 400 };
  });
  assert.equal(calls, 1);
});
