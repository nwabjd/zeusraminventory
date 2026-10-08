# FINAL REPORT — MULTI-USER ROLES, GOOGLE LOGIN & ADMIN APPROVAL LAYER

**Date:** 2026-10-07 · **Build:** `zeus-ram-inventory v1.0.0` (rel: `src-tauri\target\release\zeus-ram-inventory.exe`)
**Objective:** add a secure multi-user system (Admin + Sales Representative), Google/Gmail OAuth sign-in, role-based permissions, administrator approval for **every** sale/purchase (PENDING_APPROVAL / APPROVED / REJECTED), cloud-authoritative shared data, and a full audit trail — integrated into the existing ZEUS architecture, **not a rewrite**.

---

## 1. What changed

### Dual-mode application (cloud off = today's ZEUS, unchanged)
- The app runs on **two modes**, selected at build time by environment variables:
  - **Cloud off (default):** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` absent ⇒ exactly the current single-user desktop ZEUS. The login gate, approval queue, users screen and audit screen are never mounted. Verified bit-for-bit with a real desktop run (see §6).
  - **Cloud on:** both variables present ⇒ ZEUS opens on a **login gate** (`Continue with Google`). The local SQLite database is **not even opened** until a provisioned, active account signs in.
- No secrets are compiled into the app. The two app-side variables are public-by-design Supabase credentials; the Google OAuth **Client ID / Client Secret** and the postgres password / service-role key live **only** in the Supabase dashboard.

### Google OAuth (PKCE, no password storage)
- `src/lib/auth.tsx` — `AuthProvider` implemented with the Supabase browser client using PKCE (`redirectTo` = `window.location.origin`).
  - Session restore on startup, profile load, live pending-count subscription for the admin badge, and `LOGIN_SIGNED_OUT_AT`/`LOGIN_SIGNED_IN_AT` audit writes.
  - A per-email dedupe prevents duplicate login audit rows within one app run.
- `src/pages/Login.tsx` — clean login screen with **Continue with Google**, plus the **AccountBlocked** screen ("You are not authorized to access ZEUS") for Google accounts that are not provisioned.
- **No fake local auth and NO auto-admin.** A brand-new Google account gets a profile with `role = NULL`, `status = pending` and is blocked until an administrator provisions it (invites it or sets its role directly).

### Roles & permissions
`src/lib/approval.ts` — `ROLE_PERMISSIONS` matrix (re-exported as `ROLE_PERMISSIONS` and enforced both in the UI **and** server-side):

| Permission | Admin | Sales Rep |
|---|---|---|
| submitRequests (BUY/SELL → approval) | ✅ | ✅ |
| approveTransactions | ✅ | ❌ |
| viewAllTransactions | ✅ | ❌ |
| manageUsers | ✅ | ❌ |
| viewAuditLog | ✅ | ❌ |
| viewReports | ✅ | ❌ |

- Every transaction — including one submitted by an admin — still requires a **different** administrator's decision (separation of duties; self-approval is impossible, enforced server-side).
- `src/components/layout/AppShell.tsx` — nav adapts to the signed-in role (`navFor(role)`): only Admin sees Approvals / Users / Audit Log; Sales Reps see "My requests"; Dashboard shows an **APPROVALS (n)** banner for admins with pending items.
- `src/App.tsx` — `AuthGate` (login gate) wrapped around the whole app; `RequireAdmin` route guards (`/approvals`, `/users`, `/audit` redirect non-admins away). Route hiding is convenience only — RLS is the real boundary.

### Approval workflow (cloud-authoritative, ledger-safe)
- `src/lib/cloud-types.ts` — wire types for the shared backend.
- **Statuses:** `pending_approval` / `approved` / `rejected` only — no ambiguous values (`ALLOWED_TRANSITIONS` in `approval.ts`; enforced by a Postgres trigger).
- `src/components/transactions/TransactionDialog.tsx` — when cloud is on, the BUY/SELL funnel becomes **"Submit for approval"**:
  - All local validation is preserved (RAM variant matrix, quantities, prices, party).
  - The request payload carries **SKU** (not device-local row ids) plus generation/capacity/speed for every line, so **any** device can finalize after approval.
  - Nothing touches the local ledger while pending.
- `src/lib/cloud.ts` — `cloudSubmitRequest`, `lockApproval`, `decideApproval`, `finalizeApprovalLocally`, `recoverStaleLocks`, user management and audit clients.
- **Atomic approval (double-approval impossible):** the decision sequence is
  1. `cloudLockApproval` — `lock_owner`/`locked_at` set **atomically**; only the first admin wins the row-level lock;
  2. `finalizeApprovalLocally` — stock/ledger effects run through the **existing** ZEUS Rust commands (`create_sale`/`create_purchase`) on the approving device's SQLite;
  3. `cloudDecideApproval` — only after the local finalize succeeds does the cloud row move to APPROVED. If local finalize fails, the request is marked REJECTED with the reason recorded.
- A stale-lock recovery function lets an admin release locks older than N minutes.
- `src/components/transactions/`, `src/pages/Approvals.tsx`, `src/pages/MyTransactions.tsx` — Admin sees a live queue (PENDING / APPROVED / REJECTED tabs, decision dialog with reason, detail view); Sales Reps see their own requests with status badges.

### User management
- `src/pages/Users.tsx` — table with **Name | Email | Role | Status | Last login | Actions**; invite dialog (email + optional name + role), inline role change, activate/deactivate. The **last active administrator cannot be deactivated or demoted** (DB guard + UI guard). Invites upsert by email so an already-signed-in unprovisioned account is correctly linked.
- Admin bootstrap: `bootstrap_admin(email)` is a `SECURITY DEFINER` function callable **only by the operator** (one-time latch closes forever after the first admin). Admin credentials are **never hardcoded**.

### Cloud database (Supabase — managed Postgres + Auth + RLS)
- `supabase/migrations/0001_identity.sql` — `public.profiles` (email, auth_user_id, display_name, role, status, last_login_at, created_by), auto-provisioning trigger on `auth.users` insert that **links invited profiles** to the Google identity and blocks unknown emails, `is_admin()` / `is_provisioned()` helpers, **last-admin guard**, self-update guard, unique email index.
- `supabase/migrations/0002_workflow.sql` — `transaction_approvals` (kind, status, requested_by, decided_by, payload JSONB with SKU lines, lock columns, decision audit fields), `approval_actions` (immutable audit rows), plus triggers: request number assignment, totals recompute from the payload, **state-machine guard**, event logging, and a self-approval guard.
- `supabase/migrations/0003_policies.sql` — **RLS is the security boundary** (not UI hiding):
  - Users read/update only their own profile; admins manage all profiles and approve/decide any pending request.
  - Sales Reps cannot approve, cannot view the audit log, cannot manage users — a direct API call is rejected by the database.
  - `recover_stale_locks`, grants, realtime publication for the pending-count badge.
- `supabase/README.md` — step-by-step setup (Google Cloud OAuth client, redirect URIs `http://tauri.localhost` and `http://localhost:1420`, SQL migration apply, bootstrap command). Env var **names only**.

