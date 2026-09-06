# Security Notes - andy-project-library

Personal project (not Sckyroom). See CLAUDE.md and DECISIONS.md.

## Known Risks (seeded 06/09/2026)

- **Public repo, by design (Decision 2).** Holds only generic, parameterized Supabase/auth/LLM-provider plumbing - no business data, no consumer's actual API keys/secrets, no project-specific prompts or schemas. Anyone can read the source; that's an accepted, deliberate tradeoff for zero-friction git-dependency installs (see Decision 2's reasoning vs. Sckyroom's private equivalent).
- **Never accept a new module here that embeds a real credential, URL, or business-specific constant** - every consumer supplies its own via environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `GOOGLE_ALLOWED_EMAIL`, `NEXT_PUBLIC_SUPABASE_SCHEMA`, etc.), read fresh at call time, never hardcoded or committed.
- **`buildAuthProxy`'s Google-OAuth-allowlist check is the actual access-control boundary for every consumer app** - a bug here would affect every consumer simultaneously, not just one. Has a test suite (`authProxy` logic isn't separately unit-tested beyond what `webauth`-style session tests cover in each consumer - the factory itself is thin and delegates to `@supabase/supabase-js`'s own well-tested `.auth.getUser()`).
- **Version-tag immutability (Decision 5's Sckyroom precedent, adopted here too)** - an existing tag is never force-moved or deleted. A consumer pinned to a tag is only ever affected by a deliberate upgrade of its own `package.json`, never a silent upstream change.
- **`NEXT_PUBLIC_SUPABASE_SCHEMA` (Decision 4) only isolates PostgREST data queries, not Supabase Auth** - documented explicitly in code comments and CLAUDE.md so a future change doesn't assume it also scopes `.auth.*` calls.

## Credential Exposure Log

### 06/09/2026 - Incident: Supabase PostgREST `jwt_secret` exposed (logged in `andy-namecard-holder`, not here)

While wiring up this library's `NEXT_PUBLIC_SUPABASE_SCHEMA` support against `andy-namecard-holder`'s real Supabase project, a Management API config-read response containing that project's `jwt_secret` was printed to the terminal. The credential belongs to `andy-namecard-holder`'s Supabase project, not to this library (which holds no credentials of its own) - full detail and outcome logged in `andy-namecard-holder/security.md` Incident #26, not duplicated here.

## Audit Log

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
