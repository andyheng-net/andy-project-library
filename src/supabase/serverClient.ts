import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { resolveSupabaseSchema } from "./schema";

// NEXT_PUBLIC_SUPABASE_SCHEMA lets a consumer point at a non-public schema
// (e.g. "dev") in the SAME Supabase project, instead of provisioning a
// separate project for local development. Defaults to "public" (unset in
// production) so this is opt-in per environment. Auth itself (.auth.*) is
// unaffected either way - it lives in Supabase's own "auth" schema,
// independent of this data-query default.
//
// Explicit return type (Decision 6) - resolveSupabaseSchema() returns plain
// `string`, which otherwise leaks into an INFERRED return type as a
// non-literal SchemaName generic (SupabaseClient<any, "public", string,
// ...>). That leaked type can disagree with another file's own
// SupabaseClient-typed parameter (which defaults its SchemaName to the
// "public" literal) depending on unrelated type-checking order elsewhere in
// the program - confirmed live, adding an unrelated new file to this
// library was enough to newly break two call sites in andy-namecard-holder
// that hadn't changed at all. Declaring the type explicitly removes the
// inference entirely; neither consumer app uses a generated Database type,
// so this loses no real type safety.
export async function createServerSupabaseClient(): Promise<SupabaseClient<any, any, any>> {
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

export function createAdminSupabaseClient(): SupabaseClient<any, any, any> {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: resolveSupabaseSchema() },
    },
  );
}
