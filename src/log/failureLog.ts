// Shared failure log (Decision 7) - the TypeScript twin of sckyroom-project-library's
// failureLog.js (its Decision 28), same API and same table shape, for Andy's personal apps.
// Asked for by Andy (sckyroom-bug-hunter M17-03, 30/09/2026): every repo records its failed tasks
// and why, so Bug Hunter can read them. Failures only - no success rows.
//
//   const log = createFailureLog({ project: "andy-namecard-holder" });
//   await log.fail("card extraction", err, { provider: "sea-lion", details: { cardId } });
//   const safeExtract = log.wrap("card extraction", extract); // records a thrown error, rethrows it
//   await log.run("card extraction", () => extract());         // same, run immediately
//
// Writes one row to activity_events in the shared personal Supabase project (created by
// sckyroom-bug-hunter's migrations/external/activity_events_public.sql, public + dev) through
// PostgREST. The schema follows NEXT_PUBLIC_SUPABASE_SCHEMA like the client factories (Decision 4),
// so local dev writes to dev.activity_events. Bug Hunter reads public.activity_events nightly.
//
// Guarantees: never throws, waits at most timeoutMs (5s); personal data and secrets are masked;
// sizes are capped; identical repeats within rollupMs roll into one row's `count`.
// Serverless note: on Vercel an idle instance is frozen, not exited, so a held repeat may only be
// written with the next failure after the window. The FIRST occurrence is always written at once;
// only the repeat count can come out low.
//
// Self-contained on purpose (no imports): Next.js resolves extensionless imports, `node --test
// --experimental-strip-types` does not, and this file must work under both. No Node-only modules,
// so it also loads in the Edge runtime (it just skips the beforeExit flush there).

export const FAILURE_CAUSES = [
  "rate_limit", "quota", "timeout", "network", "db_gateway", "auth",
  "bad_config", "validation", "external_down", "bug", "unknown",
] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

const MAX_MESSAGE = 1000;
const MAX_TASK = 200;
const MAX_DETAILS = 2000;
const MAX_STACK_FILES = 10;
const MAX_HELD = 500;

// ---- masking (same patterns as sckyroom-project-library's piiMask.js) ----