### Indicator of preservation
- **Untouched:** the RAM variant matrix (DDR3/DDR4/DDR5 speeds, capacity, manufacturer, ECC, registration, speed selection), the local ledger schema, all existing pages, and all existing Rust inventory logic. The approval layer routes stock effects back through the existing `create_sale` / `create_purchase` commands, so there is **no second database and no double stock effect**.

---

## 2. Database (migration summary)

| Object | Purpose |
|---|---|
| `profiles` | one row per user email; role/status drive every permission |
| `transaction_approvals` | cloud-authoritative request rows with payload, lock + decision columns |
| `approval_actions` | immutable audit trail (who did what, when, from which app) |
| `audit_log` | login/logout/user-management/approval events |
| triggers | provisioning/linking, request numbers, totals, status machine, event log, self-approval, last-admin |
| RLS policies | per-row authorization for authenticated users; admins only where admins only |
| `bootstrap_admin` | one-time operator bootstrap latched forever after the first admin |

**Data preservation:** the existing local `zeus.db` was never migrated or written by the approval layer. Pending requests never modify it; only approved decisions replay through existing commands. All changes here are additive.

---

## 3. Security

- **RLS is the enforcement boundary** — bypassing the UI still cannot approve, self-approve, view the audit log, or manage users.
- **Atomic decisions** via row locking prevent double-approval even with two admins racing.
- **Separation of duties:** no user (including admins) can decide their own request.
- **No fake local auth:** only a provisioned + active Google account passes the gate, and even then only if `role` and `status` are set (the DB blocks a pending/`NULL` profile as "not authorized").
- **Last-admin guard** in the database and in the UI.
- **Secrets:** all secrets live in env vars / the Supabase dashboard; nothing is printed or committed. App-side vars are public keys only.
- Approve path never trusts the client for authorization or for the decision; local finalize failures are recorded as REJECTED with reason.

