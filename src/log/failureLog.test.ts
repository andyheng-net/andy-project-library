import { test } from "node:test";
import assert from "node:assert/strict";
import { createFailureLog, classifyFailureCause, detectProvider, stackFilesOf, maskPersonalData, maskSecrets, type FailureRow } from "./failureLog.ts";

function setup(overrides: Record<string, unknown> = {}) {
  const writes: { url: string; headers: Record<string, string>; row: FailureRow }[] = [];
  const errors: string[] = [];
  let t = Date.UTC(2026, 8, 30, 8);
  const fetchImpl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    writes.push({ url, headers: init.headers, row: JSON.parse(init.body) });
    return { ok: true, status: 201 };
  }) as unknown as typeof fetch;
  const log = createFailureLog({
    project: "andy-test",
    supabaseUrl: "https://abc.supabase.co",
    serviceKey: "k",
    schema: "public",
    runId: "r1",
    flushOnExit: false,
    rootDir: "/var/task",
    fetchImpl,
    logger: { error: (m: string) => errors.push(m) },
    now: () => t,
    ...overrides,
  });
  return { log, writes, errors, advance: (ms: number) => { t += ms; } };
}

test("fail writes one masked row to public.activity_events", async () => {
  const { log, writes } = setup();
  const err = new Error("SEA-LION HTTP 429 for S1234567D, mail jane@x.com");
  err.stack = "Error: x\n    at extract (/var/task/src/lib/extract.ts:10:3)\n    at y (/var/task/node_modules/z/a.js:1:1)";
  assert.equal(await log.fail("card extraction", err, { details: { phone: "9123 4567" } }), true);
  const { url, headers, row } = writes[0];
  assert.equal(url, "https://abc.supabase.co/rest/v1/activity_events");
  assert.equal(headers["Content-Profile"], "public");
  assert.equal(row.cause, "rate_limit");
  assert.equal(row.provider, "sea-lion");
  assert.equal(row.run_id, "r1");
  assert.deepEqual(row.stack_files, ["src/lib/extract.ts:10"]);
  assert.doesNotMatch(row.error_message, /S1234567D|jane/);
  assert.deepEqual(row.details, { phone: "[phone]" });
});

test("repeats roll up; flush writes held repeats; next window folds them in", async () => {
  const { log, writes, advance } = setup({ rollupMs: 60000 });
  await log.fail("poll", new Error("fetch failed 1"));
  advance(1000);
  assert.equal(await log.fail("poll", new Error("fetch failed 2")), false);
  assert.equal(await log.flush(), 1);
  assert.equal(writes[1].row.count, 1);
  advance(1000);
  await log.fail("poll", new Error("fetch failed 3"));
  advance(60000);
  await log.fail("poll", new Error("fetch failed 4"));
  assert.equal(writes.length, 3);
  assert.equal(writes[2].row.count, 2);
});

test("never throws; warns once when unconfigured", async () => {
  const none = setup({ supabaseUrl: "" });
  assert.equal(await none.log.fail("a", new Error("x")), false);
  assert.equal(await none.log.fail("b", new Error("y")), false);
  assert.equal(none.errors.length, 1);
  const bad = setup({ fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
  assert.equal(await bad.log.fail("a", new Error("x")), false);
  assert.match(bad.errors[0], /offline/);
});

test("wrap logs once and rethrows", async () => {
  const { log, writes } = setup();
  const boom = new TypeError("x is not a function");
  const inner = log.wrap("inner", async () => { throw boom; });
  await assert.rejects(log.wrap("outer", () => inner())(), (e) => e === boom);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].row.cause, "bug");
  assert.equal(await log.run("ok", () => 5), 5);
});

test("classifier, provider and stack parsing match the Sckyroom library", () => {
  assert.equal(classifyFailureCause(new Error("code insufficient_quota")), "quota");
  assert.equal(classifyFailureCause(new Error("Quotation.pdf")), "unknown");
  assert.equal(classifyFailureCause({ message: "x", code: "23505" }), "validation");
  assert.equal(classifyFailureCause({ message: "x", code: "08006" }), "db_gateway");
  assert.equal(classifyFailureCause(new Error("HTTP 503")), "external_down");
  assert.equal(classifyFailureCause(new Error("Missing required env vars")), "bad_config");
  assert.equal(detectProvider(new Error("groq said no")), "groq");
  assert.deepEqual(stackFilesOf({ stack: "at a (/Users/x/app/src/a.ts:1:1)" }, "/Users/x/app"), ["src/a.ts:1"]);
  assert.equal(maskPersonalData("KHC1/R2 - Jane Tan"), "KHC1/R2 - [tenant]");
  assert.equal(maskSecrets("?api_key=abc"), "?api_key=[secret]");
});
