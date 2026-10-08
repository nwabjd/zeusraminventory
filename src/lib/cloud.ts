/* ===========================================================================
   Cloud client - Supabase integration for ZEUS.
   ---------------------------------------------------------------------------
   Config-driven: when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set,
   every function here is inert and the app runs exactly as before. When they
   are set, the app requires Google sign-in and the approval workflow becomes
   the only way a sale or purchase reaches the ledger.

   The cloud store is the AUTHORITY for users, roles, requests and decisions.
   The desktop SQLite database stays the inventory ledger engine - a request
   is finalized through the existing Rust commands ONLY after an admin decides.
   =========================================================================== */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { api } from "./api";
import { payloadTotals } from "./approval";
import { cloudEnabled, cloudSupabaseAnonKey, cloudSupabaseUrl } from "./cloud-config";
import {
  nextWatermark,
  toSyncApproval,
  toSyncAudit,
  toSyncItem,
  toSyncPurchase,
  toSyncPurchaseItem,
  toSyncSale,
  toSyncSaleItem,
} from "./cloud-sync-shape";
import type { RamItem, RamItemInput } from "./types";
import type {
  AccountStatus,
  ApprovalActionRow,
  ApprovalStatus,
  ApprovalRequestPayload,
  CloudAuditAction,
  CloudAuditEntry,
  CloudFinalizeResult,
  CloudItemRow,
  CloudPurchaseItemRow,
  CloudPurchaseRow,
  CloudSaleItemRow,
  CloudSaleRow,
  ProfileRow,
  RequestKind,
  SyncApplyResult,
  SyncSnapshot,
  TransactionApproval,
  UserRole,
} from "./cloud-types";

/** True only when a real Supabase project has been configured at build time. */
export { cloudEnabled };

let client: SupabaseClient | null = null;

