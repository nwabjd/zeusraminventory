-- ===========================================================================
-- ZEUS cloud - 0004 authoritative ledger
-- ---------------------------------------------------------------------------
-- Makes the cloud database the single source of truth for the FINALIZED
-- business ledger:
--
--   * cloud_items      - the catalogue AND the authoritative stock quantity /
--                        average cost, keyed by SKU.
--   * cloud_sales      - finalized sales (created only by finalize_approval).
--   * cloud_purchases  - finalized purchases (same rule).
--
-- The client NEVER deducts or adds stock. finalize_approval() is one PL/pgSQL
-- function that validates the caller, the approval state, ownership and
-- availability, then mutates cloud_items, creates the finalized document,
-- marks the approval APPROVED, and writes the audit trail - all in one
-- transaction, so it either happens completely or not at all.
--
-- Double approval is impossible: the function locks the approval row
-- (SELECT ... FOR UPDATE) and re-checks status after acquiring the lock.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- cloud_items - authoritative inventory
-- ---------------------------------------------------------------------------
create table if not exists public.cloud_items (
  sku text primary key,
  generation text not null default '',
  category text not null default '',
  capacity text not null default '',
  capacity_gb integer not null default 0,
  speed text not null default '',
  ram_type text,
  manufacturer text,
  model text,
  part_number text,
  condition text,
  ecc boolean not null default false,
  registered boolean not null default false,
  rank text,
  module_count integer not null default 1,
  purchase_price numeric(14, 2) not null default 0,
  selling_price numeric(14, 2) not null default 0,
  average_cost numeric(14, 2) not null default 0,
  quantity integer not null default 0 check (quantity >= 0),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  location text,
  notes text,
  is_archived boolean not null default false,
  created_by uuid references public.profiles (auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cloud_items_generation_idx on public.cloud_items (generation);
create index if not exists cloud_items_category_idx on public.cloud_items (category);
create index if not exists cloud_items_updated_idx on public.cloud_items (updated_at);

create or replace function public.set_cloud_item_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cloud_items_updated_at on public.cloud_items;
create trigger cloud_items_updated_at
  before update on public.cloud_items
  for each row execute function public.set_cloud_item_updated_at();

-- ---------------------------------------------------------------------------
-- cloud_sales / cloud_sale_items - finalized sales
-- ---------------------------------------------------------------------------
create sequence if not exists public.cloud_sale_seq;

create table if not exists public.cloud_sales (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.transaction_approvals (id) on delete restrict,
  sale_number text not null unique,
  buyer_name text not null,
  sale_date text not null,
  subtotal numeric(14, 2) not null default 0,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  received numeric(14, 2) not null default 0,
  remaining numeric(14, 2) not null default 0,
  payment_method text not null default 'Cash',
  total_cost numeric(14, 2) not null default 0,
  gross_profit numeric(14, 2) not null default 0,
  profit_margin numeric(6, 2) not null default 0,
  notes text,
  created_by uuid not null references public.profiles (auth_user_id) on delete restrict,
  requested_by_email text not null,
  decided_by uuid references public.profiles (auth_user_id) on delete set null,
  decided_by_email text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cloud_sales_created_idx on public.cloud_sales (created_at desc);
create index if not exists cloud_sales_buyer_idx on public.cloud_sales (buyer_name);

create table if not exists public.cloud_sale_items (
  id uuid primary key default gen_random_uuid(),
  cloud_sale_id uuid not null references public.cloud_sales (id) on delete cascade,
  sku text not null,
  generation text not null default '',
  category text not null default '',
  capacity text not null default '',
  speed text not null default '',
  quantity integer not null check (quantity > 0),
  selling_price numeric(14, 2) not null default 0,
  cost_per_unit numeric(14, 2) not null default 0,
  subtotal numeric(14, 2) not null default 0,
  cost_total numeric(14, 2) not null default 0,
  profit numeric(14, 2) not null default 0
);

create index if not exists cloud_sale_items_sale_idx on public.cloud_sale_items (cloud_sale_id);
create index if not exists cloud_sale_items_sku_idx on public.cloud_sale_items (sku);

-- ---------------------------------------------------------------------------
-- cloud_purchases / cloud_purchase_items - finalized purchases
-- ---------------------------------------------------------------------------
create sequence if not exists public.cloud_purchase_seq;

create table if not exists public.cloud_purchases (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.transaction_approvals (id) on delete restrict,
  purchase_number text not null unique,
  seller_name text not null,
  purchase_date text not null,
  subtotal numeric(14, 2) not null default 0,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  paid numeric(14, 2) not null default 0,
  remaining numeric(14, 2) not null default 0,
  payment_method text not null default 'Cash',
  notes text,
  created_by uuid not null references public.profiles (auth_user_id) on delete restrict,
  requested_by_email text not null,
  decided_by uuid references public.profiles (auth_user_id) on delete set null,
  decided_by_email text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cloud_purchases_created_idx on public.cloud_purchases (created_at desc);
create index if not exists cloud_purchases_seller_idx on public.cloud_purchases (seller_name);

create table if not exists public.cloud_purchase_items (
  id uuid primary key default gen_random_uuid(),
  cloud_purchase_id uuid not null references public.cloud_purchases (id) on delete cascade,
  sku text not null,
  generation text not null default '',
  category text not null default '',
  capacity text not null default '',
  speed text not null default '',
  quantity integer not null check (quantity > 0),
  cost_per_unit numeric(14, 2) not null default 0,
  subtotal numeric(14, 2) not null default 0
);

create index if not exists cloud_purchase_items_purchase_idx on public.cloud_purchase_items (cloud_purchase_id);
create index if not exists cloud_purchase_items_sku_idx on public.cloud_purchase_items (sku);

-- ===========================================================================
-- finalize_approval - THE single atomic decision+ledger operation
-- ===========================================================================
create or replace function public.finalize_approval(p_approval_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting uuid := auth.uid();
  acting_email text;
  req public.transaction_approvals;
  item record;
  ci public.cloud_items;
  line_total numeric;
  subtotal numeric := 0;
  discount numeric := 0;
  total_cost numeric := 0;
  received numeric := 0;
  paid numeric := 0;
  doc_id uuid;
  doc_number text;
  qty_new integer;
  avg_new numeric;
  cost_snapshot numeric;
  line_profit numeric;
  doc jsonb;
begin
  if acting is null then
    raise exception 'Not authenticated.';
  end if;
  if not public.is_admin() then
    raise exception 'Only administrators can approve transactions.';
  end if;

  select email into acting_email from public.profiles where auth_user_id = acting;

  -- The concurrency gate: lock this approval row so two admins cannot both
  -- decide it. The status check is repeated AFTER the lock is acquired.
  select * into req from public.transaction_approvals where id = p_approval_id;
  if req.id is null then
    raise exception 'Approval request not found.';
  end if;

  perform 1 from public.transaction_approvals
    where id = p_approval_id
    for update of transaction_approvals;

  select * into req from public.transaction_approvals where id = p_approval_id;
  if req.status <> 'pending_approval' then
    raise exception 'This transaction has already been processed.';
  end if;
  if req.requested_by = acting then
    raise exception 'You cannot decide on a request you created yourself.';
  end if;

  if req.kind = 'sale' then
    -- ------------------------------------------------------------ SALE ----
    -- Validate availability first; ANY shortage aborts the whole approval.
    subtotal := 0;
    total_cost := 0;
    for item in
      select * from jsonb_to_recordset(req.payload -> 'items')
        as x(sku text, quantity integer, "unitPrice" numeric)
    loop
      if coalesce(item.sku, '') = '' then
        raise exception 'A request line is missing its SKU.';
      end if;
      select * into ci from public.cloud_items where sku = item.sku for update;
      if ci.sku is null then
        raise exception 'Catalogue entry % is not registered on the server.', item.sku;
      end if;
      if ci.quantity < item.quantity then
        raise exception 'Insufficient stock for %: % requested but only % available.',
          item.sku, item.quantity, ci.quantity;
      end if;
      line_total := round((item.quantity * item."unitPrice")::numeric, 2);
      subtotal := round((subtotal + line_total)::numeric, 2);
      total_cost := round((total_cost + item.quantity * ci.average_cost)::numeric, 2);
    end loop;

    discount := least(greatest(coalesce(req.payload ->> 'discount', '0')::numeric, 0), subtotal);
    doc_number := 'CLDSLS-' || lpad(nextval('public.cloud_sale_seq')::text, 6, '0');
    received := coalesce((req.payload ->> 'payment')::numeric, 0);

    insert into public.cloud_sales
      (approval_id, sale_number, buyer_name, sale_date, subtotal, discount, total,
       received, remaining, payment_method, total_cost, gross_profit, profit_margin,
       notes, created_by, requested_by_email, decided_by, decided_by_email, decided_at)
    values
      (req.id, doc_number, req.payload ->> 'partyName', coalesce(req.payload ->> 'date', ''),
       subtotal, discount, round((subtotal - discount)::numeric, 2), received,
       round((subtotal - discount - received)::numeric, 2),
       coalesce(req.payload ->> 'method', 'Cash'), total_cost,
       round((subtotal - discount - total_cost)::numeric, 2),
       case when (subtotal - discount) > 0
            then round(((subtotal - discount - total_cost) / (subtotal - discount) * 100)::numeric, 2)
            else 0 end,
       nullif(req.payload ->> 'notes', ''),
       req.requested_by, req.requested_by_email, acting, acting_email, now())
    returning id into doc_id;

    for item in
      select * from jsonb_to_recordset(req.payload -> 'items')
        as x(sku text, quantity integer, "unitPrice" numeric)
    loop
      select * into ci from public.cloud_items where sku = item.sku for update;
      cost_snapshot := ci.average_cost;
      line_profit := round((item.quantity * (item."unitPrice" - cost_snapshot))::numeric, 2);
      insert into public.cloud_sale_items
        (cloud_sale_id, sku, generation, category, capacity, speed, quantity,
         selling_price, cost_per_unit, subtotal, cost_total, profit)
      values
        (doc_id, item.sku, ci.generation, ci.category, ci.capacity, ci.speed,
         item.quantity, round(item."unitPrice"::numeric, 2), cost_snapshot,
         round((item.quantity * item."unitPrice")::numeric, 2),
         round((item.quantity * cost_snapshot)::numeric, 2), line_profit);

      qty_new := ci.quantity - item.quantity;
      -- Issue does not roll the average cost (matches the desktop rule).
      update public.cloud_items
         set quantity = qty_new, updated_at = now()
       where sku = item.sku;
    end loop;

    update public.transaction_approvals
       set status = 'approved', decided_by = acting, decided_by_email = acting_email,
           decided_at = now(), lock_owner = null, locked_at = null,
           final_document_number = doc_number, updated_at = now()
     where id = p_approval_id;
    -- NB: the transaction_approvals_event_log trigger (0002) writes the
    -- approval_actions + audit_log rows for this decision atomically; the
    -- enriched function below adds the inventory effect to the audit record.
    -- Nothing extra is inserted here, so no duplicate audit events.

    select to_jsonb(r) from (
      select s.*, (select jsonb_agg(to_jsonb(i) order by i.sku)
                     from public.cloud_sale_items i where i.cloud_sale_id = s.id) as items
        from public.cloud_sales s where s.id = doc_id) r into doc;
    return doc;
  end if;

  -- ---------------------------------------------------------- PURCHASE ----
  subtotal := 0;
  for item in
    select * from jsonb_to_recordset(req.payload -> 'items')
      as x(sku text, quantity integer, "unitPrice" numeric)
  loop
    if coalesce(item.sku, '') = '' then
      raise exception 'A request line is missing its SKU.';
    end if;
    select * into ci from public.cloud_items where sku = item.sku for update;
    if ci.sku is null then
      raise exception 'Catalogue entry % is not registered on the server.', item.sku;
    end if;
    line_total := round((item.quantity * item."unitPrice")::numeric, 2);
    subtotal := round((subtotal + line_total)::numeric, 2);
  end loop;

  discount := least(greatest(coalesce(req.payload ->> 'discount', '0')::numeric, 0), subtotal);
  doc_number := 'CLDPUR-' || lpad(nextval('public.cloud_purchase_seq')::text, 6, '0');
  paid := coalesce((req.payload ->> 'payment')::numeric, 0);

  insert into public.cloud_purchases
    (approval_id, purchase_number, seller_name, purchase_date, subtotal, discount, total,
     paid, remaining, payment_method, notes, created_by, requested_by_email,
     decided_by, decided_by_email, decided_at)
  values
    (req.id, doc_number, req.payload ->> 'partyName', coalesce(req.payload ->> 'date', ''),
     subtotal, discount, round((subtotal - discount)::numeric, 2), paid,
     round((subtotal - discount - paid)::numeric, 2),
     coalesce(req.payload ->> 'method', 'Cash'), nullif(req.payload ->> 'notes', ''),
     req.requested_by, req.requested_by_email, acting, acting_email, now())
  returning id into doc_id;

  for item in
    select * from jsonb_to_recordset(req.payload -> 'items')
      as x(sku text, quantity integer, "unitPrice" numeric)
  loop
    select * into ci from public.cloud_items where sku = item.sku for update;

    insert into public.cloud_purchase_items
      (cloud_purchase_id, sku, generation, category, capacity, speed, quantity,
       cost_per_unit, subtotal)
    values
      (doc_id, item.sku, ci.generation, ci.category, ci.capacity, ci.speed,
       item.quantity, round(item."unitPrice"::numeric, 2),
       round((item.quantity * item."unitPrice")::numeric, 2));

    qty_new := ci.quantity + item.quantity;
    -- Receipt rolls the weighted average forward (desktop rule).
    if ci.quantity > 0 then
      avg_new := round(((ci.quantity * ci.average_cost + item.quantity * item."unitPrice")
                        / qty_new)::numeric, 2);
    else
      avg_new := round(item."unitPrice"::numeric, 2);
    end if;
    update public.cloud_items
       set quantity = qty_new, average_cost = avg_new, updated_at = now()
     where sku = item.sku;
  end loop;

  update public.transaction_approvals
     set status = 'approved', decided_by = acting, decided_by_email = acting_email,
         decided_at = now(), lock_owner = null, locked_at = null,
         final_document_number = doc_number, updated_at = now()
   where id = p_approval_id;
  -- Decision audit is written once by the transaction_approvals_event_log
  -- trigger (see enriched log_approval_event below).

  select to_jsonb(r) from (
    select p.*, (select jsonb_agg(to_jsonb(i) order by i.sku)
                   from public.cloud_purchase_items i where i.cloud_purchase_id = p.id) as items
      from public.cloud_purchases p where p.id = doc_id) r into doc;
  return doc;
end $$;

-- ===========================================================================
-- reject_approval - server-side rejection (kept atomic with the audit trail)
-- ===========================================================================
create or replace function public.reject_approval(p_approval_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  acting uuid := auth.uid();
  acting_email text;
  req public.transaction_approvals;
begin
  if acting is null then raise exception 'Not authenticated.'; end if;
  if not public.is_admin() then
    raise exception 'Only administrators can reject transactions.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejection reason is required.';
  end if;

  perform 1 from public.transaction_approvals where id = p_approval_id for update;
  select * into req from public.transaction_approvals where id = p_approval_id;
  if req.id is null then raise exception 'Approval request not found.'; end if;
  if req.status <> 'pending_approval' then
    raise exception 'This transaction has already been processed.';
  end if;
  if req.requested_by = acting then
    raise exception 'You cannot decide on a request you created yourself.';
  end if;

  select email into acting_email from public.profiles where auth_user_id = acting;

  update public.transaction_approvals
     set status = 'rejected', rejection_reason = p_reason, decided_by = acting,
         decided_by_email = acting_email, decided_at = now(),
         lock_owner = null, locked_at = null, updated_at = now()
   where id = p_approval_id;
  -- Decision audit is written once by the transaction_approvals_event_log
  -- trigger (approval_actions + audit_log), keeping it atomic with this update.

  return req.id;
end $$;

-- ===========================================================================
-- upsert_cloud_items - catalogue provisioning (admin only)
-- ---------------------------------------------------------------------------
--   * seed=true  => any row that does not exist yet is inserted WITH its local
--                   quantity and average cost (the "adopt my single-user data"
--                   path). Existing cloud rows are NEVER overwritten, so after
--                   the first sync cloud quantities are authoritative.
--   * seed=false => only catalogue facts update (specs, prices, min stock,
--                   archive flag). quantity / average_cost are NEVER written,
--                   so a stale local stock figure cannot clobber the cloud.
-- ===========================================================================
create or replace function public.upsert_cloud_items(p_rows jsonb, p_seed boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  acting uuid := auth.uid();
  acting_email text;
  n integer := 0;
begin
  if acting is null then raise exception 'Not authenticated.'; end if;
  if not public.is_admin() then
    raise exception 'Only administrators can change the shared catalogue.';
  end if;
  select email into acting_email from public.profiles where auth_user_id = acting;

  if p_seed then
    insert into public.cloud_items
      (sku, generation, category, capacity, capacity_gb, speed, ram_type, manufacturer,
       model, part_number, condition, ecc, registered, rank, module_count,
       purchase_price, selling_price, average_cost, quantity, minimum_stock,
       location, notes, is_archived, created_by, created_at, updated_at)
    select x.sku, x.generation, x.category, x.capacity, coalesce(x.capacity_gb, 0),
           x.speed, x.ram_type, x.manufacturer, x.model, x.part_number, x.condition,
           coalesce(x.ecc, false), coalesce(x.registered, false), x.rank,
           coalesce(x.module_count, 1), x.purchase_price, x.selling_price,
           x.average_cost, x.quantity, x.minimum_stock, x.location, x.notes,
           coalesce(x.is_archived, false), acting, now(), now()
      from jsonb_to_recordset(p_rows) as x(
        sku text, generation text, category text, capacity text, capacity_gb integer,
        speed text, ram_type text, manufacturer text, model text, part_number text,
        condition text, ecc boolean, registered boolean, rank text, module_count integer,
        purchase_price numeric, selling_price numeric, average_cost numeric,
        quantity integer, minimum_stock integer, location text, notes text,
        is_archived boolean)
    on conflict (sku) do nothing;
    get diagnostics n = row_count;
  else
    insert into public.cloud_items
      (sku, generation, category, capacity, capacity_gb, speed, ram_type, manufacturer,
       model, part_number, condition, ecc, registered, rank, module_count,
       purchase_price, selling_price, average_cost, quantity, minimum_stock,
       location, notes, is_archived, created_by, created_at, updated_at)
    select x.sku, x.generation, x.category, x.capacity, coalesce(x.capacity_gb, 0),
           x.speed, x.ram_type, x.manufacturer, x.model, x.part_number, x.condition,
           coalesce(x.ecc, false), coalesce(x.registered, false), x.rank,
           coalesce(x.module_count, 1), x.purchase_price, x.selling_price,
           x.average_cost, x.quantity, x.minimum_stock, x.location, x.notes,
           coalesce(x.is_archived, false), acting, now(), now()
      from jsonb_to_recordset(p_rows) as x(
        sku text, generation text, category text, capacity text, capacity_gb integer,
        speed text, ram_type text, manufacturer text, model text, part_number text,
        condition text, ecc boolean, registered boolean, rank text, module_count integer,
        purchase_price numeric, selling_price numeric, average_cost numeric,
        quantity integer, minimum_stock integer, location text, notes text,
        is_archived boolean)
    on conflict (sku) do update set
      generation = excluded.generation,
      category = excluded.category,
      capacity = excluded.capacity,
      capacity_gb = excluded.capacity_gb,
      speed = excluded.speed,
      ram_type = excluded.ram_type,
      manufacturer = excluded.manufacturer,
      model = excluded.model,
      part_number = excluded.part_number,
      condition = excluded.condition,
      ecc = excluded.ecc,
      registered = excluded.registered,
      rank = excluded.rank,
      module_count = excluded.module_count,
      purchase_price = excluded.purchase_price,
      selling_price = excluded.selling_price,
      minimum_stock = excluded.minimum_stock,
      location = excluded.location,
      notes = excluded.notes,
      is_archived = excluded.is_archived,
      updated_at = now()
      -- quantity and average_cost deliberately NOT updated here.
    where excluded.sku <> '';
    get diagnostics n = row_count;
  end if;

  insert into public.audit_log
    (actor_id, actor_email, action, entity, entity_id, metadata)
  values (acting, acting_email,
          case when p_seed then 'CATALOG_SEEDED' else 'CATALOG_SYNCED' end,
          'cloud_items', null, jsonb_build_object('rows', n));
  return n;
end $$;

-- ===========================================================================
-- cloud_adjust_stock - authoritative manual stock corrections (admin only)
-- ===========================================================================
create or replace function public.cloud_adjust_stock(p_sku text, p_delta integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  acting uuid := auth.uid();
  acting_email text;
  before_q integer;
  after_q integer;
begin
  if acting is null then raise exception 'Not authenticated.'; end if;
  if not public.is_admin() then
    raise exception 'Only administrators can adjust stock.';
  end if;
  if p_delta = 0 then raise exception 'Adjustment cannot be zero.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required.'; end if;

  select email into acting_email from public.profiles where auth_user_id = acting;

  update public.cloud_items
     set quantity = quantity + p_delta, updated_at = now()
   where sku = p_sku
   returning quantity into after_q;

  if after_q is null then
    raise exception 'Catalogue entry % is not registered on the server.', p_sku;
  end if;
  if after_q < 0 then
    raise exception 'Cannot remove stock below zero for %.', p_sku;
  end if;
  before_q := after_q - p_delta;

  insert into public.audit_log
    (actor_id, actor_email, action, entity, entity_id, metadata)
  values (acting, acting_email, 'STOCK_ADJUSTED', 'cloud_items', p_sku,
          jsonb_build_object('before', before_q, 'after', after_q,
                             'delta', p_delta, 'reason', p_reason));
  return after_q;
end $$;

-- ===========================================================================
-- Audit enrichment (replaces the 0002 version of the same name)
-- ---------------------------------------------------------------------------
-- The 0002 trigger already writes approval_actions + audit_log atomically with
-- every decision. This 0004 replacement keeps that behaviour and adds the
-- inventory effect + line detail of the finalized cloud document to the
-- SALE_APPROVED / PURCHASE_APPROVED audit row, so the authoritative audit
-- contains what the finalization did to stock. Defined AFTER the ledger
-- tables so it can read them; triggers that call it stay valid.
-- ===========================================================================
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

    meta := jsonb_build_object(
      'transaction_number', new.transaction_number,
      'reason', new.rejection_reason,
      'final_document_number', new.final_document_number
    );

    -- Enrich the approved audit with what the finalization did to inventory.
    if new.status = 'approved' and new.kind = 'sale' then
      meta := meta || coalesce((
        select jsonb_build_object(
                 'inventory_effect', 'decrease',
                 'document_id', s.id::text,
                 'sale_number', s.sale_number,
                 'items', (select jsonb_agg(
                              jsonb_build_object('sku', i.sku, 'quantity', i.quantity,
                                                 'sellingPrice', i.selling_price,
                                                 'costPerUnit', i.cost_per_unit)
                              order by i.sku)
                            from public.cloud_sale_items i where i.cloud_sale_id = s.id))
          from public.cloud_sales s where s.approval_id = new.id), '{}'::jsonb);
    elsif new.status = 'approved' and new.kind = 'purchase' then
      meta := meta || coalesce((
        select jsonb_build_object(
                 'inventory_effect', 'increase',
                 'document_id', p.id::text,
                 'purchase_number', p.purchase_number,
                 'items', (select jsonb_agg(
                              jsonb_build_object('sku', i.sku, 'quantity', i.quantity,
                                                 'costPerUnit', i.cost_per_unit)
                              order by i.sku)
                            from public.cloud_purchase_items i where i.cloud_purchase_id = p.id))
          from public.cloud_purchases p where p.approval_id = new.id), '{}'::jsonb);
    end if;

    insert into public.audit_log (action, actor_id, actor_email, entity, entity_id, metadata)
    values (
      case
        when new.status = 'approved' then
          case when new.kind = 'sale' then 'SALE_APPROVED' else 'PURCHASE_APPROVED' end
        else
          case when new.kind = 'sale' then 'SALE_REJECTED' else 'PURCHASE_REJECTED' end
      end,
      new.decided_by, new.decided_by_email, 'transaction_approval', new.id::text,
      meta
    );
  end if;
  return new;
end $$;

-- ===========================================================================
-- row level security
-- ===========================================================================
alter table public.cloud_items enable row level security;
alter table public.cloud_sales enable row level security;
alter table public.cloud_sale_items enable row level security;
alter table public.cloud_purchases enable row level security;
alter table public.cloud_purchase_items enable row level security;

-- Provisioned users can read the authoritative catalogue; every mutation goes
-- through the SECURITY DEFINER functions above, never through client UPDATE.
create policy "cloud_items_select"
  on public.cloud_items for select
  to authenticated
  using (public.is_provisioned());

create policy "cloud_items_no_client_write"
  on public.cloud_items for all
  to authenticated
  using (false)
  with check (false);

create policy "cloud_sales_select"
  on public.cloud_sales for select
  to authenticated
  using (created_by = auth.uid() or public.is_admin());

create policy "cloud_sales_no_client_write"
  on public.cloud_sales for all
  to authenticated
  using (false)
  with check (false);

create policy "cloud_sale_items_select"
  on public.cloud_sale_items for select
  to authenticated
  using (exists (
    select 1 from public.cloud_sales s
     where s.id = cloud_sale_items.cloud_sale_id
       and (s.created_by = auth.uid() or public.is_admin())
  ));

create policy "cloud_sale_items_no_client_write"
  on public.cloud_sale_items for all
  to authenticated
  using (false)
  with check (false);

create policy "cloud_purchases_select"
  on public.cloud_purchases for select
  to authenticated
  using (created_by = auth.uid() or public.is_admin());

create policy "cloud_purchases_no_client_write"
  on public.cloud_purchases for all
  to authenticated
  using (false)
  with check (false);

create policy "cloud_purchase_items_select"
  on public.cloud_purchase_items for select
  to authenticated
  using (exists (
    select 1 from public.cloud_purchases p
     where p.id = cloud_purchase_items.cloud_purchase_id
       and (p.created_by = auth.uid() or public.is_admin())
  ));

create policy "cloud_purchase_items_no_client_write"
  on public.cloud_purchase_items for all
  to authenticated
  using (false)
  with check (false);

-- ------------------------------------------------------------------ grants --
grant select on public.cloud_items to authenticated;
grant select on public.cloud_sales to authenticated;
grant select on public.cloud_sale_items to authenticated;
grant select on public.cloud_purchases to authenticated;
grant select on public.cloud_purchase_items to authenticated;

grant execute on function public.finalize_approval(uuid) to authenticated;
grant execute on function public.reject_approval(uuid, text) to authenticated;
grant execute on function public.upsert_cloud_items(jsonb, boolean) to authenticated;
grant execute on function public.cloud_adjust_stock(text, integer, text) to authenticated;

-- ----------------------------------------------------------------- realtime --
alter publication supabase_realtime add table public.cloud_items;
alter publication supabase_realtime add table public.cloud_sales;
alter publication supabase_realtime add table public.cloud_purchases;