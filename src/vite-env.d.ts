/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abc.supabase.co. Empty = cloud off. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon key (public by design; secret keys never belong in ZEUS). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}