export function maskPersonalData(line: unknown): string {
  return String(line)
    .replace(/("?[A-Z]{2,}\d+\/R\d+)\s+-\s+[^"()\n]+/g, "$1 - [tenant]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b[STFGM]\d{7}[A-Z]\b/g, "[nric]")
    .replace(/\+\d{1,3}[\s-]?\d[\d\s-]{6,}\d|\b[689]\d{3}[\s-]?\d{4}\b/g, "[phone]");
}

export function maskSecrets(line: unknown): string {
  return String(line)
    .replace(/\bbot\d{6,}:[\w-]{20,}/g, "bot[token]")
    .replace(/\bBearer\s+[\w.~+/=-]{10,}/gi, "Bearer [secret]")
    .replace(/([?&](?:api[_-]?key|key|token|access_token|secret|password|sig)=)[^&\s"']+/gi, "$1[secret]")
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, "[jwt]")
    .replace(/\b(?:sk|pk|rk|sb_secret|sb_publishable|tvly|key)[-_][\w-]{16,}/gi, "[secret]");
}

const mask = (s: unknown) => maskSecrets(maskPersonalData(s));

// ---- classification ----

type ErrLike = {
  name?: unknown; code?: unknown; message?: unknown; stack?: unknown; body?: unknown;
  status?: unknown; statusCode?: unknown; response?: { status?: unknown };
  cause?: { name?: unknown; code?: unknown; message?: unknown; status?: unknown };
};

const asObj = (err: unknown): ErrLike | null => (err && typeof err === "object" ? (err as ErrLike) : null);

function statusOf(err: unknown): number | null {
  const e = asObj(err);
  for (const s of [e?.status, e?.statusCode, e?.response?.status, e?.cause?.status]) {
    const n = Number(s);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  const m = String(e?.message ?? err ?? "").match(/\b(?:HTTP|status(?: code)?)[\s:]*([1-5]\d\d)\b/i);
  return m ? Number(m[1]) : null;
}

function messageOf(err: unknown): string {
  if (err == null) return "unknown error";
  const e = asObj(err);
  if (!e) return String(err);
  const base = (e.message ? String(e.message) : "") || String(err);
  const inner = e.cause && typeof e.cause === "object" ? (e.cause.message || e.cause.code) : null;
  return inner && !base.includes(String(inner)) ? `${base} (cause: ${String(inner)})` : base;
}

function signalText(err: unknown): string {
  if (err == null) return "";
  const e = asObj(err);
  if (!e) return String(err);
  return [e.name, e.code, e.message, e.cause?.name, e.cause?.code, e.cause?.message, typeof e.body === "string" ? e.body.slice(0, 500) : ""]
    .filter(Boolean).map(String).join(" ");
}

const HTML_PAGE = /<!doctype html|<html[\s>]/i;

/** One of FAILURE_CAUSES. Order matters: quota before rate_limit. */
export function classifyFailureCause(err: unknown, opts: { status?: number | null } = {}): FailureCause {
  const e = asObj(err);
  const status = opts.status ?? statusOf(err);
  const text = signalText(err);
  const code = String(e?.code ?? e?.cause?.code ?? "");
  const sqlState = typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : "";
  const name = String(e?.name ?? "");

  if (status === 402 || /(^|[^a-z])quota([^a-z]|$)|resource_exhausted|user-set limit|positive balance|spend(?:ing)? (?:cap|limit)|per day|daily limit|billing (?:hard )?limit/i.test(text)) return "quota";
  if (status === 429 || /rate.?limit|too many requests/i.test(text)) return "rate_limit";
  if (status === 408 || status === 504 || /^(AbortError|TimeoutError)$/.test(name) || /ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_[A-Z_]*TIMEOUT/.test(code) || /timed? ?out\b|timeout/i.test(text)) return "timeout";
  if ((HTML_PAGE.test(text) && /supabase|postgrest|PGRST/i.test(text)) || /^(08|57P)/.test(sqlState) || /PGRST00[0-3]/.test(text)) return "db_gateway";
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET/.test(code) || /fetch failed|socket hang up|network error|getaddrinfo|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(text)) return "network";
  if (status === 401 || status === 403 || sqlState === "42501" || /unauthori[sz]ed|forbidden|invalid (?:api )?key|invalid_grant|permission denied|invalid (?:access )?token|token (?:has )?expired|authentication failed/i.test(text)) return "auth";
  if (/missing required env|environment variable|\benv var|not configured|is not set\b/i.test(text)) return "bad_config";
  if ((status !== null && [400, 409, 413, 422].includes(status)) || /^(22|23)/.test(sqlState) || /invalid input|validation (?:failed|error)|ZodError|malformed/i.test(text)) return "validation";
  if ((status !== null && status >= 500) || HTML_PAGE.test(text) || /service unavailable|bad gateway|internal server error|upstream/i.test(text)) return "external_down";
  if (/^(TypeError|ReferenceError|SyntaxError|RangeError)$/.test(name) || /^42/.test(sqlState) || /is not a function|cannot read propert|is not defined|undefined is not/i.test(text)) return "bug";
  return "unknown";
}

const PROVIDERS: [string, RegExp][] = [
  ["sea-lion", /sea-lion|sea_lion|sealion/i],
  ["deepinfra", /deepinfra/i],
  ["supabase", /supabase|postgrest|PGRST/i],
  ["google", /googleapis|gaxios|google drive|google docs|gmail/i],
  ["groq", /groq/i],
  ["telegram", /telegram|api\.telegram\.org/i],
  ["vercel", /vercel/i],
  ["github", /api\.github\.com|octokit|github/i],
];

export function detectProvider(err: unknown): string | null {
  const text = signalText(err);
  for (const [name, re] of PROVIDERS) if (re.test(text)) return name;
  return null;
}

/** Repo-relative "file:line" entries from the stack, first frame first; deps and internals skipped. */
export function stackFilesOf(err: unknown, rootDir: string | null = defaultRoot()): string[] {
  const out: string[] = [];
  const root = rootDir ? `${rootDir.replace(/\/+$/, "")}/` : null;
  for (const line of String(asObj(err)?.stack ?? "").split("\n")) {
    const m = line.match(/^\s*at\s.*?\(?(?:file:\/\/)?(\/[^\s():]+):(\d+):\d+\)?\s*$/);
    if (!m) continue;
    const abs = m[1];
    if (/node_modules|\/\.next\//.test(abs) || line.includes("node:")) continue;
    const rel = root && abs.startsWith(root) ? abs.slice(root.length)
      : abs.match(/\/var\/task\/(.+)$/)?.[1] ?? abs.match(/\/project\/src\/(.+)$/)?.[1] ?? null;
    if (!rel) continue;
    const entry = `${rel}:${m[2]}`;
    if (!out.includes(entry)) out.push(entry);
    if (out.length >= MAX_STACK_FILES) break;
  }
  return out;
}

function defaultRoot(): string | null {
  try { return typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : null; } catch { return null; }
}

function maskDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return mask(value);
  if (value == null || typeof value !== "object" || depth > 5) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => maskDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).slice(0, 50)) out[k] = maskDeep(v, depth + 1);
  return out;
}

