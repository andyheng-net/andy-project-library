// LLM call counter (Decision 12, sckyroom-bug-hunter M28, Andy 07/11/2026) - the TypeScript twin of
// sckyroom-project-library's llmCallCounter.js (its Decision 49), same table shape and outcomes, for
// Andy's personal apps. Every call to an LLM provider host is counted by SGT day, project, label,
// provider, model and outcome in llm_api_calls of the shared personal Supabase project (created by
// sckyroom-bug-hunter's migrations/external/llm_api_calls_public.sql, public + dev). Bug Hunter reads
// public.llm_api_calls nightly.
//
//   // instrumentation.ts (runs once per server instance)
//   import { installLlmCallCounter } from "andy-project-library";
//   import { failureLog } from "@/lib/failureLog";
//   export function register() { installLlmCallCounter({ project: "andy-namecard-holder", failureLog }); }
//
// Difference from the Sckyroom version, on purpose: each call is SAVED BEFORE the response is handed
// back (one small RPC, at most saveTimeoutMs), because Vercel freezes an instance once the response
// is sent, so a batch held in memory could be lost. The LLM call itself takes seconds; this adds the
// RPC round trip, not the LLM's time again.
//
// Hosts: env LLM_PROVIDER_HOSTS (host=Name,host=Name) when set, else DEFAULT_LLM_PROVIDER_HOSTS below
// (kept equal to sckyroom-project-library's config/llm-provider-hosts.json; a file read is not used
// because this must also load in the Edge runtime).
// Labels: claude-code-dev (env CLAUDECODE), production (VERCEL_ENV=production, or RENDER), preview
// (any other Vercel environment), local-dev (anything else, e.g. `next dev`).
// Outcome: worked (2xx), limited (402, 429, or DeepInfra's spending-cap text), failed (anything else,
// or no response).
//
// Guarantees: counting never throws into the caller and never changes the response (an error body is
// read from a clone); a failed save is logged and passed to failureLog.fail at most once per 24h per
// instance, so Bug Hunter sees it without a burst of rows.
//
// Self-contained on purpose (no imports), like failureLog.ts: Next.js and `node --test
// --experimental-strip-types` resolve imports differently.

export const DEFAULT_LLM_PROVIDER_HOSTS: Readonly<Record<string, string>> = {
  "api.deepinfra.com": "DeepInfra",
  "api.groq.com": "Groq",
  "api.sea-lion.ai": "SEA-LION",
};

export type LlmOutcome = "worked" | "limited" | "failed";

export type LlmCallRow = {
  day: string; project: string; label: string; provider: string; model: string;
  outcome: LlmOutcome; calls: number; session: string | null;
};

export type LlmCallCounterOptions = {
  project: string;
  failureLog?: { fail: (task: string, err: unknown, opts?: { provider?: string; details?: unknown }) => unknown };
  supabaseUrl?: string;
  serviceKey?: string;
  schema?: string;
  hosts?: Record<string, string>;
  saveTimeoutMs?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  logger?: { error: (msg: string) => void; log?: (msg: string) => void };
  now?: () => number;
};

export type LlmCallCounter = {
  project: string;
  label: string;
  hosts: Record<string, string>;
  record: (call: { provider: string; model: string; status: number | null; bodyText?: string }) => Promise<boolean>;
};

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const FAILURE_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_MODEL_CHARS = 200;

const processEnv = (): Record<string, string | undefined> => (typeof process !== "undefined" && process.env ? process.env : {});

export const sgtDay = (ms: number): string => new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 10);

export function detectLlmLabel(env: Record<string, string | undefined> = processEnv()): string {
  if (env.CLAUDECODE) return "claude-code-dev";
  if (env.VERCEL_ENV === "production" || env.RENDER || env.RENDER_SERVICE_ID) return "production";
  if (env.VERCEL || env.VERCEL_ENV) return "preview";
  return "local-dev";
}

export function loadLlmProviderHosts(env: Record<string, string | undefined> = processEnv()): Record<string, string> {
  const raw = String(env.LLM_PROVIDER_HOSTS ?? "").trim();
  if (!raw) return { ...DEFAULT_LLM_PROVIDER_HOSTS };
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [host, name] = pair.split("=").map((s) => s?.trim());
    if (host) out[host.toLowerCase()] = name || host;
  }
  return out;
}

export function llmProviderOf(url: unknown, hosts: Record<string, string>): string | null {
  let host: string;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return null; }
  for (const [h, name] of Object.entries(hosts)) if (host === h || host.endsWith(`.${h}`)) return name;
  return null;
}

