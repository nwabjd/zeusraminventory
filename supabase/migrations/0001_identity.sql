-- ===========================================================================
-- ZEUS cloud - 0001 identity & provisioning
-- ---------------------------------------------------------------------------
-- * users are provisioned by an ADMIN only (or the one-time bootstrap below)
-- * a Google login NEVER auto-grants access: unknown accounts get a profile
--   row with role = NULL and status = 'pending', which passes no policy
-- * invited profiles are linked to the Google identity when that email
--   authenticates for the first time
-- * the last active admin can never be deactivated or demoted
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists citext;

do $$ begin
  create type public.user_role as enum ('admin', 'sales_representative');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.account_status as enum ('pending', 'active', 'inactive');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- app_config: system switches. Never exposed to the client.
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null default 'null'::jsonb
);

insert into public.app_config (key, value)
values ('bootstrap_open', 'true')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  -- NULL until the invited Google account first signs in.
  auth_user_id uuid unique references auth.users (id) on delete cascade,
  google_uid text unique,
  email citext not null,
  display_name text,
  avatar_url text,
  -- NULL = not provisioned. The application is unreachable for these users.
  role public.user_role,
  status public.account_status not null default 'active',
  created_by uuid,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_email_unique on public.profiles (email);
create index if not exists profiles_status_role_idx on public.profiles (status, role);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- provisioning: link invited profiles / record unknown logins
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invited public.profiles;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := nullif(coalesce(meta ->> 'full_name', meta ->> 'name', ''), '');
begin
  -- Already linked (e.g. a second provider / re-link): just refresh.
  select * into invited
    from public.profiles
   where lower(email) = lower(new.email)
   order by created_at asc
   limit 1;

  if invited.id is null then
    -- Unknown Google account: record it with NO role so every policy
    -- rejects it. The admin can provision this email later.
    insert into public.profiles
      (auth_user_id, google_uid, email, display_name, avatar_url, role, status)
    values
      (new.id, meta ->> 'sub', lower(new.email), full_name, nullif(meta ->> 'picture', ''),
       null, 'pending');
    return new;
  end if;

  if invited.auth_user_id is not null and invited.auth_user_id <> new.id then
    -- Email already claimed by another identity - admin intervention needed.
    raise exception 'A ZEUS account already exists for this email.';
  end if;

  -- Link the invited profile to this Google identity.
  update public.profiles
     set auth_user_id = new.id,
         google_uid   = coalesce(meta ->> 'sub', google_uid),
         display_name = coalesce(full_name, display_name),
         avatar_url   = coalesce(nullif(meta ->> 'picture', ''), avatar_url),
         status       = case when status = 'pending' then 'active' else status end,
         last_login_at = now()
   where id = invited.id;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Refresh last_login_at when Supabase updates last_sign_in_at.
create or replace function public.handle_user_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set last_login_at = new.last_sign_in_at
   where auth_user_id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_login on auth.users;
create trigger on_auth_user_login
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at or old.last_sign_in_at is null)
  execute function public.handle_user_login();

-- ---------------------------------------------------------------------------
-- helpers (security definer, safe to call from RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where auth_user_id = auth.uid()
       and role = 'admin'
       and status = 'active'
  );
$$;

create or replace function public.is_provisioned()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where auth_user_id = auth.uid()
       and role is not null
       and status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- last-active-admin guard
-- ---------------------------------------------------------------------------
create or replace function public.ensure_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining integer;
begin
  if new.role is not distinct from old.role
     and new.status is not distinct from old.status then
    return new;
  end if;

  remaining := (
    select count(*)
      from public.profiles
     where role = 'admin' and status = 'active' and id <> old.id
  );

  if old.role = 'admin' and old.status = 'active' and remaining = 0 then
    raise exception 'Refusing to remove, deactivate or demote the last active administrator.';
  end if;
  return new;
end $$;

create trigger profiles_last_admin_guard
  before update on public.profiles
  for each row
  execute function public.ensure_last_admin();

-- Users may never edit their own role/status; only an admin may.
create or replace function public.profiles_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.created_by is distinct from old.created_by then
    raise exception 'Only an administrator can change roles or account status.';
  end if;
  return new;
end $$;

create trigger profiles_self_update_guard
  before update on public.profiles
  for each row
  execute function public.profiles_update_guard();