# DECISIONS.md - Andy Project Library

## Decision 1 - Extract genuinely duplicated code, not a general-purpose library
**What was decided:** Created this repo after reviewing all of Andy's personal projects
(`andy-adblocker-dns` (Go), `andy-automated-trader` (Python), `andy-namecard-holder` and
`andy-property-investment-calculator` (both Next.js/TypeScript)) for shared functions. Only the
two Next.js projects had real, verified duplication - `src/lib/supabase/client.ts`,
`src/lib/supabase/server.ts`, and `src/app/api/auth/callback/route.ts` were byte-for-byte
identical between them; `src/lib/llm/parseModelJson.ts`/`retryOn429.ts`/`rateLimitInfo.ts` and
`src/proxy.ts` were near-identical with property-investment-calculator's own CLAUDE.md already
documenting them as manually "ported from andy-namecard-holder." The Go and Python projects are
each the only project in their language, so there is nothing to share code with yet.
**Consequences:** This library holds exactly 8 extracted files' worth of logic, all generic
Supabase/auth/LLM-provider plumbing, no business logic. Not intended to become a general-purpose
dumping ground - a new function is only added here after being found genuinely duplicated across
2+ consumers, the same bar Sckyroom's own `sckyroom-project-library` uses (see that repo's own
Decision 1).

## Decision 2 - Public repo, git-dependency distribution (Sckyroom's pattern, made public)
**What was decided:** Distribute the same way Sckyroom's `sckyroom-project-library` does - a
consumer adds `"andy-project-library": "github:andyheng-net/andy-project-library#v<tag>"` as a
normal dependency, pinned to a tag, never `main`. Unlike Sckyroom's version, this repo is public,
not private - the code is generic infra with no business data or secrets, so there's no reason to
pay the private-repo tax. Sckyroom's private repo needed a per-consumer GitHub deploy key + a
custom Render build command (`GIT_SSH_COMMAND=...`) just so `npm install` could authenticate -
confirmed via reading that repo's own CLAUDE.md. A public repo needs none of that: `npm install`
on Vercel (or anywhere) fetches it with zero extra configuration.
**Why not an npm workspace (merging both consumer repos into one):** both
`andy-namecard-holder` and `andy-property-investment-calculator` are already live, separately
deployed Vercel projects. Merging them into one repo would mean reconfiguring both Vercel
projects' Root Directory and merging two live git histories - disproportionate risk for 8 shared
files. Revisit only if the shared surface grows much larger.
**Why not a git submodule:** a submodule needs a manual `git submodule update` step on every
consumer and is easy to forget; a pinned git dependency updates on a normal `npm install` once
the tag is bumped, no extra step.

## Decision 3 - Ship raw TypeScript, no build step
**What was decided:** `package.json`'s `main`/`types` point straight at `src/index.ts` - no
`tsc` build, no `dist/` folder, no publish step beyond tagging. Consumers add
`transpilePackages: ["andy-project-library"]` to their own `next.config.ts` so Next.js transpiles
the source directly (mirrors how a local npm workspace package would behave, without the
workspace).
**Consequences:** Simplest possible repo - editing a file and pushing a new tag is the entire
release process, no build tooling to maintain or debug. Only works for Next.js consumers (the
`next/headers` import in `serverClient.ts` requires a Next.js runtime) - fine, since both current
and any realistically-near-future consumers are Next.js apps.

