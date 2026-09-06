import { createClient } from "@supabase/supabase-js";

// Coordinates a real, external, account-wide provider quota (e.g. SEA-LION's
// 10 req/min) that multiple separately-deployed consumer apps share on one
// API key. Each app's own retry/backoff logic only sees its own traffic -
// two apps calling the same account at once can blow through the real
// shared ceiling without either one finding out until a 429 already
// happened. This tracks the account's actual usage in one place (a table in
// the Supabase project every consumer already shares) so a caller can wait
// for a slot instead of racing the other app for one.
//
// Deliberately ALWAYS targets the "public" schema, never
// NEXT_PUBLIC_SUPABASE_SCHEMA/resolveSupabaseSchema() - the quota this
// tracks is one real-world resource that exists independent of which app or
// environment happens to be calling it. A local-dev call under a "dev"
// schema still spends the exact same real SEA-LION quota as a production
// call; counting it in a schema-isolated table would silently exclude
// local-dev traffic from the coordination this exists for.

const CLAIM_RPC = "claim_llm_rate_limit_slot";

// A caller waiting for a slot always gets one eventually - the other app's
// burst clears within one window - but never waits past one window plus a
// margin. Fails open past this point (and on any RPC error) rather than
// blocking a real card/document upload indefinitely on a coordination
// hiccup.
export const MAX_WAIT_MS = 70_000;
const POLL_JITTER_MS = 250;

export const SEA_LION_SHARED_LIMIT_PER_MINUTE = 10;

type ClaimResult = { allowed: boolean; wait_ms: number };

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: "public" },
    });
  }
  return client;
}

// Caps a server-reported wait against the remaining time budget - pulled out
// as a pure function purely so the boundary math is unit-testable without a
// real Supabase call.
export function clampWaitMs(serverWaitMs: number, waitedSoFarMs: number): number {
  const remaining = Math.max(0, MAX_WAIT_MS - waitedSoFarMs);
  return Math.max(0, Math.min(serverWaitMs, remaining));
}

// Blocks (with real, bounded waits) until a slot is available under
// `limitPerMinute` for `provider`, or gives up after MAX_WAIT_MS and lets
// the caller proceed anyway. Call this immediately before the actual
// provider fetch, not wrapped around retry logic - it prevents the 429 in
// the first place; `withRateLimitRetry` still handles a 429 slipping
// through anyway (clock drift, a third context also holding this key).
export async function acquireSharedLlmSlot(provider: string, limitPerMinute: number): Promise<void> {
  const supabase = getClient();
  let waited = 0;

  while (true) {
    const { data, error } = await supabase.rpc(CLAIM_RPC, {
      p_provider: provider,
      p_limit_per_minute: limitPerMinute,
    });
    if (error) {
      console.error(`acquireSharedLlmSlot(${provider}): RPC failed, proceeding unthrottled - ${error.message}`);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as ClaimResult | undefined;
    if (!row || row.allowed) return;

    if (waited >= MAX_WAIT_MS) {
      console.error(`acquireSharedLlmSlot(${provider}): gave up after ${waited}ms, proceeding anyway`);
      return;
    }
    const delay = clampWaitMs(Number(row.wait_ms) || 1000, waited) + Math.floor(Math.random() * POLL_JITTER_MS);
    await new Promise((resolve) => setTimeout(resolve, delay));
    waited += delay;
  }
}
