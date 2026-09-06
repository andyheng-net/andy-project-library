import { createBrowserClient } from "@supabase/ssr";
import { resolveSupabaseSchema } from "./schema";

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: resolveSupabaseSchema() } },
  );
}
