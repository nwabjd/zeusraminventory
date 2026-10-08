/* ===========================================================================
   Cloud sync snapshot shaping - pure functions with no runtime imports.
   ---------------------------------------------------------------------------
   Everything that reshapes Supabase rows (snake_case) into the Rust mirror
   snapshot (camelCase) and computes new watermarks lives here so it can be
   unit-tested by plain Node (`node tests/cloud-sync.test.ts`). `cloud.ts`
   feeds real Supabase rows through these same helpers.

   Deterministic conflict handling contract (tested here):
   * A mirror pull only ever advances a watermark to the MAXIMUM timestamp it
     actually received, and `maxFor` returns null for an empty pull so the
     previous watermark is kept - a watermark never moves backwards and the
     cloud can always push newer rows again later (at-least-once delivery).
   * `gt watermark` pulls on the server use `updated_at` for items/approvals
     and `created_at` for finalized documents/audit, both monotonic per row
     set, so ordering a pull by the same column has no gap and no race.
   =========================================================================== */

import type {
  CloudAuditEntry,
  CloudItemRow,
  CloudPurchaseItemRow,
  CloudPurchaseRow,
  CloudSaleItemRow,
  CloudSaleRow,
  SyncApproval,
  SyncAudit,
  SyncItem,
  SyncPurchase,
  SyncPurchaseItem,
  SyncSale,
  SyncSaleItem,
  TransactionApproval,
} from "./cloud-types";

/* ------------------------------------------------------------- item maps -- */

export function toSyncItem(r: CloudItemRow): SyncItem {
  return {
    sku: r.sku,
    generation: r.generation,
    category: r.category,
    capacity: r.capacity,
    capacityGb: r.capacity_gb ?? 0,
    speed: r.speed,
    ramType: r.ram_type,
    manufacturer: r.manufacturer,
    model: r.model,
    partNumber: r.part_number,
    condition: r.condition,
    ecc: r.ecc ?? false,
    registered: r.registered ?? false,
    rank: r.rank,
    moduleCount: r.module_count ?? 0,
    purchasePrice: r.purchase_price ?? 0,
    sellingPrice: r.selling_price ?? 0,
    averageCost: r.average_cost ?? 0,
    quantity: r.quantity ?? 0,
    minimumStock: r.minimum_stock ?? 0,
    location: r.location,
    notes: r.notes,
    isArchived: r.is_archived ?? false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toSyncSale(r: CloudSaleRow): SyncSale {
  return {
    id: r.id,
    approvalId: r.approval_id,
    saleNumber: r.sale_number,
    buyerName: r.buyer_name,
    saleDate: r.sale_date,
    subtotal: r.subtotal ?? 0,
    discount: r.discount ?? 0,
    total: r.total ?? 0,
    received: r.received ?? 0,
    remaining: r.remaining ?? 0,
    paymentMethod: r.payment_method,
    totalCost: r.total_cost ?? 0,
    grossProfit: r.gross_profit ?? 0,
    profitMargin: r.profit_margin ?? 0,
    notes: r.notes,
    requestedBy: r.created_by,
    requestedByEmail: r.requested_by_email,
    decidedByEmail: r.decided_by_email,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toSyncSaleItem(r: CloudSaleItemRow): SyncSaleItem {
  return {
    id: r.id,
    cloudSaleId: r.cloud_sale_id,
    sku: r.sku,
    generation: r.generation,
    category: r.category,
    capacity: r.capacity,
    speed: r.speed,
    quantity: r.quantity,
    sellingPrice: r.selling_price,
    costPerUnit: r.cost_per_unit,
    subtotal: r.subtotal,
    costTotal: r.cost_total,
    profit: r.profit,
  };
}

export function toSyncPurchase(r: CloudPurchaseRow): SyncPurchase {
  return {
    id: r.id,
    approvalId: r.approval_id,
    purchaseNumber: r.purchase_number,
    sellerName: r.seller_name,
    purchaseDate: r.purchase_date,
    subtotal: r.subtotal ?? 0,
    discount: r.discount ?? 0,
    total: r.total ?? 0,
    paid: r.paid ?? 0,
    remaining: r.remaining ?? 0,
    paymentMethod: r.payment_method,
    notes: r.notes,
    requestedBy: r.created_by,
    requestedByEmail: r.requested_by_email,
    decidedByEmail: r.decided_by_email,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toSyncPurchaseItem(r: CloudPurchaseItemRow): SyncPurchaseItem {
  return {
    id: r.id,
    cloudPurchaseId: r.cloud_purchase_id,
    sku: r.sku,
    generation: r.generation,
    category: r.category,
    capacity: r.capacity,
    speed: r.speed,
    quantity: r.quantity,
    costPerUnit: r.cost_per_unit,
    subtotal: r.subtotal,
  };
}

export function toSyncApproval(r: TransactionApproval): SyncApproval {
  return {
    id: r.id,
    kind: r.kind,
    transactionNumber: r.transaction_number,
    payload: r.payload,
    totalAmount: r.total_amount,
    itemCount: r.item_count,
    unitCount: r.unit_count,
    partyName: r.party_name,
    requestedBy: r.requested_by,
    requestedByEmail: r.requested_by_email,
    status: r.status,
    lockOwner: r.lock_owner,
    lockedAt: r.locked_at,
    decidedBy: r.decided_by,
    decidedByEmail: r.decided_by_email,
    decidedAt: r.decided_at,
    rejectionReason: r.rejection_reason,
    finalDocumentNumber: r.final_document_number,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toSyncAudit(r: CloudAuditEntry): SyncAudit {
  return {
    id: r.id,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    metadata: r.metadata,
    createdAt: r.created_at,
  };
}

/* ------------------------------------------------------------ watermark -- */

export type TimestampColumn = "updated_at" | "created_at";

/**
 * New watermark for a pull: the maximum timestamp seen, or null when nothing
 * was pulled (so the caller keeps the previous watermark). ISO-8601 strings
 * sort lexicographically, which is exactly their chronological order.
 */
export function maxFor(
  rows: Array<{ updated_at?: string | null; created_at?: string | null }>,
  key: TimestampColumn,
): string | null {
  let m: string | null = null;
  for (const r of rows) {
    const v = r[key];
    if (v && (!m || v > m)) m = v;
  }
  return m;
}

/** Deterministic, monotonic: a pull never regresses the stored watermark.
 *  The stored value is the greatest of the previous value and what the pull
 *  actually delivered - robust even if a server emits a mixed timestamp format
 *  that sorts oddly under plain string comparison (at-least-once delivery is
 *  safe because the apply step de-dupes by upsert). */
export function nextWatermark(
  previous: string,
  rows: Array<{ updated_at?: string | null; created_at?: string | null }>,
  key: TimestampColumn,
): string {
  const m = maxFor(rows, key);
  if (!m || m <= previous) return previous;
  return m;
}