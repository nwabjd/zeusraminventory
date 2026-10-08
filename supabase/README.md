# ZEUS cloud layer — Supabase setup guide
# ========================================
# The ZEUS desktop app keeps its inventory ledger on the local SQLite database.
# The multi-user layer (Google login, roles, the admin approval workflow and
# the cloud audit trail) lives in Supabase. Nothing here holds secrets: both
# values below are public by design (that is what the anon key is for). Real
# Google OAuth credentials are configured ONLY in the Supabase dashboard and in
# the Google Cloud console - never in this file, never in source code.

# Paste into a local `.env` file at the project root (do not commit `.env`):
#     VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
#     VITE_SUPABASE_ANON_KEY=your-anon-key

# When these two env vars are missing or empty the app runs exactly as it did
# before (single desktop user, direct local ledger) - nothing is blocked.
# When they are set, the app starts at the ZEUS login screen and every BUY /
# SELL document becomes a PENDING_APPROVAL request that an Administrator must
# decide before any stock changes.

# ---------------------------------------------------------------------------
# 1. Create the project
# ---------------------------------------------------------------------------
#    supabase projects create  (or use dashboard.supabase.com, free tier)
#    supabase link --project-ref <ref>

# ---------------------------------------------------------------------------
# 2. Apply the schema
# ---------------------------------------------------------------------------
#    supabase db push            # applies supabase/migrations/0001..0003

# ---------------------------------------------------------------------------
# 3. Bootstrap the first Administrator (required, one-time)
# ---------------------------------------------------------------------------
#    Supabase dashboard > SQL editor, run as postgres:
#
#        select public.bootstrap_admin('you@yourcompany.com');
#
#    The latch (app_config.bootstrap_open) closes the moment this succeeds, and
#    the function refuses to run again while an active admin exists. From then
#    on, administrators provision every other account from ZEUS > Users.

# ---------------------------------------------------------------------------
# 4. Google OAuth (Login with Gmail)
# ---------------------------------------------------------------------------
#    a) Google Cloud Console > Credentials > OAuth client (Web)
#         Authorized JavaScript origins:  http://localhost:1420  http://tauri.localhost
#         Authorized redirect URIs override -> leave to Supabase flow (Step b).
#    b) Supabase dashboard > Authentication > Providers > Google: enable, paste
#       the Client ID and Client Secret (stored as Supabase secrets, never in
#       the app), and add to "Redirect URLs":
#         http://localhost:1420        (development Tauri webview origin)
#         http://tauri.localhost       (production Tauri webview origin)
#    c) ZEUS database > "Allow Bypassing RLS" is OFF - API access is strictly
#       policy-driven.

# ---------------------------------------------------------------------------
# 5. Provision sales representatives
# ---------------------------------------------------------------------------
#    ZEUS > Users > Add Sales Representative  (admin only). Invited emails are
#    linked to the Google identity on first login. Unknown Google accounts are
#    recorded with role = NULL and cannot reach the app.

# ---------------------------------------------------------------------------
# Security notes
# ---------------------------------------------------------------------------
# * RLS policies + triggers enforce authorization server-side; the UI hides
#   buttons as a convenience, never as the security boundary.
# * anon role can read NOTHING (no grants). Only authenticated, provisioned,
#   active users pass any policy.
# * Decision records are immutable (no DELETE policies). Correcting a mistake
#   uses a new request, preserving history.
# * Env var NAMES used by the app (values are secret - never print them):
#       VITE_SUPABASE_URL
#       VITE_SUPABASE_ANON_KEY
#   Operator-only provisioning secret (never read by the app at runtime):
#       ZEUS_ADMIN_BOOTSTRAP_EMAIL  (use it with bootstrap_admin() above)