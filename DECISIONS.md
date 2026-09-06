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