export function llmModelOf(url: unknown, body: unknown): string {
  let model: unknown = null;
  try {
    if (typeof body === "string") model = JSON.parse(body)?.model;
    else if (body && typeof (body as FormData).get === "function") model = (body as FormData).get("model");
  } catch { /* not JSON: fall through to the path */ }
  if (typeof model !== "string" || !model.trim()) {
    try { model = new URL(String(url)).pathname.match(/\/v1\/inference\/(.+)$/)?.[1] ?? null; } catch { model = null; }
  }
  return typeof model === "string" && model.trim() ? model.trim().slice(0, MAX_MODEL_CHARS) : "unknown";
}

export function llmOutcomeOf(status: number | null, bodyText = ""): LlmOutcome {
  if (status !== null && status >= 200 && status < 300) return "worked";
  const text = bodyText.toLowerCase();
  if (status === 402 || status === 429 || (status !== null && (text.includes("user-set limit") || text.includes("positive balance")))) return "limited";
  return "failed";
}

export function createLlmCallCounter(options: LlmCallCounterOptions): LlmCallCounter {
  const env = options.env ?? processEnv();
  const {
    project,
    failureLog,
    supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
    schema = env.NEXT_PUBLIC_SUPABASE_SCHEMA || "public",
    hosts = loadLlmProviderHosts(env),
    saveTimeoutMs = 3000,
    fetchImpl = fetch,
    logger = console,
    now = () => Date.now(),
  } = options;
  if (typeof project !== "string" || !project.trim()) throw new Error("createLlmCallCounter requires a project name");
  const label = detectLlmLabel(env);
  const session = env.CLAUDE_CODE_SESSION_ID || null;
  let lastFailureAlertAt = -Infinity;

  async function saveFailed(err: unknown, provider: string): Promise<void> {
    const message = (err as Error)?.message ?? String(err);
    logger.error(`[llmCallCounter] could not save an LLM call count: ${message}`);
    if (!failureLog || now() - lastFailureAlertAt < FAILURE_ALERT_COOLDOWN_MS) return;
    lastFailureAlertAt = now();
    try { await failureLog.fail("llm call counter", err, { provider, details: { note: "LLM call count not saved; further failures in this instance are not reported for 24h" } }); } catch { /* last resort */ }
  }

  // Saves one call. Never throws; true when saved.
  async function record(call: { provider: string; model: string; status: number | null; bodyText?: string }): Promise<boolean> {
    const row: LlmCallRow = {
      day: sgtDay(now()), project, label, provider: call.provider, model: call.model,
      outcome: llmOutcomeOf(call.status, call.bodyText ?? ""), calls: 1, session,
    };
    try {
      if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL / service key missing, LLM calls are not being counted");
      const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/bump_llm_api_calls`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", "Content-Profile": schema },
        body: JSON.stringify({ rows: [row] }),
        signal: AbortSignal.timeout(saveTimeoutMs),
      });
      if (!res.ok) throw new Error(`bump_llm_api_calls HTTP ${res.status}`);
      return true;
    } catch (err) {
      await saveFailed(err, call.provider);
      return false;
    }
  }

  return { project, label, hosts, record };
}

// fetch wrapper: the real response is handed back untouched, after its count is saved.
export function wrapFetchForLlmCount(original: typeof fetch, getCounter: () => LlmCallCounter | null): typeof fetch {
  const counted = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const counter = getCounter();
    const url = typeof input === "string" || input instanceof URL ? String(input) : (input as Request)?.url;
    const provider = counter ? llmProviderOf(url, counter.hosts) : null;
    if (!counter || !provider) return original(input, init);
    const model = llmModelOf(url, init?.body);
    let res: Response;
    try {
      res = await original(input, init);
    } catch (err) {
      await counter.record({ provider, model, status: null });
      throw err;
    }
    let bodyText = "";
    if (!res.ok) {
      try { bodyText = (await res.clone().text()).slice(0, 2000); } catch { /* count without the text */ }
    }
    await counter.record({ provider, model, status: res.status, bodyText });
    return res;
  };
  (counted as { __llmCallCounter?: boolean }).__llmCallCounter = true;
  return counted as typeof fetch;
}

let active: LlmCallCounter | null = null;
let originalFetch: typeof fetch | null = null;

// Call once per server instance (Next.js instrumentation.ts register()). Calling again replaces the counter.
export function installLlmCallCounter(options: LlmCallCounterOptions): LlmCallCounter {
  if (!originalFetch) originalFetch = globalThis.fetch;
  const real = originalFetch;
  active = createLlmCallCounter({ ...options, fetchImpl: options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => real(...a)) });
  if (!(globalThis.fetch as { __llmCallCounter?: boolean }).__llmCallCounter) {
    globalThis.fetch = wrapFetchForLlmCount(real, () => active);
  }
  (options.logger ?? console).log?.(`[llmCallCounter] counting LLM calls for ${active.project} (${active.label}) to ${Object.values(active.hosts).join(", ")}`);
  return active;
}

// Tests only: put the real fetch back.
export function uninstallLlmCallCounterForTest(): void {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = null;
  active = null;
}