## Decision 4 - NEXT_PUBLIC_SUPABASE_SCHEMA for dev/prod data isolation, no separate project
**What was decided:** Added `resolveSupabaseSchema()` (`src/supabase/schema.ts`) and wired it into
all three Supabase client factories via `db: { schema: resolveSupabaseSchema() }`. Reads
`NEXT_PUBLIC_SUPABASE_SCHEMA`, defaulting to `"public"` when unset. Lets a consumer's local dev
point at a separate `dev` schema in the SAME Supabase project instead of every query hitting
production tables - the gap found in the personal-projects-wide safe-testing review (both
`andy-namecard-holder` and `andy-property-investment-calculator` had `npm run dev` hitting the
exact same Supabase project as production, confirmed live).
**Why not a separate Supabase project for dev:** initially planned, but Andy pushed back - "we can
reuse the same database, just create a new shared table for all the repos" - simpler, no new
infra to provision, no second set of credentials to manage, no free-tier project-count concerns.
A Postgres schema (not a table-name prefix) was chosen as the actual mechanism: it requires zero
changes to any query/action code in either consuming app (table names like `cards`/`scenarios`
stay identical, just resolved under `dev.*` instead of `public.*`), versus a prefix approach
(`dev_cards`) which would have needed every table reference across both apps' code rewritten.
**Consequences:** Supabase Auth (`.auth.*`) is unaffected by this option either way - it lives in
Supabase's own separate `auth` schema, only PostgREST data queries respect `db.schema`. A
consuming project's Supabase instance needs the `dev` schema added to its Data API's exposed-schema
list (Project Settings -> Data API -> Exposed schemas) before `dev.*` tables are queryable via
`@supabase/supabase-js` - a one-time per-project setup step, not something this library can do for
a consumer. Added this library's first test suite in the same pass (`node --test
--experimental-strip-types`, Node >=24, zero test framework dependency) - covers `resolveSupabaseSchema`,
`parseModelJson`, `readRateLimitInfo`, and `withRateLimitRetry`; the Supabase client factories and
auth handlers themselves aren't unit-tested (thin wrappers around `@supabase/supabase-js`/Next.js
APIs, better covered by each consumer's own integration-level testing).

## Decision 5 - Shared cross-app SEA-LION rate limiter (`acquireSharedLlmSlot`)
**Date:** 06/09/2026
**What was decided:** Added `src/llm/sharedRateLimit.ts` (`acquireSharedLlmSlot(provider,
limitPerMinute)`, exported alongside `SEA_LION_SHARED_LIMIT_PER_MINUTE = 10`). Both
`andy-namecard-holder` and `andy-property-investment-calculator` call SEA-LION's vision/text API
on the exact same `SEA_LION_API_KEY` (Decision 20 in the calculator's own DECISIONS.md), which caps
at 10 req/min account-wide - each app's own `withRateLimitRetry` only reacts to a 429 after the
fact, and has no way to know the OTHER app already spent part of that shared budget this minute.
`acquireSharedLlmSlot` calls a new RPC (`claim_llm_rate_limit_slot`, atomic row-locked
read-modify-write over a new `public.llm_shared_rate_limits` table) in the Supabase project both
apps already share (Decision 10 in the calculator's DECISIONS.md), and waits (bounded, `MAX_WAIT_MS
= 70_000`) for a real slot instead of guessing independently. Call it immediately before the actual
provider `fetch`, not wrapped around `withRateLimitRetry` - it prevents the 429 in the first place;
`withRateLimitRetry` still covers a 429 slipping through anyway.
**Why this table always uses the fixed "public" schema, not `resolveSupabaseSchema()`:** the SEA-LION
quota is one real external resource that exists independent of which app, environment, or
`NEXT_PUBLIC_SUPABASE_SCHEMA` setting happens to be calling it - a local `npm run dev` session
pointed at the `dev` schema still spends the exact same real quota as a production call. Coordinating
in a schema-isolated table would silently exclude local-dev traffic from the one thing this exists
to prevent.
**Fails open, always:** any RPC error, or exhausting the full `MAX_WAIT_MS` budget without a slot,
logs and lets the caller proceed anyway - a DB hiccup or a stuck coordinator must never be able to
block a real card/document upload indefinitely. This makes the mechanism a best-effort scheduler,
not a hard guarantee - accepted, since the alternative (blocking forever) is strictly worse for a
low-volume personal tool.
**Migration applied directly via the Supabase Management API** (`POST
/v1/projects/{ref}/database/query`, not a tracked migration file - matches this project's existing
DB-change convention of applying SQL directly and documenting it here, same as both consumer apps
already do). RLS enabled on the new table with all grants revoked from `anon`/`authenticated`
(consistent with every other table across both consumer apps); the RPC is `SECURITY DEFINER`,
execute revoked from `anon`/`authenticated`, granted only to `service_role`. Verified live: called
the RPC 4 times against a temporary `limit=3` test row via the Management API directly (not the real
SEA-LION account) - first 3 calls returned `allowed:true`, the 4th correctly returned
`allowed:false` with a real `wait_ms`; test row deleted after.
**Alternatives considered:** A second SEA-LION account/key per app (Andy's other option, offered
first) - simpler (zero code), but rejected in favor of this once Andy chose it: a real coordinator
scales to any number of future apps sharing any future provider, not just a one-time fix for the
current two.
**Consequences:** `@supabase/supabase-js` is now also a `devDependency` here (already a
`peerDependency`) purely so this repo's own test suite can resolve the import - consumers still
control the real installed version via their own `package.json`, unaffected. `Groq` is NOT wired
into this mechanism - `andy-property-investment-calculator` doesn't call Groq at all currently
(Decision 20), so there's no actual cross-app contention on it yet; the same `acquireSharedLlmSlot`
call can be added to a Groq call site later with no further library changes if that ever changes.
**Accepted risk (found in `senior-dev-review`, 06/09/2026): the limiter uses one fixed 60-second
window per provider, not a sliding window/token bucket.** Both apps share the same row (keyed only
by provider name), so up to `limitPerMinute` claims can land just before a window resets and
another full `limitPerMinute` the instant it rolls over - a brief ~2x burst clustered around the
boundary rather than requests smoothed evenly across the minute. Not fixed: a sliding-window/token-
bucket rewrite is disproportionate complexity for a low-volume personal tool, the burst is still
bounded (never exceeds 2x for one boundary instant, not unbounded), and any real 429 this causes on
the provider side is still caught by the existing `withRateLimitRetry`. Revisit only if this
account's real-world 429 rate becomes a genuine nuisance in practice.
**Shipped as v1.2.0, immediately superseded by v1.2.1 (Decision 6)** - v1.2.0's own
`sharedRateLimit.ts` had a type error (fixed before either consumer adopted it in practice; see
Decision 6 for the deeper pre-existing bug it also surfaced).

## Decision 6 - Explicit return types on the two Supabase client factories
**Date:** 06/09/2026 (same day as Decision 5, found while wiring it up)
**What was decided:** `createServerSupabaseClient()`/`createAdminSupabaseClient()` in
`src/supabase/serverClient.ts` now both explicitly declare `Promise<SupabaseClient<any, any, any>>`/
`SupabaseClient<any, any, any>` return types instead of letting TypeScript infer them.
**The bug this fixes:** `resolveSupabaseSchema()` returns plain `string` (Decision 4's `"public" |
"dev"` toggle isn't a literal union in its type signature), which leaked into these two functions'
INFERRED return types as a non-literal `SchemaName` generic slot -
`SupabaseClient<any, "public", string, any, any>`. That's structurally incompatible with a
consumer's own `SupabaseClient`-typed parameter, which defaults `SchemaName` to the literal
`"public"` when unspecified - andy-namecard-holder's `hasCardsNeedingRecovery(supabase:
ReturnType<typeof createAdminClient>)` is exactly this shape.
**Why this had never broken a build before:** confirmed live - the bug was already latent (a real,
pre-existing structural mismatch), but TypeScript's inference for an UNANNOTATED return type is
computed lazily and apparently order/cache-sensitive enough that it had never previously resolved
to the mismatched instantiation in practice. Adding Decision 5's `sharedRateLimit.ts` (an unrelated
new file, no import of `serverClient.ts` at all) was enough to flip it: reproduced by installing
only Decision 5's change with a clean `.next` cache in `andy-namecard-holder` - `page.tsx` and
`processAsync.ts`'s calls to `hasCardsNeedingRecovery` broke, despite neither file changing.
Reverting to v1.1.0 and rebuilding clean confirmed zero errors, isolating the cause to this
library's new file alone, not those two consumer files. Declaring the return type explicitly
removes the inference (and its order-sensitivity) entirely - verified by re-running
`andy-namecard-holder`'s `next build` clean afterward.
**Consequences:** Neither consumer app uses a generated `Database` type (confirmed via a repo-wide
grep for `Database` in both), so this loses no real schema-aware type-checking that was actually in
effect - the literal-vs-`string` distinction being fixed here was never doing useful work in
practice, only causing this failure mode. `acquireSharedLlmSlot`'s own `getClient()` (Decision 5)
was given the same treatment (explicit `SupabaseClient<any, any, any>` return type, explicit
`createClient<any, "public", "public">(...)` generic arguments on the call itself) for the same
reason - `SchemaNameOrClientOptions` never appears in `createClient`'s own parameter list, so it's
only ever inferrable from a computed default, never from the call's actual arguments, making
implicit inference here fragile by construction, not just an unlucky one-off.
**Shipped as v1.2.1** (v1.2.0 is not deleted or force-moved, per this repo's tag-immutability rule -
it's simply superseded; no consumer had adopted v1.2.0 before this fix landed).

## Decision 7 - Shared failure log (`createFailureLog`, v1.3.0)

**Context (30/09/2026, sckyroom-bug-hunter M17-03):** Andy asked for every repo to record its failed
tasks and their causes so Bug Hunter can read them. His call: Sckyroom repos log through
`sckyroom-project-library`, his personal repos through this library, same API and table shape.
**What was decided:** `src/log/failureLog.ts` ports sckyroom-project-library's `failureLog.js` (its
Decision 28): `createFailureLog({ project })` -> `fail`/`wrap`/`run`/`flush`, one row per failure to
`activity_events` (created by Bug Hunter's `migrations/external/activity_events_public.sql`, public +
dev). Env defaults: `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_SECRET_KEY`, schema from `NEXT_PUBLIC_SUPABASE_SCHEMA` (Decision 4) so local dev writes to
`dev`. Never throws, 5s timeout, masks personal data and secrets, caps sizes, rolls repeats into
`count`. Self-contained with no imports, because `node --test --experimental-strip-types` cannot
resolve the extensionless imports Next.js uses. No Node-only modules, so it loads in the Edge runtime.
**Serverless caveat:** Vercel freezes an idle instance instead of exiting it, so a held repeat may
only be written with the next failure after the window; the first occurrence is always written at once.
**Verified:** 5 new tests, 27/27 pass; strict `tsc` clean; live row written to the personal project's
`public.activity_events`, read back (cause network) and deleted.
**Consumers:** none yet - repo rollout is decided separately with Andy.

## Decision 8 - Failure log review fixes (v1.3.1)

**Context (30/09/2026, sckyroom-bug-hunter M17-07 senior-dev-review, before any consumer adopted v1.3.0):**
the same 3 fixes as sckyroom-project-library's Decision 29: "billing" alone no longer classifies as
`quota`; the roll-up map drops finished keys once it holds 500; one shared `beforeExit` listener
flushes every logger instead of one listener per logger. **Verified:** 29/29 tests, strict tsc clean.

## Decision 9 - next 16.3.8 in the dev lockfile (01/10/2026, sckyroom-bug-hunter D-186, #2903)

**Context:** Bug Hunter flagged a critical Next.js advisory (RCE in `next/og` ImageResponse) against this
repo's lockfile (next 16.3.4). `next` is only a dev/peer dependency here (peer range `^16.0.0`
unchanged), so consumers pick their own version; the fix is the lockfile bump via `npm audit fix`.
`npm test` 29/29 pass, `npm audit` 0. Tier 2: branch + PR, merge on Andy's approval.
