import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { resolveSupabaseSchema } from "./schema";

// NEXT_PUBLIC_SUPABASE_SCHEMA lets a consumer point at a non-public schema
// (e.g. "dev") in the SAME Supabase project, instead of provisioning a
// separate project for local development. Defaults to "public" (unset in
// production) so this is opt-in per environment. Auth itself (.auth.*) is
// unaffected either way - it lives in Supabase's own "auth" schema,
// independent of this data-query default.
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: resolveSupabaseSchema() },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component with no request context - middleware refreshes the session instead
          }
        },
      },
    },
  );
}

export function createAdminSupabaseClient() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: resolveSupabaseSchema() },
    },
  );
}
