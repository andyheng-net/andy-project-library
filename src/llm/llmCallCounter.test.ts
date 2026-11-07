import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createLlmCallCounter, installLlmCallCounter, uninstallLlmCallCounterForTest, wrapFetchForLlmCount,
  detectLlmLabel, loadLlmProviderHosts, llmProviderOf, llmModelOf, llmOutcomeOf, sgtDay,
} from "./llmCallCounter.ts";

const HOSTS = { "api.deepinfra.com": "DeepInfra", "api.groq.com": "Groq", "api.sea-lion.ai": "SEA-LION" };
const quiet = { error() {}, log() {} };

function fakeDb(status = 204) {
  const calls: { url: string; body: any; headers: any }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const base = (extra: Record<string, unknown> = {}) => ({
  project: "proj-a", supabaseUrl: "https://x.supabase.co", serviceKey: "k", env: { VERCEL_ENV: "production" },
  hosts: HOSTS, logger: quiet, ...extra,
});

afterEach(() => uninstallLlmCallCounterForTest());

describe("hosts, labels, models and outcomes", () => {
  test("labels: Claude Code, Vercel production, Vercel preview, local", () => {
    assert.equal(detectLlmLabel({ CLAUDECODE: "1", VERCEL_ENV: "production" }), "claude-code-dev");
    assert.equal(detectLlmLabel({ VERCEL: "1", VERCEL_ENV: "production" }), "production");
    assert.equal(detectLlmLabel({ VERCEL: "1", VERCEL_ENV: "preview" }), "preview");
    assert.equal(detectLlmLabel({}), "local-dev");
  });
  test("hosts from env when set, else the defaults", () => {
    assert.deepEqual(loadLlmProviderHosts({ LLM_PROVIDER_HOSTS: "API.X.com=X" }), { "api.x.com": "X" });
    assert.equal(loadLlmProviderHosts({})["api.sea-lion.ai"], "SEA-LION");
  });
  test("provider, model and outcome", () => {
    assert.equal(llmProviderOf("https://api.sea-lion.ai/v1/chat/completions", HOSTS), "SEA-LION");
    assert.equal(llmProviderOf("https://api.tavily.com/search", HOSTS), null);
    assert.equal(llmProviderOf("https://api.groq.com.evil.io/x", HOSTS), null);
    assert.equal(llmModelOf("https://api.groq.com/x", JSON.stringify({ model: "llama" })), "llama");
    assert.equal(llmModelOf("https://api.deepinfra.com/v1/inference/openai/whisper", undefined), "openai/whisper");
    assert.equal(llmModelOf("https://api.groq.com/x", "nope"), "unknown");
    assert.equal(llmOutcomeOf(200), "worked");
    assert.equal(llmOutcomeOf(429), "limited");
    assert.equal(llmOutcomeOf(400, "reached your user-set limit"), "limited");
    assert.equal(llmOutcomeOf(500), "failed");
    assert.equal(llmOutcomeOf(null), "failed");
  });
  test("SGT day rolls over at 16:00 UTC", () => {
    assert.equal(sgtDay(Date.UTC(2026, 10, 7, 15, 59)), "2026-11-07");
    assert.equal(sgtDay(Date.UTC(2026, 10, 7, 16, 0)), "2026-11-08");
  });
});

describe("counter", () => {
  test("saves one row per call to the configured schema", async () => {
    const db = fakeDb();
    const c = createLlmCallCounter(base({ fetchImpl: db.fn, schema: "dev", now: () => Date.UTC(2026, 10, 7, 2) }));
    assert.equal(await c.record({ provider: "Groq", model: "m", status: 200 }), true);
    assert.match(db.calls[0].url, /\/rest\/v1\/rpc\/bump_llm_api_calls$/);
    assert.equal(db.calls[0].headers["Content-Profile"], "dev");
    assert.deepEqual(db.calls[0].body.rows, [{ day: "2026-11-07", project: "proj-a", label: "production", provider: "Groq", model: "m", outcome: "worked", calls: 1, session: null }]);
  });
  test("a failed save goes to failureLog once per 24h and never throws", async () => {
    const db = fakeDb(500);
    const fails: string[] = [];
    let t = 1_000;
    const c = createLlmCallCounter(base({ fetchImpl: db.fn, now: () => t, failureLog: { fail: (task: string) => { fails.push(task); } } }));
    assert.equal(await c.record({ provider: "Groq", model: "m", status: 200 }), false);
    assert.equal(await c.record({ provider: "Groq", model: "m", status: 200 }), false);
    assert.deepEqual(fails, ["llm call counter"]);
    t += 25 * 60 * 60 * 1000;
    await c.record({ provider: "Groq", model: "m", status: 200 });
    assert.equal(fails.length, 2);
  });
  test("missing Supabase settings: reported, not thrown", async () => {
    const fails: string[] = [];
    const c = createLlmCallCounter(base({ supabaseUrl: "", serviceKey: "", env: {}, failureLog: { fail: (t: string) => { fails.push(t); } } }));
    assert.equal(await c.record({ provider: "Groq", model: "m", status: 200 }), false);
    assert.equal(fails.length, 1);
  });
});

describe("fetch wrapper", () => {
  function stub() {
    const seen: any[] = [];
    return { counter: { project: "p", label: "x", hosts: HOSTS, record: async (c: any) => { seen.push(c); return true; } }, seen };
  }
  test("success: counted before the untouched response comes back", async () => {
    const { counter, seen } = stub();
    const real = new Response("ok", { status: 200 });
    const f = wrapFetchForLlmCount((async () => real) as unknown as typeof fetch, () => counter);
    const got = await f("https://api.groq.com/openai/v1/chat/completions", { body: JSON.stringify({ model: "q" }) });
    assert.equal(got, real);
    assert.deepEqual(seen, [{ provider: "Groq", model: "q", status: 200, bodyText: "" }]);
  });
  test("error: body read from a clone, original still readable", async () => {
    const { counter, seen } = stub();
    const f = wrapFetchForLlmCount((async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch, () => counter);
    const got = await f(new URL("https://api.sea-lion.ai/v1/chat/completions"), { body: "{}" });
    assert.equal(await got.text(), "rate limited");
    assert.equal(seen[0].bodyText, "rate limited");
  });
  test("network error: counted with no status and rethrown; other hosts uncounted", async () => {
    const { counter, seen } = stub();
    const f = wrapFetchForLlmCount((async (u: string) => { if (String(u).includes("groq")) throw new Error("ECONNRESET"); return new Response("x"); }) as unknown as typeof fetch, () => counter);
    await assert.rejects(f("https://api.groq.com/x"), /ECONNRESET/);
    await f("https://api.tavily.com/search");
    assert.deepEqual(seen, [{ provider: "Groq", model: "unknown", status: null }]);
  });
});

test("install wraps global fetch once and saves through the real fetch", async () => {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string) => { urls.push(String(u)); return new Response(null, { status: String(u).includes("supabase") ? 204 : 200 }); }) as unknown as typeof fetch;
  try {
    installLlmCallCounter(base());
    const wrapped = globalThis.fetch;
    installLlmCallCounter(base({ project: "proj-b" }));
    assert.equal(globalThis.fetch, wrapped);
    await globalThis.fetch("https://api.groq.com/openai/v1/chat/completions", { body: '{"model":"m"}' });
  } finally {
    uninstallLlmCallCounterForTest();
    globalThis.fetch = realFetch;
  }
  assert.equal(urls.filter((u) => u.includes("groq")).length, 1);
  assert.equal(urls.filter((u) => u.includes("bump_llm_api_calls")).length, 1);
});
