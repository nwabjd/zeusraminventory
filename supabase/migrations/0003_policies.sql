-- ===========================================================================
-- ZEUS cloud - 0003 row level security, bootstrap & realtime
-- ---------------------------------------------------------------------------
-- Enforces server-side that:
--   * a Sales Representative can never approve/reject (RLS + trigger)
--   * nobody can decide their own request (RLS predicate + trigger)
--   * double approval is impossible (atomic locked UPDATE + status predicate)
--   * unknown Google accounts get zero rows back (role IS NULL)
--   * only admins manage users, and never the last active admin
-- ===========================================================================

alter table public.profiles enable row level security;
alter table public.transaction_approvals enable row level security;
alter table public.approval_actions enable row level security;
alter table public.audit_log enable row level security;

-- app_config is an internal switch table - no client role may read it.
revoke all on table public.app_config from anon, authenticated;

-- ---------------------------------------------------------------- profiles --
create policy "profiles_select"
  on public.profiles for select
  to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

-- Only admins may create accounts (invitations / provisioning).
create policy "profiles_insert_admin"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

-- Users edit their own row; profiles_update_guard forbids role/status changes
-- by non-admins regardless of which policy matched.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy "profiles_update_admin"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------- transaction_approvals --
create policy "approvals_insert"
  on public.transaction_approvals for insert
  to authenticated
  with check (public.is_provisioned() and requested_by = auth.uid());

create policy "approvals_select"
  on public.transaction_approvals for select
  to authenticated
  using (requested_by = auth.uid() or public.is_admin());

-- The update predicate does the atomic gate: it only matched rows that are
-- STILL pending AND created by somebody else AND the actor is an admin. If two
-- admins act at once, only the first UPDATE touches the row.
create policy "approvals_decide"
  on public.transaction_approvals for update
  to authenticated
  using (public.is_admin()
          and requested_by <> auth.uid()
          and status = 'pending_approval')
  with check (public.is_admin()
              and requested_by <> auth.uid()
              and status in ('approved', 'rejected', 'pending_approval'));

-- No delete policy => requests are immutable history.

-- --------------------------------------------------------- approval_actions --
create policy "actions_insert"
  on public.approval_actions for insert
  to authenticated
  with check (public.is_provisioned() and actor_id = auth.uid());

create policy "actions_select"
  on public.approval_actions for select
  to authenticated
  using (actor_id = auth.uid() or public.is_admin());

-- --------------------------------------------------------------- audit_log --
create policy "audit_insert"
  on public.audit_log for insert
  to authenticated
  with check (public.is_provisioned());

create policy "audit_select_admin"
  on public.audit_log for select
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------------ grants --
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.transaction_approvals to authenticated;
grant select, insert on public.approval_actions to authenticated;
grant select, insert on public.audit_log to authenticated;
grant usage on sequence public.approval_request_seq to authenticated;

-- Helpers are callable by clients through RLS and the UI, nothing else.
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_provisioned() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_provisioned() to authenticated;

-- ------------------------------------------------------------------ bootstrap
-- One-time, operator-run bootstrap for the very first administrator.
--
--   select public.bootstrap_admin('admin@example.com');
--
-- Run it as postgres (SQL editor) or with a service-role key. It refuses to
-- run once any active admin exists and closes the bootstrap latch forever, so
-- an attacker can never call it from the client to mint themselves an admin.
create or replace function public.bootstrap_admin(target_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  out_id uuid;
  latch boolean;
begin
  select (value)::boolean into latch from public.app_config where key = 'bootstrap_open';
  if not coalesce(latch, false) then
    raise exception 'Admin bootstrap is closed. Provision users through an administrator instead.';
  end if;
  if exists (select 1 from public.profiles where role = 'admin' and status = 'active') then
    raise exception 'An active administrator already exists.';
  end if;

  insert into public.profiles (email, display_name, role, status, created_by)
  values (lower(btrim(target_email)), split_part(lower(btrim(target_email)), '@', 1), 'admin', 'active', null)
  on conflict (email)
  do update set role = 'admin', status = 'active'
  returning id into out_id;

  update public.app_config set value = 'false'::jsonb where key = 'bootstrap_open';

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, metadata)
  values (null, lower(btrim(target_email)), 'ADMIN_BOOTSTRAPPED', 'profile', out_id::text,
          jsonb_build_object('via', 'bootstrap'));

  return out_id;
end $$;

revoke all on function public.bootstrap_admin(text) from public;
grant execute on function public.bootstrap_admin(text) to service_role;

-- ------------------------------------------------------------------ recovery
-- If an admin's app crashes mid-decision, the lock they took may be stale.
-- Called by an admin to release locks older than N minutes.
create or replace function public.recover_stale_locks(p_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released integer;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can release approval locks.';
  end if;
  update public.transaction_approvals
     set lock_owner = null, locked_at = null
   where status = 'pending_approval'
     and lock_owner is not null
     and locked_at < now() - make_interval(mins => greatest(p_minutes, 1));
  get diagnostics released = row_count;
  return released;
end $$;

revoke all on function public.recover_stale_locks(integer) from public;
grant execute on function public.recover_stale_locks(integer) to authenticated;

-- ------------------------------------------------------------------ realtime
-- Keep open dashboards live: a request that lands on the salesman's laptop
-- appears on the admin's APPROVALS queue without a manual refresh.
alter publication supabase_realtime add table public.transaction_approvals;