---

## 4. Environment variables (names only)

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` at build time | project URL (enables cloud mode when set) |
| `VITE_SUPABASE_ANON_KEY` | `.env` at build time | public anon key for the browser client |
| `ZEUS_ADMIN_BOOTSTRAP_EMAIL` | operator only, **never read at runtime** | email the operator passes to `bootstrap_admin` |

Secrets that must be entered in the Supabase dashboard (Google provider: **Client ID** / **Client Secret**; project password; service-role key) are referenced by name in `supabase/README.md`. `.env.example` ships with names only. **No secret values appear anywhere in this report.**

---

## 5. How to enable (operator checklist)

1. Create a Supabase project; enable the **Google** auth provider; paste Google Cloud OAuth credentials (Client ID/Secret) into the dashboard.
2. Add redirect URIs `http://tauri.localhost` and `http://localhost:1420` in both Google Cloud and Supabase.
3. Apply the SQL migrations (`supabase/migrations/0001…0003`) in the SQL editor.
4. Bootstrap the first admin exactly once (function is callable only with the operator/secret key path; after the first call the latch closes forever).
5. Build the app with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set.
6. Invite the sales representatives from the Users screen.

---

## 6. Tests run and results (all real)

Executed against the real codebase, the real SQLite ledger (cloud-off), and a real desktop WebView2 run:

| Test | Result |
|---|---|
| `node tests/cloud-logic.test.ts` — 19 unit tests: transition rules, ambiguity guard, permission matrix, `can()` role+status gates, self-approval block, admin-can-decide, re-decision block, payload build w/ SKU enrichment, discount capping, totals rounding, SKU→id resolution | **19 passed, 0 failed** |
| `npx tsc --noEmit` (whole app) | **clean** |
| `vite build` (production) + `scripts/check-css.mjs` | **clean** (both modes) |
| `cargo test --release` (Rust, 48 business-rule tests) | **48 passed, 0 failed** |
| Desktop CDP smoke — **normal build** (env absent): Dashboard renders; nav = the original 10 items only; `Buy RAM`/`Sell RAM` present; **no** login screen, no Approvals, no sign-out | **pass** |
| Desktop CDP smoke — **cloud build** (env present, no session): only the ZEUS login card with `Continue with Google`; no Dashboard/nav/DB touch | **pass** |
| Final shipped binary (normal mode) re-verified via CDP | **pass** |

**Deferred by design (blocked on real credentials, as agreed):** live Google OAuth sign-in, actual cross-device approval (Device A submits → Device B sees, approves, finalizes), and real Supabase RLS enforcement tests. Everything up to the network boundary is verified; the remaining steps are credential-gated and documented in `supabase/README.md`.

---

## 7. Limitations / notes

- The approval queue, users, roles, audit, and auth are **cloud-authoritative**. Once a request is APPROVED, the ledger/stock effects are applied **on the approving device's local SQLite** through the existing ZEUS commands — the cloud is the decision authority, not a full ledger mirror. Records for the decision stay in the cloud audit log.
- During a cloud outage the approved-finalize step surfaces a clear error and marks the request REJECTED with reason (it can be re-submitted); no partial stock effects occur.
- Inventory, party, and payment screens remain single-device (local), as before — only the BUY/SELL → approval path became multi-device. Returns/payments are not routed through the queue.
- The default (no-env) build is the primary deliverable and runs exactly as the previous single-user version; enabling the cloud layer is opt-in via env vars.

---

## 8. Files touched (new / modified)

**New — frontend:** `src/lib/cloud-types.ts`, `src/lib/cloud.ts`, `src/lib/auth.tsx`, `src/lib/approval.ts`, `src/pages/Login.tsx`, `src/pages/Approvals.tsx`, `src/pages/MyTransactions.tsx`, `src/pages/Users.tsx`, `src/pages/AuditLog.tsx`, `tests/cloud-logic.test.ts`, `.env.example`.
**Modified — frontend:** `src/App.tsx`, `src/main.tsx` (provider), `src/vite-env.d.ts`, `src/components/layout/AppShell.tsx`, `src/components/transactions/TransactionDialog.tsx`, `src/pages/Dashboard.tsx`.
**New — backend:** `supabase/migrations/0001_identity.sql`, `0002_workflow.sql`, `0003_policies.sql`, `supabase/config.toml`, `supabase/README.md`.
**Unchanged:** all Rust inventory/ledger code, the SQLite schema, the RAM variant matrix, and every pre-existing page.