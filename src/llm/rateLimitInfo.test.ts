import { test } from "node:test";
import assert from "node:assert/strict";
import { readRateLimitInfo } from "./rateLimitInfo.ts";

test("reads a Go-style duration from Groq's reset-tokens header", () => {
  const headers = new Headers({ "x-ratelimit-reset-tokens": "1m26.4s" });
  const info = readRateLimitInfo(headers);
  assert.equal(info.retryAfterMs, 86_400);
  assert.equal(info.blocked, false);
});

test("takes the max of reset-tokens and reset-requests when both present", () => {
  const headers = new Headers({
    "x-ratelimit-reset-tokens": "500ms",
    "x-ratelimit-reset-requests": "9.137s",
  });
  const info = readRateLimitInfo(headers);
  assert.equal(info.retryAfterMs, 9_137);
});

test("falls back to a generic retry-after header in seconds", () => {
  const headers = new Headers({ "retry-after": "12" });
  const info = readRateLimitInfo(headers);
  assert.equal(info.retryAfterMs, 12_000);
});

test("returns no signal when no recognized header is present", () => {
  const headers = new Headers();
  const info = readRateLimitInfo(headers);
  assert.equal(info.retryAfterMs, null);
  assert.equal(info.blocked, false);
});

test("parses a combined duration like 2h1m", () => {
  const headers = new Headers({ "x-ratelimit-reset-tokens": "2h1m" });
  const info = readRateLimitInfo(headers);
  assert.equal(info.retryAfterMs, 2 * 3_600_000 + 60_000);
});
