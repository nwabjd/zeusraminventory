-- ===========================================================================
-- ZEUS cloud - 0002 approval workflow
-- ---------------------------------------------------------------------------
-- transaction_approvals: every sale / purchase request that must be decided
--   by an administrator. The payload is a frozen jsonb snapshot (with SKUs,
--   not device-local ids) so any device can review and finalize it.
-- approval_actions: append-only history of submitted / approved / rejected.
-- audit_log: cloud-side, actor-aware audit trail.
-- ===========================================================================

do $$ begin
  create type public.approval_status as enum ('pending_approval', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- audit_log (lives here so 0001's bootstrap function can write to it later)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text not null,
  entity text not null default '',
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_action_idx on public.audit_log (action);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_email_idx on public.audit_log (actor_email);

-- ---------------------------------------------------------------------------
-- transaction_approvals
-- ---------------------------------------------------------------------------
create sequence if not exists public.approval_request_seq;

create table if not exists public.transaction_approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sale', 'purchase')),
  transaction_number text not null,
  payload jsonb not null,
  total_amount numeric(14, 2) not null default 0,
  item_count integer not null default 0,
  unit_count integer not null default 0,
  party_name text not null default '',
  requested_by uuid not null references public.profiles (auth_user_id) on delete cascade,
  requested_by_email text not null,
  status public.approval_status not null default 'pending_approval',
  -- An admin takes this lock before finalizing; the atomic UPDATE below makes
  -- double approval impossible even when two admins open the same request.
  lock_owner uuid references public.profiles (auth_user_id) on delete set null,
  locked_at timestamptz,
  decided_by uuid references public.profiles (auth_user_id) on delete set null,
  decided_by_email text,
  decided_at timestamptz,
  rejection_reason text,
  final_document_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approvals_queue_idx
  on public.transaction_approvals (status, created_at);
create index if not exists approvals_kind_idx
  on public.transaction_approvals (kind, status);
create index if not exists approvals_requested_by_idx
  on public.transaction_approvals (requested_by);

create trigger transaction_approvals_updated_at
  before update on public.transaction_approvals
  for each row
  execute function public.set_updated_at();

-- Base 36-ish display numbers: SALRQ-000001 / PURRQ-000001 ...
create or replace function public.assign_request_number()
returns trigger
language plpgsql
as $$
begin
  new.transaction_number :=
    case when new.kind = 'sale' then 'SALRQ-' else 'PURRQ-' end
    || lpad(nextval('public.approval_request_seq')::text, 6, '0');
  return new;
end $$;

create trigger transaction_approvals_number
  before insert on public.transaction_approvals
  for each row
  execute function public.assign_request_number();

-- ---------------------------------------------------------------------------
-- approval_actions (append-only decision history)
-- ---------------------------------------------------------------------------
create table if not exists public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.transaction_approvals (id) on delete cascade,
  action text not null check (action in ('submitted', 'approved', 'rejected')),
  actor_id uuid not null,
  actor_email text not null,
  from_status public.approval_status,
  to_status public.approval_status,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists approval_actions_approval_idx
  on public.approval_actions (approval_id, created_at);

-- ---------------------------------------------------------------------------
-- state machine guards
-- ---------------------------------------------------------------------------
create or replace function public.guard_approval_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting uuid := auth.uid();
begin
  if new.status is not distinct from old.status then
    -- Metadata edits (locking, final document number) stay allowed.
    return new;
  end if;

  if old.status <> 'pending_approval' then
    raise exception 'Only pending requests can be decided.';
  end if;
  if new.status not in ('approved', 'rejected') then
    raise exception 'Invalid transition from pending_approval.';
  end if;
  if acting is null then
    raise exception 'Not authenticated.';
  end if;
  if old.requested_by = acting then
    raise exception 'You cannot decide on a request you created yourself.';
  end if;

  new.decided_by := acting;
  new.decided_at := now();
  new.decided_by_email := coalesce(
    (select email from public.profiles where auth_user_id = acting), '');
  if new.status = 'rejected' and coalesce(btrim(new.rejection_reason), '') = '' then
    raise exception 'A rejection reason is required.';
  end if;
  return new;
end $$;

create trigger transaction_approvals_transition_guard
  before update on public.transaction_approvals
  for each row
  execute function public.guard_approval_transition();

-- ---------------------------------------------------------------------------
-- decision history + audit on submit and decision
-- ---------------------------------------------------------------------------
create or replace function public.log_approval_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.approval_actions
      (approval_id, action, actor_id, actor_email, from_status, to_status, reason)
    values
      (new.id, 'submitted', new.requested_by, new.requested_by_email, null, 'pending_approval', null);
    insert into public.audit_log (action, actor_id, actor_email, entity, entity_id, metadata)
    values (
      case when new.kind = 'sale' then 'SALE_CREATED' else 'PURCHASE_CREATED' end,
      new.requested_by, new.requested_by_email, 'transaction_approval', new.id::text,
      jsonb_build_object(
        'transaction_number', new.transaction_number,
        'party_name', new.party_name,
        'total_amount', new.total_amount
      )
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.approval_actions
      (approval_id, action, actor_id, actor_email, from_status, to_status, reason)
    values
      (new.id, new.status, new.decided_by, new.decided_by_email, old.status, new.status, new.rejection_reason);

    insert into public.audit_log (action, actor_id, actor_email, entity, entity_id, metadata)
    values (
      case
        when new.status = 'approved' then
          case when new.kind = 'sale' then 'SALE_APPROVED' else 'PURCHASE_APPROVED' end
        else
          case when new.kind = 'sale' then 'SALE_REJECTED' else 'PURCHASE_REJECTED' end
      end,
      new.decided_by, new.decided_by_email, 'transaction_approval', new.id::text,
      jsonb_build_object(
        'transaction_number', new.transaction_number,
        'reason', new.rejection_reason,
        'final_document_number', new.final_document_number
      )
    );
  end if;
  return new;
end $$;

create trigger transaction_approvals_event_log
  after insert or update on public.transaction_approvals
  for each row
  execute function public.log_approval_event();

-- ---------------------------------------------------------------------------
-- corrupted payload self-defence: totals are recomputed on insert
-- ---------------------------------------------------------------------------
create or replace function public.recompute_approval_totals()
returns trigger
language plpgsql
as $$
declare
  raw numeric := 0;
  discount numeric := 0;
  units integer := 0;
  items integer := 0;
  line record;
begin
  for line in select * from jsonb_to_recordset(new.payload -> 'items')
      as x(quantity numeric, "unitPrice" numeric) loop
    raw := raw + coalesce(line.quantity, 0) * coalesce(line."unitPrice", 0);
    units := units + greatest(coalesce(line.quantity, 0), 0)::integer;
    items := items + 1;
  end loop;
  discount := least(greatest(coalesce((new.payload ->> 'discount')::numeric, 0), 0), raw);
  new.total_amount := round((raw - discount)::numeric, 2);
  new.unit_count := units;
  new.item_count := items;
  return new;
end $$;

create trigger transaction_approvals_totals
  before insert on public.transaction_approvals
  for each row
  execute function public.recompute_approval_totals();