/* ===========================================================================
   Approval workflow - pure logic.
   ---------------------------------------------------------------------------
   Everything in this file is side-effect free so it can be unit tested with a
   plain Node runtime (the only imports are `import type`, which type stripping
   erases). The same rules are enforced *again* inside PostgreSQL RLS policies
   and triggers - this module drives the UI, the server is the referee.
   =========================================================================== */

import type { ApprovalStatus, ApprovalRequestPayload, ProfileRow, TransactionApproval, UserRole } from "./cloud-types";
import type { RamItem } from "./types";

/* --------------------------------------------------------------- statuses -- */

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

export const APPROVAL_STATUS_SHORT: Record<ApprovalStatus, string> = {
  pending_approval: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

/** The only legal transitions: PENDING_APPROVAL -> APPROVED | REJECTED. */
export const ALLOWED_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  pending_approval: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isClosed(status: ApprovalStatus): boolean {
  return status !== "pending_approval";
}

export function statusTone(status: ApprovalStatus): "warn" | "profit" | "danger" {
  if (status === "pending_approval") return "warn";
  if (status === "approved") return "profit";
  return "danger";
}

/* ----------------------------------------------------------------- roles -- */

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Administrator",
  sales_representative: "Sales Representative",
};

export const ROLE_SHORT: Record<UserRole, string> = {
  admin: "Admin",
  sales_representative: "Sales Rep",
};

/**
 * Central permission matrix. The UI hides what a role cannot do, and the
 * same decisions are mirrored by the backend RLS policies; the matrix here is
 * purely the frontend projection (see ROLE_PERMISSIONS tests).
 */
export const ROLE_PERMISSIONS: Record<UserRole, { readonly [K in Permission]: boolean }> = {
  admin: {
    approveTransactions: true,
    manageUsers: true,
    viewAuditLog: true,
    viewAllTransactions: true,
    submitRequests: true,
    viewReports: true,
  },
  sales_representative: {
    approveTransactions: false,
    manageUsers: false,
    viewAuditLog: false,
    viewAllTransactions: false,
    submitRequests: true,
    viewReports: false,
  },
};

export type Permission =
  | "approveTransactions"
  | "manageUsers"
  | "viewAuditLog"
  | "viewAllTransactions"
  | "submitRequests"
  | "viewReports";

export function can(profile: ProfileRow | null | undefined, permission: Permission): boolean {
  if (!profile || !profile.role) return false;
  if (profile.status !== "active") return false;
  return ROLE_PERMISSIONS[profile.role][permission];
}

export function isAdmin(profile: ProfileRow | null | undefined): boolean {
  return profile?.role === "admin" && profile.status === "active";
}

/** A provisioned, active account - any role. */
export function isProvisioned(profile: ProfileRow | null | undefined): boolean {
  return Boolean(profile?.role && profile.status === "active");
}

/* ------------------------------------------------- self / state checks -- */

export interface DecisionCheck {
  ok: boolean;
  reason?: string;
}

/** Backend rules for deciding a transaction, mirrored client-side for UX. */
export function canDecideTransaction(
  profile: ProfileRow | null | undefined,
  txn: Pick<TransactionApproval, "status" | "requested_by">,
): DecisionCheck {
  if (!profile || !profile.auth_user_id) return { ok: false, reason: "You are not signed in." };
  if (!isAdmin(profile)) return { ok: false, reason: "Only administrators can approve or reject transactions." };
  if (!canDecideItself(txn.requested_by, profile.auth_user_id).ok) {
    return { ok: false, reason: "You cannot decide on a transaction you created yourself." };
  }
  if (txn.status !== "pending_approval") {
    return { ok: false, reason: "This transaction has already been decided." };
  }
  return { ok: true };
}

export function canDecideItself(requestedBy: string, actorId: string): DecisionCheck {
  if (requestedBy === actorId) return { ok: false, reason: "Self-approval is not permitted." };
  return { ok: true };
}

/* -------------------------------------------------------------- payload -- */

export type RequestKindAsClient = "sale" | "purchase";

export interface BuildRequestArgs {
  kind: RequestKindAsClient;
  partyName: string;
  date: string;
  discount: number;
  payment: number;
  method: string;
  notes: string;
  lines: { ramItemId: string; quantity: number; unitPrice: number }[];
  /** Fresh catalogue snapshot used to enrich each line with SKU + specs. */
  stockById: Record<string, RamItem>;
}

/**
 * Freeze a buy/sell form into the cloud request payload. Lines carry the SKU
 * (not the device-local row id) plus immutable spec facts, so the approving
 * device can display and finalize the request against its own catalogue.
 */
export function buildRequestPayload(args: BuildRequestArgs): ApprovalRequestPayload {
  const items = args.lines.map((l) => {
    const item = args.stockById[l.ramItemId];
    return {
      sku: item?.sku ?? "",
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      generation: item?.generation ?? "",
      category: item?.category ?? "",
      capacity: item?.capacity ?? "",
      speed: item?.speed ?? "",
    };
  });
  return {
    kind: args.kind,
    partyName: args.partyName,
    date: args.date,
    discount: args.discount,
    payment: args.payment,
    method: args.method,
    notes: args.notes,
    items,
  };
}

export function payloadTotals(payload: ApprovalRequestPayload): {
  subtotal: number;
  total: number;
  unitCount: number;
  itemCount: number;
} {
  const subtotal = payload.items.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const discount = Math.min(Math.max(0, payload.discount), subtotal);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    total: Math.round((subtotal - discount) * 100) / 100,
    unitCount: payload.items.reduce((a, l) => a + l.quantity, 0),
    itemCount: payload.items.length,
  };
}

/**
 * Resolve a stored payload into what the local Rust `create_sale` /
 * `create_purchase` commands expect, mapping each line SKU to this device's
 * catalogue row id. Throws a readable error when a SKU is not on this device.
 */
export function resolvePayloadLines(
  payload: ApprovalRequestPayload,
  catalogue: RamItem[],
): { ramItemId: string; quantity: number; unitPrice: number }[] {
  const bySku = new Map(catalogue.map((i) => [i.sku, i]));
  const missing = payload.items.filter((l) => !bySku.has(l.sku) || !bySku.get(l.sku)!.id);
  if (missing.length > 0) {
    throw new Error(
      `Cannot finalize on this device - catalogue entries not found: ${missing
        .map((l) => l.sku || "unknown SKU")
        .join(", ")}.`,
    );
  }
  return payload.items.map((l) => ({
    ramItemId: bySku.get(l.sku)!.id,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
  }));
}