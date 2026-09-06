// NEXT_PUBLIC_SUPABASE_SCHEMA lets a consumer point at a non-public schema
// (e.g. "dev") in the SAME Supabase project, instead of provisioning a
// separate project for local development. Defaults to "public" (unset in
// production) so this is opt-in per environment.
export function resolveSupabaseSchema(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || "public";
}