export function getCloud(): SupabaseClient | null {
  if (!cloudEnabled()) return null;
  if (!client) {
    client = createClient(cloudSupabaseUrl, cloudSupabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return client;
}

function mapError(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    if (o.details) return o.details;
    if (o.hint) return o.hint;
    if (o.message) return o.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/* ----------------------------------------------------------- approvals -- */

export interface PendingCounts {
  sales: number;
  purchases: number;
}

/** Admin view of the queue (or a single kind / status). */
export async function cloudListApprovals(opts?: {
  status?: ApprovalStatus;
  kind?: RequestKind;
}): Promise<TransactionApproval[]> {
  const sb = getCloud();
  if (!sb) return [];
  try {
    let q = sb.from("transaction_approvals").select("*");
    if (opts?.status) q = q.eq("status", opts.status);
    if (opts?.kind) q = q.eq("kind", opts.kind);
    q = q.order("created_at", { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as TransactionApproval[];
  } catch (e) {
    throw new Error(mapError(e));
  }
}

export async function cloudListMyApprovals(): Promise<TransactionApproval[]> {
  const sb = getCloud();
  if (!sb) return [];
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  try {
    const { data, error } = await sb
      .from("transaction_approvals")
      .select("*")
      .eq("requested_by", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as TransactionApproval[];
  } catch (e) {
    throw new Error(mapError(e));
  }
}

export async function cloudApprovalHistory(approvalId: string): Promise<ApprovalActionRow[]> {
  const sb = getCloud();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("approval_actions")
      .select("*")
      .eq("approval_id", approvalId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as ApprovalActionRow[];
  } catch (e) {
    throw new Error(mapError(e));
  }
}

/** Submit a frozen buy/sell request to the approval queue. */
export async function cloudSubmitRequest(
  kind: RequestKind,
  payload: ApprovalRequestPayload,
): Promise<TransactionApproval> {
  const sb = getCloud();
  if (!sb) throw new Error("ZEUS cloud is not configured.");
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const totals = payloadTotals(payload);
  try {
    const { data, error } = await sb
      .from("transaction_approvals")
      .insert({
        kind,
        payload,
        total_amount: totals.total,
        item_count: totals.itemCount,
        unit_count: totals.unitCount,
        party_name: payload.partyName,
        requested_by: user.id,
        requested_by_email: user.email ?? "",
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as TransactionApproval;
  } catch (e) {
    throw new Error(mapError(e));
  }
}

/**
 * Server-side, atomic decision + ledger write (finalize_approval RPC).
 * The RPC locks the request row, re-validates role / status / ownership /
 * availability, decrements/increments the authoritative inventory, inserts the
 * finalized cloud document and items, and only then marks the request
 * APPROVED - all in one transaction, so double approval is impossible and no
 * client-side chain of writes can leave a half-applied decision.
 *
 * "already been processed" (another admin won the race) is surfaced as an
 * idempotent success rather than an error.
 */
export async function cloudFinalizeApproval(approvalId: string): Promise<CloudFinalizeResult> {
  const sb = getCloud();
  if (!sb) return { ok: false, error: "ZEUS cloud is not configured." };
  try {
    const { data, error } = await sb.rpc("finalize_approval", {
      p_approval_id: approvalId,
    });
    if (error) {
      const msg = mapError(error);
      if (/already been processed/i.test(msg)) {
        return { ok: true, alreadyProcessed: true };
      }
      return { ok: false, error: msg };
    }
    const doc = (data ?? {}) as { sale_number?: string; purchase_number?: string };
    return { ok: true, documentNumber: doc.sale_number ?? doc.purchase_number };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

/** Reject_approval RPC. idempotent: a double submit on an already-decided
 *  request is a no-op rather than an error. */
export async function cloudRejectApproval(approvalId: string, reason: string): Promise<void> {
  const sb = getCloud();
  if (!sb) throw new Error("ZEUS cloud is not configured.");
  try {
    const { data, error } = await sb.rpc("reject_approval", {
      p_approval_id: approvalId,
      p_reason: reason,
    });
    if (error) {
      const msg = mapError(error);
      if (/already been processed/i.test(msg)) return; // idempotent no-op
      throw new Error(msg);
    }
    void data;
  } catch (e) {
    throw new Error(mapError(e));
  }
}

/** Admin-only catalog write. In seed mode only unknown SKUs are inserted and
 *  existing quantities are NEVER overwritten; in catalog mode specs / prices /
 *  minimum stock / archive status are updated but quantity + average cost stay
 *  untouched - a stale local stock figure can never clobber the cloud. */
export async function cloudUpsertCatalog(
  rows: CloudItemRow[],
  seed: boolean,
): Promise<number> {
  const sb = getCloud();
  if (!sb) throw new Error("ZEUS cloud is not configured.");
  try {
    const { data, error } = await sb.rpc("upsert_cloud_items", {
      p_rows: rows,
      p_seed: seed,
    });
    if (error) throw error;
    return (data as number) ?? 0;
  } catch (e) {
    throw new Error(mapError(e));
  }
}

/** Admin-only stock correction on the authoritative quantity. Clamped at 0. */
export async function cloudAdjustStock(
  sku: string,
  delta: number,
  reason: string,
): Promise<CloudItemRow> {
  const sb = getCloud();
  if (!sb) throw new Error("ZEUS cloud is not configured.");
  try {
    const { data, error } = await sb.rpc("cloud_adjust_stock", {
      p_sku: sku,
      p_delta: delta,
      p_reason: reason,
    });
    if (error) throw error;
    return data as CloudItemRow;
  } catch (e) {
    throw new Error(mapError(e));
  }
}

/* ------------------------------------------------- cloud catalogue maps ---- */

function parseGb(capacity: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*GB/i.exec(capacity.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Map a local catalogue record into the wire row `upsert_cloud_items` accepts.
 * quantity + average_cost are carried only so a brand-new SKU inserts with its
 * opening stock; the server deliberately ignores both on update, so a stale
 * local stock figure can never clobber the authoritative cloud quantity.
 */
export function cloudCatalogRowFrom(
  input: RamItemInput,
  editing: RamItem | null,
): CloudItemRow {
  const sku = input.sku?.trim() ?? editing?.sku ?? "";
  const capacity = input.capacity?.trim() || editing?.capacity || "";
  return {
    sku,
    generation: input.generation || editing?.generation || "",
    category: input.category || editing?.category || "",
    capacity,
    capacity_gb: parseGb(capacity) ?? editing?.capacityGb ?? 0,
    speed: input.speed || editing?.speed || "",
    ram_type: input.ramType ?? editing?.ramType ?? null,
    manufacturer: input.manufacturer ?? editing?.manufacturer ?? null,
    model: input.model ?? editing?.model ?? null,
    part_number: input.partNumber ?? editing?.partNumber ?? null,
    condition: input.condition ?? editing?.condition ?? null,
    ecc: input.ecc ?? editing?.ecc ?? false,
    registered: input.registered ?? editing?.registered ?? false,
    rank: input.rank ?? editing?.rank ?? null,
    module_count: input.moduleCount ?? editing?.moduleCount ?? 1,
    purchase_price: input.purchasePrice ?? editing?.purchasePrice ?? 0,
    selling_price: input.sellingPrice ?? editing?.sellingPrice ?? 0,
    average_cost: editing?.averageCost ?? 0,
    quantity: editing?.quantity ?? input.openingQuantity ?? 0,
    minimum_stock: input.minimumStock ?? editing?.minimumStock ?? 0,
    location: input.location ?? editing?.location ?? null,
    notes: input.notes ?? editing?.notes ?? null,
    is_archived: editing?.isArchived ?? false,
    created_at: editing?.createdAt ?? null,
    updated_at: editing?.updatedAt ?? null,
  };
}

/** Full wire copy of an existing (mirrored) row, e.g. for an archive toggle. */
export function cloudCatalogRowFromItem(
  item: RamItem,
  overrides?: { is_archived?: boolean },
): CloudItemRow {
  return {
    sku: item.sku,
    generation: item.generation,
    category: item.category,
    capacity: item.capacity,
    capacity_gb: item.capacityGb ?? parseGb(item.capacity) ?? 0,
    speed: item.speed,
    ram_type: item.ramType ?? null,
    manufacturer: item.manufacturer ?? null,
    model: item.model ?? null,
    part_number: item.partNumber ?? null,
    condition: item.condition ?? null,
    ecc: item.ecc,
    registered: item.registered,
    rank: item.rank ?? null,
    module_count: item.moduleCount || 1,
    purchase_price: item.purchasePrice,
    selling_price: item.sellingPrice,
    average_cost: item.averageCost,
    quantity: item.quantity,
    minimum_stock: item.minimumStock,
    location: item.location ?? null,
    notes: item.notes ?? null,
    is_archived: overrides?.is_archived ?? item.isArchived,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

/** Admin-only catalogue write, then a mirror refresh so the change is visible
 *  everywhere on this device immediately. Falls back to the edited row if the
 *  refreshed mirror does not contain the SKU yet. */
export async function cloudSaveCatalogItem(
  row: CloudItemRow,
  syncNow: () => Promise<boolean>,
  fallback: RamItem | null,
): Promise<RamItem> {
  await cloudUpsertCatalog([row], false);
  await syncNow();
  const rows = await api.listRamItems({ search: row.sku, limit: 100 });
  const hit = rows.find((r) => r.sku === row.sku) ?? fallback ?? rows[0];
  if (!hit) {
    throw new Error(
      "The catalogue change was saved on the server but has not appeared in the local mirror yet. Run Sync or wait for the next sync.",
    );
  }
  return hit;
}

/** Admin: release stale locks (crashed apps) on pending requests. */
export async function cloudReleaseStaleLocks(minutes = 10): Promise<number> {
  const sb = getCloud();
  if (!sb) return 0;
  const { data, error } = await sb.rpc("recover_stale_locks", { p_minutes: minutes });
  if (error) throw new Error(mapError(error));
  return (data as number) ?? 0;
}

/** Pending counts, used by the admin sidebar badge and dashboard card. */
export async function cloudPendingCounts(): Promise<PendingCounts> {
  const sb = getCloud();
  if (!sb) return { sales: 0, purchases: 0 };
  try {
    const count = async (kind: RequestKind) => {
      const { count, error } = await sb
        .from("transaction_approvals")
        .select("id", { count: "exact", head: true })
        .eq("kind", kind)
        .eq("status", "pending_approval");
      if (error) throw error;
      return count ?? 0;
    };
    const [sales, purchases] = await Promise.all([count("sale"), count("purchase")]);
    return { sales, purchases };
  } catch (e) {
    throw new Error(mapError(e));
  }
}

/** Live channel: any insert/update to the queue refreshes stale views. */
export function cloudSubscribeQueue(onChange: () => void): () => void {
  const sb = getCloud();
  if (!sb) return () => undefined;
  const channel = sb
    .channel("zeus-approval-queue")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "transaction_approvals" },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/** Live channel: any change to the authoritative ledger (inventory quantities,
 *  finalized documents, audit) triggers a pull. The caller should debounce. */
export function cloudSubscribeLedger(onChange: () => void): () => void {
  const sb = getCloud();
  if (!sb) return () => undefined;
  const channel = sb
    .channel("zeus-cloud-ledger")
    .on("postgres_changes", { event: "*", schema: "public", table: "cloud_items" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "cloud_sales" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "cloud_purchases" }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "audit_log" }, () => onChange())
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/* -------------------------------------------------------------- profiles -- */

export async function cloudListProfiles(): Promise<ProfileRow[]> {
  const sb = getCloud();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ProfileRow[];
  } catch (e) {
    throw new Error(mapError(e));
  }
}

export interface InviteUserInput {
  email: string;
  role: UserRole;
  displayName?: string;
}

/** Administrator provisions a new account. No privileges are auto-granted. */
export async function cloudInviteUser(input: InviteUserInput): Promise<ProfileRow> {
  const sb = getCloud();
  if (!sb) throw new Error("ZEUS cloud is not configured.");
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  try {
    const { data, error } = await sb
      .from("profiles")
      .upsert(
        {
          email: input.email.trim().toLowerCase(),
          display_name: input.displayName?.trim() || null,
          role: input.role,
          status: "active",
          created_by: user.id,
        },
        { onConflict: "email" },
      )
      .select("*")
      .single();
    if (error) throw error;
    const created = data as ProfileRow;
    await cloudWriteAudit(
      "USER_CREATED",
      "profile",
      created.id,
      { email: created.email, role: created.role, by: user.email ?? "" },
      true,
    );
    return created;
  } catch (e) {
    throw new Error(mapError(e));
  }
}

export async function cloudSetUserStatus(id: string, status: AccountStatus): Promise<void> {
  const sb = getCloud();
  if (!sb) return;
  const { data, error } = await sb
    .from("profiles")
    .update({ status })
    .eq("id", id)
    .select("email")
    .maybeSingle();
  if (error) throw new Error(mapError(error));
  if (data) {
    await cloudWriteAudit(
      status === "active" ? "USER_ACTIVATED" : "USER_DEACTIVATED",
      "profile",
      id,
      { email: (data as { email: string }).email },
      true,
    );
  }
}

export async function cloudChangeRole(id: string, role: UserRole): Promise<void> {
  const sb = getCloud();
  if (!sb) return;
  const { data, error } = await sb
    .from("profiles")
    .update({ role })
    .eq("id", id)
    .select("email")
    .maybeSingle();
  if (error) throw new Error(mapError(error));
  if (data) {
    await cloudWriteAudit("ROLE_CHANGED", "profile", id, {
      email: (data as { email: string }).email,
      role,
    }, true);
  }
}

/* ------------------------------------------------------------------ audit -- */

export async function cloudWriteAudit(
  action: CloudAuditAction | string,
  entity: string,
  entityId?: string | null,
  metadata?: Record<string, unknown> | null,
  quiet = false,
): Promise<void> {
  const sb = getCloud();
  if (!sb) return;
  const {
    data: { user },
  } = await sb.auth.getUser();
  try {
    await sb.from("audit_log").insert({
      action,
      entity,
      entity_id: entityId ?? null,
      metadata: metadata ?? null,
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
    });
  } catch (e) {
    if (!quiet) throw new Error(mapError(e));
  }
}

export async function cloudAudit(limit = 200): Promise<CloudAuditEntry[]> {
  const sb = getCloud();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as CloudAuditEntry[];
  } catch (e) {
    throw new Error(mapError(e));
  }
}

/* ---------------------------------------------------------- sync / pull ---- */
/*
 * Pulls every dataset newer than the stored watermark and applies it through
 * the Rust `sync_apply` mirror command in a single atomic, idempotent write.
 * The cloud store is authoritative: mirror rows are replaced by the pulled
 * row (never the reverse), and stale local quantities can never overwrite the
 * cloud value because catalog/stock writes on the server never accept the
 * device's quantity.
 *
 * Watermarks: items + approvals advance by `updated_at`, finalized documents +
 * audit by `created_at` (both are monotonic per dataset on the server, so a
 * `gt watermark` pull has no gap and no race with concurrent inserts).
 */

const WM_ITEMS = "items";
const WM_APPROVALS = "approvals";
const WM_SALES = "sales";
const WM_PURCHASES = "purchases";
const WM_AUDIT = "audit";
const SYNC_EPOCH = "1970-01-01T00:00:00.000Z";
const PAGE = 1000;

/** Fetches every row of a paged Supabase query (server caps at 1000/request). */
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

async function fetchCloudItems(sb: SupabaseClient, wm: string): Promise<CloudItemRow[]> {
  return pageAll<CloudItemRow>((f, t) =>
    wm === SYNC_EPOCH
      ? sb.from("cloud_items").select("*").order("sku", { ascending: true }).range(f, t)
      : sb.from("cloud_items").select("*").gt("updated_at", wm).order("updated_at", { ascending: true }).range(f, t),
  );
}

async function fetchCloudApprovals(sb: SupabaseClient, wm: string): Promise<TransactionApproval[]> {
  return pageAll<TransactionApproval>((f, t) =>
    wm === SYNC_EPOCH
      ? sb.from("transaction_approvals").select("*").order("updated_at", { ascending: true }).range(f, t)
      : sb.from("transaction_approvals").select("*").gt("updated_at", wm).order("updated_at", { ascending: true }).range(f, t),
  );
}

async function fetchCloudSales(sb: SupabaseClient, wm: string): Promise<CloudSaleRow[]> {
  return pageAll<CloudSaleRow>((f, t) =>
    wm === SYNC_EPOCH
      ? sb.from("cloud_sales").select("*").order("created_at", { ascending: true }).range(f, t)
      : sb.from("cloud_sales").select("*").gt("created_at", wm).order("created_at", { ascending: true }).range(f, t),
  );
}

async function fetchCloudPurchases(sb: SupabaseClient, wm: string): Promise<CloudPurchaseRow[]> {
  return pageAll<CloudPurchaseRow>((f, t) =>
    wm === SYNC_EPOCH
      ? sb.from("cloud_purchases").select("*").order("created_at", { ascending: true }).range(f, t)
      : sb.from("cloud_purchases").select("*").gt("created_at", wm).order("created_at", { ascending: true }).range(f, t),
  );
}

async function fetchCloudAudit(sb: SupabaseClient, wm: string): Promise<CloudAuditEntry[]> {
  return pageAll<CloudAuditEntry>((f, t) =>
    wm === SYNC_EPOCH
      ? sb.from("audit_log").select("*").order("created_at", { ascending: true }).range(f, t)
      : sb.from("audit_log").select("*").gt("created_at", wm).order("created_at", { ascending: true }).range(f, t),
  );
}

async function fetchCloudSaleItems(sb: SupabaseClient, ids: string[]): Promise<CloudSaleItemRow[]> {
  const all: CloudSaleItemRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await sb
      .from("cloud_sale_items")
      .select("*")
      .in("cloud_sale_id", chunk)
      .order("sku", { ascending: true });
    if (error) throw error;
    all.push(...(data ?? []));
  }
  return all;
}

async function fetchCloudPurchaseItems(sb: SupabaseClient, ids: string[]): Promise<CloudPurchaseItemRow[]> {
  const all: CloudPurchaseItemRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await sb
      .from("cloud_purchase_items")
      .select("*")
      .in("cloud_purchase_id", chunk)
      .order("sku", { ascending: true });
    if (error) throw error;
    all.push(...(data ?? []));
  }
  return all;
}

/** One full pull + apply cycle. Returns what the mirror accepted. */
export async function cloudPullSync(): Promise<SyncApplyResult> {
  const sb = getCloud();
  if (!sb) throw new Error("ZEUS cloud is not configured.");
  const watermarks = await api.syncGetWatermarks();
  const wm = (key: string) => watermarks.find((w) => w.key === key)?.watermark ?? SYNC_EPOCH;

  const itemsWm = wm(WM_ITEMS);
  const approvalsWm = wm(WM_APPROVALS);
  const salesWm = wm(WM_SALES);
  const purchasesWm = wm(WM_PURCHASES);
  const auditWm = wm(WM_AUDIT);

  const [items, approvals, sales, purchases, audit] = await Promise.all([
    fetchCloudItems(sb, itemsWm),
    fetchCloudApprovals(sb, approvalsWm),
    fetchCloudSales(sb, salesWm),
    fetchCloudPurchases(sb, purchasesWm),
    fetchCloudAudit(sb, auditWm),
  ]);

  const saleIds = sales.map((s) => s.id);
  const purchaseIds = purchases.map((p) => p.id);
  const [saleItems, purchaseItems] = await Promise.all([
    saleIds.length > 0 ? fetchCloudSaleItems(sb, saleIds) : Promise.resolve<CloudSaleItemRow[]>([]),
    purchaseIds.length > 0 ? fetchCloudPurchaseItems(sb, purchaseIds) : Promise.resolve<CloudPurchaseItemRow[]>([]),
  ]);

  const snapshot: SyncSnapshot = {
    items: items.map(toSyncItem),
    sales: sales.map(toSyncSale),
    saleItems: saleItems.map(toSyncSaleItem),
    purchases: purchases.map(toSyncPurchase),
    purchaseItems: purchaseItems.map(toSyncPurchaseItem),
    approvals: approvals.map(toSyncApproval),
    audit: audit.map(toSyncAudit),
    watermarks: {
      [WM_ITEMS]: nextWatermark(itemsWm, items, "updated_at"),
      [WM_APPROVALS]: nextWatermark(approvalsWm, approvals, "updated_at"),
      [WM_SALES]: nextWatermark(salesWm, sales, "created_at"),
      [WM_PURCHASES]: nextWatermark(purchasesWm, purchases, "created_at"),
      [WM_AUDIT]: nextWatermark(auditWm, audit, "created_at"),
    },
  };
  return api.syncApply(snapshot);
}