# CLAUDE.md - Andy Project Library

Codebase reference for Claude Code sessions. Update whenever files are added, removed, or significantly changed. Committed to git.

**Personal project - not Sckyroom.** Public repo under Andy's own `andyheng-net` GitHub account.

## What This Repo Is

A shared, mechanism-only utility library for Andy's personal Next.js projects, created 06/09/2026 after a cross-project review of `andy-namecard-holder` and `andy-property-investment-calculator` found several files independently duplicated byte-for-byte between the two (most concretely `src/lib/supabase/client.ts`/`server.ts` and the `/api/auth/callback` route). Both projects already documented several other files as "ported from" one another by hand, with no mechanism keeping the copies in sync.

Never bundles project-specific data or business logic (no calculator engines, no card-extraction prompts, no scenario types) - only generic auth/Supabase/LLM-provider plumbing that both consumers need identically.

**Public repo, on purpose** - the code here is generic infra (Supabase client init, an auth-gate pattern, LLM 429-retry/response-parsing helpers) with no business data or secrets in it. Being public means a consumer's `npm install` (including on Vercel) needs no deploy key or extra auth setup, unlike Sckyroom's private `sckyroom-project-library`, which needed a per-consumer GitHub deploy key + custom Render build command specifically because it's private.

## Distribution

No npm registry. Consuming repos add it as a git dependency pinned to a tag:
```json
"dependencies": {
  "andy-project-library": "github:andyheng-net/andy-project-library#v1.0.0"
}
```
Pin to a tag, never `main` - each consumer upgrades deliberately, so a library change can't silently ripple into another project's next deploy. Every published version is a brand-new tag; an existing tag is never force-moved or deleted.

**Consumers must add `transpilePackages: ["andy-project-library"]` to `next.config.ts`** - this library ships raw TypeScript source (no build step, `main`/`types` both point at `src/index.ts`), and Next.js does not transpile packages under `node_modules` by default.

## Files In This Repo

```
src/index.ts                     Re-exports everything below.
src/supabase/browserClient.ts    createBrowserSupabaseClient() - browser Supabase client.
src/supabase/serverClient.ts     createServerSupabaseClient() (cookie-based, server) and
                                  createAdminSupabaseClient() (service-role, bypasses RLS).
src/auth/authProxy.ts            buildAuthProxy(options) - Next.js proxy/middleware factory:
                                  public-path allowlist + Supabase (Google OAuth) session check
                                  against a single GOOGLE_ALLOWED_EMAIL. Takes an optional
                                  additionalSessionCheck callback tried first (e.g. a consumer's
                                  own passkey-issued app session) so a consumer with a second
                                  auth method doesn't need to fork this file. Also exports
                                  DEFAULT_PROXY_MATCHER_CONFIG (identical matcher both consumers
                                  used).
src/auth/callbackHandler.ts      handleGoogleOAuthCallback(req) - the Google OAuth code-exchange
                                  GET handler, re-exported directly as a route's GET.
src/auth/logoutHandler.ts        createLogoutHandler(options?) - returns a POST handler that
                                  signs out of Supabase, then runs an optional onLogout callback
                                  (e.g. a consumer's own extra session-cookie clearing) before
                                  redirecting to /login.
src/llm/parseModelJson.ts        parseModelJson(content) - strips a <think> reasoning block and
                                  markdown code fence before JSON.parse, with a brace-matching
                                  fallback. Shared by both consumers' Groq/SEA-LION callers.
src/llm/rateLimitInfo.ts         readRateLimitInfo(headers) - reads Groq's real
                                  x-ratelimit-reset-tokens/-requests (Go-style duration strings)
                                  or a generic retry-after header (SEA-LION's real 429 shape).
                                  Deliberately has NO Mistral-specific branch - both consumers
                                  have fully removed Mistral (see andy-namecard-holder's
                                  Decision 79); a dead Mistral branch that existed in
                                  namecard-holder's original copy was dropped here, not carried
                                  forward.
src/llm/retryOn429.ts            withRateLimitRetry(call) - retries a 429 or an unusable 2xx
                                  once, waiting the real signaled delay from rateLimitInfo.ts
                                  (clamped 500ms-30s), falling back to a flat 12s guess only when
                                  no signal is available.
src/supabase/schema.ts           resolveSupabaseSchema() (Decision 4) - reads
                                  NEXT_PUBLIC_SUPABASE_SCHEMA, defaults to "public". Wired into all
                                  3 Supabase client factories via db.schema, so a consumer's local
                                  dev can point at a "dev" schema in the SAME Supabase project
                                  instead of hitting production tables - no separate project, no
                                  code changes to table names. Requires the "dev" schema to be
                                  added to that Supabase project's Data API exposed-schema list
                                  first (dashboard-only, per-project, not something this library
                                  can automate for a consumer).
```

Every file above except `authProxy.ts`'s `DEFAULT_PROXY_MATCHER_CONFIG` and the auth handlers has a matching `*.test.ts` (`node --test --experimental-strip-types`, Node >=24, run via `npm test`) - added Decision 4, this repo had zero tests before then.

## Consumers

- `andy-namecard-holder` (`transpilePackages` added, `src/proxy.ts` uses `additionalSessionCheck` for its passkey session)
- `andy-property-investment-calculator` (`transpilePackages` added, no `additionalSessionCheck` - Google OAuth only)

## Other Files In This Repo

- `DECISIONS.md` - decision log.