function capDetails(details: unknown): unknown {
  if (details == null) return null;
  let json: string | undefined;
  try { json = JSON.stringify(maskDeep(details)); } catch { return { note: "details were not serializable" }; }
  if (json === undefined) return null;
  if (json.length <= MAX_DETAILS) return JSON.parse(json);
  return { truncated: json.slice(0, MAX_DETAILS) };
}

const shapeOf = (message: string) => message.replace(/[0-9a-f]{8,}/gi, "#").replace(/\d+/g, "#").slice(0, 200);

const LOGGED = Symbol.for("sckyroom.failureLog.logged");

// One process-wide beforeExit listener for every logger (one per logger would trip Node's
// MaxListenersExceeded warning in an app that creates loggers per module or per request).
const exitFlushers = new Set<() => void>();
let exitHooked = false;
function registerExitFlush(flushIfPending: () => void): void {
  exitFlushers.add(flushIfPending);
  if (exitHooked || typeof process === "undefined" || typeof process.on !== "function") return;
  exitHooked = true;
  try {
    process.on("beforeExit", () => { for (const f of exitFlushers) f(); });
  } catch { /* Edge runtime stub: no exit hook */ }
}

// ---- the logger ----

export type FailureRow = {
  occurred_at: string; project: string; task: string; cause: FailureCause; provider: string | null;
  error_message: string; stack_files: string[]; run_id: string | null; count: number; details: unknown;
};

export type FailOptions = { cause?: FailureCause; provider?: string; details?: unknown };

export type FailureLogOptions = {
  project: string;
  supabaseUrl?: string;
  serviceKey?: string;
  schema?: string;
  table?: string;
  runId?: string | null;
  rollupMs?: number;
  timeoutMs?: number;
  rootDir?: string | null;
  flushOnExit?: boolean;
  fetchImpl?: typeof fetch;
  logger?: { error: (msg: string) => void };
  now?: () => number;
};

export type FailureLog = {
  fail: (task: string, err: unknown, opts?: FailOptions) => Promise<boolean>;
  wrap: <A extends unknown[], R>(task: string, fn: (...args: A) => R | Promise<R>, opts?: FailOptions) => (...args: A) => Promise<R>;
  run: <R>(task: string, fn: () => R | Promise<R>, opts?: FailOptions) => Promise<R>;
  flush: () => Promise<number>;
};

type Held = { lastWriteAt: number; pending: number; row: FailureRow; timer: ReturnType<typeof setTimeout> | null };

const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env?.[name] : undefined);

