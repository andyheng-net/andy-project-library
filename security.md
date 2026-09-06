# Security Notes - andy-project-library

Personal project (not Sckyroom). See CLAUDE.md and DECISIONS.md.

## Known Risks (seeded 06/09/2026)

- **Public repo, by design (Decision 2).** Holds only generic, parameterized Supabase/auth/LLM-provider plumbing - no business data, no consumer's actual API keys/secrets, no project-specific prompts or schemas. Anyone can read the source; that's an accepted, deliberate tradeoff for zero-friction git-dependency installs (see Decision 2's reasoning vs. Sckyroom's private equivalent).
- **Never accept a new module here that embeds a real credential, URL, or business-specific constant** - every consumer supplies its own via environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `GOOGLE_ALLOWED_EMAIL`, `NEXT_PUBLIC_SUPABASE_SCHEMA`, etc.), read fresh at call time, never hardcoded or committed.
- **`buildAuthProxy`'s Google-OAuth-allowlist check is the actual access-control boundary for every consumer app** - a bug here would affect every consumer simultaneously, not just one. Has a test suite (`authProxy` logic isn't separately unit-tested beyond what `webauth`-style session tests cover in each consumer - the factory itself is thin and delegates to `@supabase/supabase-js`'s own well-tested `.auth.getUser()`).
- **Version-tag immutability (Decision 5's Sckyroom precedent, adopted here too)** - an existing tag is never force-moved or deleted. A consumer pinned to a tag is only ever affected by a deliberate upgrade of its own `package.json`, never a silent upstream change.
- **`NEXT_PUBLIC_SUPABASE_SCHEMA` (Decision 4) only isolates PostgREST data queries, not Supabase Auth** - documented explicitly in code comments and CLAUDE.md so a future change doesn't assume it also scopes `.auth.*` calls.
- **`public.llm_shared_rate_limits`/`claim_llm_rate_limit_slot` (Decision 5)** - service-role only, same RLS-on/grants-revoked pattern as every table in both consumer apps; RPC is `SECURITY DEFINER` with execute revoked from `anon`/`authenticated`. Holds no personal data - just a per-provider request counter and timestamp. `acquireSharedLlmSlot` fails open (proceeds unthrottled) on any RPC error or after its bounded max wait - a deliberate choice (never block a real call forever) that also means this is a best-effort scheduler, not a hard rate-limit guarantee.

## Credential Exposure Log

### 06/09/2026 - Incident: Supabase PostgREST `jwt_secret` exposed (logged in `andy-namecard-holder`, not here)

While wiring up this library's `NEXT_PUBLIC_SUPABASE_SCHEMA` support against `andy-namecard-holder`'s real Supabase project, a Management API config-read response containing that project's `jwt_secret` was printed to the terminal. The credential belongs to `andy-namecard-holder`'s Supabase project, not to this library (which holds no credentials of its own) - full detail and outcome logged in `andy-namecard-holder/security.md` Incident #26, not duplicated here.

## Audit Log

### 06/09/2026 - senior-dev-review (Decision 5/6, cross-repo pass)
Full findings and the combined `senior-dev-review` + `audit-complete` table live in
`andy-namecard-holder/security.md` (this session touched all 3 repos - the library, this app, and
`andy-property-investment-calculator` - as one milestone). Two findings specific to this repo: the
Decision 6 type-inference bug (below, already fixed) and an accepted-risk finding logged directly in
Decision 5 above - the shared limiter's fixed 60-second window allows a brief ~2x burst right at the
window boundary; not fixed (disproportionate complexity for a low-volume personal tool, still
bounded, `withRateLimitRetry` catches any resulting 429).

### 06/09/2026 - Decision 6, explicit Supabase client factory return types
| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Correctness (type-check reliability) | FIXED | `createServerSupabaseClient`/`createAdminSupabaseClient` return types were inferred, leaking `resolveSupabaseSchema()`'s plain `string` into a non-literal generic slot that could mismatch a consumer's own `SupabaseClient`-typed parameter depending on unrelated type-checking order elsewhere in the program - confirmed live it broke two untouched call sites in `andy-namecard-holder` purely from Decision 5 adding a new file. Now explicit, removing the inference. |
| 2 | Regression scope | PASS | Neither consumer app uses a generated `Database` type (repo-wide grep, both apps) - no real type safety lost by widening to `SupabaseClient<any, any, any>` |
| 3 | End-to-end verification | PASS | `andy-namecard-holder`'s `next build` (clean `.next`) verified failing before this fix and passing after, with Decision 5's `sharedRateLimit.ts` present in both cases |

### 06/09/2026 - Decision 5, shared SEA-LION rate limiter
| # | Check | Result | Notes |
|---|---|---|---|
| 1 | No hardcoded credentials | PASS | `sharedRateLimit.ts` reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `process.env` only |
| 2 | Database security (new table/RPC) | PASS | RLS enabled on `llm_shared_rate_limits`, grants revoked from `anon`/`authenticated`; RPC is `SECURITY DEFINER`, execute granted only to `service_role` - verified live via the Management API (see Decision 5) |
| 3 | Data privacy | N/A | Table holds only a provider name, timestamp, and integer counter - no personal data |
| 4 | Fail-safe behavior | PASS | Confirmed the code path fails open (proceeds unthrottled) on an RPC error and after `MAX_WAIT_MS` - a coordination outage degrades to "no shared throttling," not "app hangs" |
| 5 | End-to-end verification | PASS | RPC called live via the Supabase Management API against a temporary test row (limit=3): first 3 calls `allowed:true`, 4th `allowed:false` with a real `wait_ms`; test row deleted after. Both consumer apps' own `next build` verified after wiring in `acquireSharedLlmSlot` |

### 06/09/2026 - senior-dev-review + audit-complete (initial repo + Decision 4)
| # | Check | Result | Notes |
|---|---|---|---|
| - | senior-dev-review (correctness/injection) | PASS | No correctness/injection bugs found - thin wrappers around well-tested `@supabase/supabase-js`/Next.js APIs; own logic (schema resolution, JSON parsing, retry/backoff) covered by the new test suite |
| 1 | No hardcoded credentials | PASS | `grep -rE "(['\"])[A-Za-z0-9_\-]{20,}\1"` over `src/` - clean, every value read from `process.env` |
| 2 | No secrets in logs | N/A | No logging in this library - errors propagate to the caller |
| 3 | Rate limits | N/A | No direct external API calls owned by this library |
| 4 | Webhook security | N/A | No webhook endpoints |
| 5 | Database security | N/A | Library doesn't own a database - RLS/grants are each consumer's own responsibility |
| 6 | Data privacy | N/A | No personal data handled |
| 7 | Auth token handling | PASS | `buildAuthProxy`/handlers never log or return a token; delegate entirely to Supabase's own session cookie handling |
| 7 | Dependencies | PASS | `npm audit` - 0 vulnerabilities |
| 8 | Observability | N/A | Not a standalone service |
| 9 | Repository hygiene | PASS | `.gitignore` covers `node_modules`/`.env`/`.DS_Store`; no binaries in git history |
| 10 | Documentation | FIXED | `security.md` was missing entirely - created this audit. `CLAUDE.md`/`DECISIONS.md` already current |
| 11 | End-to-end verification | PASS | Both real consumers (`andy-namecard-holder`, `andy-property-investment-calculator`) build clean and their live auth-redirect flow was verified against this library's code |
