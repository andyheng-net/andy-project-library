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