export function createFailureLog(options: FailureLogOptions): FailureLog {
  const {
    project,
    supabaseUrl = env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL"),
    serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? env("SUPABASE_SECRET_KEY"),
    schema = env("NEXT_PUBLIC_SUPABASE_SCHEMA") || "public",
    table = "activity_events",
    runId = null,
    rollupMs = 10 * 60 * 1000,
    timeoutMs = 5000,
    rootDir = defaultRoot(),
    flushOnExit = true,
    fetchImpl = fetch,
    logger = console,
    now = () => Date.now(),
  } = options;
  const held = new Map<string, Held>();
  const inFlight = new Set<Promise<boolean>>();
  let warnedUnconfigured = false;

  // Keeps `held` bounded in a long-running app: drop keys whose window has ended with nothing held.
  function sweep(t: number): void {
    for (const [k, h] of held) if (!h.pending && t - h.lastWriteAt >= rollupMs) held.delete(k);
  }

  async function write(row: FailureRow): Promise<boolean> {
    if (!supabaseUrl || !serviceKey || !project) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        logger.error("[failureLog] not configured (missing supabaseUrl/serviceKey/project) - failures are not being recorded");
      }
      return false;
    }
    try {
      const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          "Content-Profile": schema,
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        logger.error(`[failureLog] write failed for task "${row.task}": HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      logger.error(`[failureLog] write failed for task "${row.task}": ${(err as Error)?.message ?? String(err)}`);
      return false;
    }
  }

  function track(p: Promise<boolean>): Promise<boolean> {
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
    return p;
  }

  async function flushKey(key: string): Promise<boolean> {
    const h = held.get(key);
    if (!h) return false;
    if (h.timer) { clearTimeout(h.timer); h.timer = null; }
    if (!h.pending) return false;
    const row = { ...h.row, count: h.pending, occurred_at: new Date(now()).toISOString() };
    h.pending = 0;
    h.lastWriteAt = now();
    return write(row);
  }

  async function flush(): Promise<number> {
    const results = await Promise.all([...held.keys()].map((k) => track(flushKey(k))));
    await Promise.all([...inFlight]);
    return results.filter(Boolean).length;
  }

  async function fail(task: string, err: unknown, opts: FailOptions = {}): Promise<boolean> {
    try {
      if (err && typeof err === "object") {
        if ((err as Record<symbol, unknown>)[LOGGED]) return false;
        try { Object.defineProperty(err, LOGGED, { value: true }); } catch { /* frozen error: fine */ }
      }
      const message = mask(messageOf(err)).slice(0, MAX_MESSAGE);
      const row: FailureRow = {
        occurred_at: new Date(now()).toISOString(),
        project,
        task: mask(String(task ?? "unnamed task")).slice(0, MAX_TASK),
        cause: opts.cause && (FAILURE_CAUSES as readonly string[]).includes(opts.cause) ? opts.cause : classifyFailureCause(err),
        provider: opts.provider ?? detectProvider(err),
        error_message: message,
        stack_files: stackFilesOf(err, rootDir),
        run_id: runId,
        count: 1,
        details: capDetails(opts.details),
      };
      const key = `${row.task}|${row.cause}|${shapeOf(message)}`;
      const h = held.get(key);
      const t = now();
      if (!h && held.size >= MAX_HELD) sweep(t);
      if (h && t - h.lastWriteAt < rollupMs) {
        h.pending += 1;
        h.row = row;
        if (!h.timer) {
          h.timer = setTimeout(() => { track(flushKey(key)); }, Math.max(0, rollupMs - (t - h.lastWriteAt)));
          (h.timer as { unref?: () => void }).unref?.();
        }
        return false;
      }
      if (h?.timer) { clearTimeout(h.timer); h.timer = null; }
      row.count = 1 + (h?.pending ?? 0);
      held.set(key, { lastWriteAt: t, pending: 0, row, timer: null });
      return await track(write(row));
    } catch (e) {
      logger.error(`[failureLog] could not record a failure: ${(e as Error)?.message ?? String(e)}`);
      return false;
    }
  }

  function wrap<A extends unknown[], R>(task: string, fn: (...args: A) => R | Promise<R>, opts?: FailOptions) {
    return async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (err) {
        await fail(task, err, opts);
        throw err;
      }
    };
  }

  const run = <R>(task: string, fn: () => R | Promise<R>, opts?: FailOptions) => wrap(task, fn, opts)();

  if (flushOnExit) registerExitFlush(() => { if ([...held.values()].some((h) => h.pending)) void flush(); });

  return { fail, wrap, run, flush };
}
