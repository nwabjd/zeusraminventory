/* ===========================================================================
   Cloud configuration - the only module allowed to read the env vars.
   ---------------------------------------------------------------------------
   Both `cloud.ts` (Supabase client) and `api.ts` (Rust bridge) need to know
   whether the cloud layer is configured, without importing each other (which
   would be a circular import). Env vars never leave this module: the rest of
   the app only sees the boolean / URL builders, so no secret can leak into
   reports or UI, and `.env.example` stays the single documented naming source.
   =========================================================================== */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

/** True only when a real Supabase project has been configured at build time. */
export function cloudEnabled(): boolean {
  return /^https:\/\//i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 0;
}

/** Raw values for creating the Supabase client. Not exported for display. */
export const cloudSupabaseUrl = SUPABASE_URL;
export const cloudSupabaseAnonKey = SUPABASE_ANON_KEY;