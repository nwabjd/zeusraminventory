/* ===========================================================================
   Cloud (Supabase) wire types - the multi-user layer.
   ---------------------------------------------------------------------------
   These mirror the PostgreSQL tables in supabase/migrations. The cloud store
   is authoritative for users, roles, approval workflow and the audit trail;
   the desktop SQLite database remains the inventory ledger engine.
   =========================================================================== */

export type UserRole = "admin" | "sales_representative";
export type AccountStatus = "pending" | "active" | "inactive";
export type ApprovalStatus = "pending_approval" | "approved" | "rejected";

export interface ProfileRow {
  id: string;
  /** NULL until the invited Google account has logged in for the first time. */
  auth_user_id: string | null;
  google_uid: string | null;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  /** NULL means "not provisioned" - never granted automatic access. */
  role: UserRole | null;
  status: AccountStatus;
  created_by: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RequestKind = "sale" | "purchase";

/** One line of a pending request, enriched with catalogue facts so the
 *  approver's device (which has its own local row ids) can read and finalize. */
export interface ApprovalRequestLine {
  sku: string;
  quantity: number;
  unitPrice: number;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
}

/** The frozen request payload. Stored as jsonb in transaction_approvals.payload. */
export interface ApprovalRequestPayload {
  kind: RequestKind;
  partyName: string;
  date: string;
  discount: number;
  payment: number;
  method: string;
  notes: string;
  items: ApprovalRequestLine[];
}

export interface TransactionApproval {
  id: string;
  kind: RequestKind;
  transaction_number: string;
  payload: ApprovalRequestPayload;
  total_amount: number;
  item_count: number;
  unit_count: number;
  party_name: string;
  requested_by: string;
  requested_by_email: string;
  status: ApprovalStatus;
  /** The administrator who locked/decided this request. */
  lock_owner: string | null;
  locked_at: string | null;
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  /** Local ledger document number created when the approval was finalized. */
  final_document_number: string | null;
  created_at: string;
  updated_at: string;
}

export type ApprovalActionName = "submitted" | "approved" | "rejected";

export interface ApprovalActionRow {
  id: string;
  approval_id: string;
  action: ApprovalActionName;
  actor_id: string;
  actor_email: string;
  from_status: ApprovalStatus | null;
  to_status: ApprovalStatus | null;
  reason: string | null;
  created_at: string;
}

export type CloudAuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "SALE_CREATED"
  | "SALE_APPROVED"
  | "SALE_REJECTED"
  | "PURCHASE_CREATED"
  | "PURCHASE_APPROVED"
  | "PURCHASE_REJECTED"
  | "USER_CREATED"
  | "USER_ACTIVATED"
  | "USER_DEACTIVATED"
  | "ROLE_CHANGED"
  | "ADMIN_BOOTSTRAPPED";

export interface CloudAuditEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: CloudAuditAction | string;
  entity: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/* ===========================================================================
   Authoritative ledger (cloud_items / cloud_sales / cloud_purchases...).
   The Supabase database owns these rows; the desktop mirrors them. The
   snake_case `CloudXxxRow` interfaces match the PostgreSQL columns, and the
   camelCase `SyncXxx` interfaces match the Rust mirror snapshot (sync_apply).
   =========================================================================== */

export interface CloudItemRow {
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  capacity_gb: number;
  speed: string;
  ram_type: string | null;
  manufacturer: string | null;
  model: string | null;
  part_number: string | null;
  condition: string | null;
  ecc: boolean;
  registered: boolean;
  rank: string | null;
  module_count: number;
  purchase_price: number;
  selling_price: number;
  average_cost: number;
  quantity: number;
  minimum_stock: number;
  location: string | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface CloudSaleRow {
  id: string;
  approval_id: string | null;
  sale_number: string;
  buyer_name: string;
  sale_date: string;
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  remaining: number;
  payment_method: string;
  total_cost: number;
  gross_profit: number;
  profit_margin: number;
  notes: string | null;
  created_by: string;
  requested_by_email: string;
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudSaleItemRow {
  id: string;
  cloud_sale_id: string;
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  quantity: number;
  selling_price: number;
  cost_per_unit: number;
  subtotal: number;
  cost_total: number;
  profit: number;
}

export interface CloudPurchaseRow {
  id: string;
  approval_id: string | null;
  purchase_number: string;
  seller_name: string;
  purchase_date: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  payment_method: string;
  notes: string | null;
  created_by: string;
  requested_by_email: string;
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudPurchaseItemRow {
  id: string;
  cloud_purchase_id: string;
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  quantity: number;
  cost_per_unit: number;
  subtotal: number;
}

/* ------------------------------------------- Rust mirror snapshot shapes -- */

export interface SyncItem {
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  capacityGb: number;
  speed: string;
  ramType: string | null;
  manufacturer: string | null;
  model: string | null;
  partNumber: string | null;
  condition: string | null;
  ecc: boolean;
  registered: boolean;
  rank: string | null;
  moduleCount: number;
  purchasePrice: number;
  sellingPrice: number;
  averageCost: number;
  quantity: number;
  minimumStock: number;
  location: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SyncSale {
  id: string;
  approvalId: string | null;
  saleNumber: string;
  buyerName: string;
  saleDate: string;
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  remaining: number;
  paymentMethod: string | null;
  totalCost: number;
  grossProfit: number;
  profitMargin: number;
  notes: string | null;
  requestedBy: string | null;
  requestedByEmail: string;
  decidedByEmail: string | null;
  decidedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SyncSaleItem {
  id: string | null;
  cloudSaleId: string;
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  quantity: number;
  sellingPrice: number;
  costPerUnit: number;
  subtotal: number;
  costTotal: number;
  profit: number;
}

export interface SyncPurchase {
  id: string;
  approvalId: string | null;
  purchaseNumber: string;
  sellerName: string;
  purchaseDate: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod: string | null;
  notes: string | null;
  requestedBy: string | null;
  requestedByEmail: string;
  decidedByEmail: string | null;
  decidedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SyncPurchaseItem {
  id: string | null;
  cloudPurchaseId: string;
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  quantity: number;
  costPerUnit: number;
  subtotal: number;
}

export interface SyncApproval {
  id: string;
  kind: RequestKind;
  transactionNumber: string;
  payload: ApprovalRequestPayload;
  totalAmount: number;
  itemCount: number;
  unitCount: number;
  partyName: string;
  requestedBy: string | null;
  requestedByEmail: string;
  status: ApprovalStatus;
  lockOwner: string | null;
  lockedAt: string | null;
  decidedBy: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  finalDocumentNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncAudit {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** The full payload handed to the Rust `sync_apply` command in one call. */
export interface SyncSnapshot {
  items: SyncItem[];
  sales: SyncSale[];
  saleItems: SyncSaleItem[];
  purchases: SyncPurchase[];
  purchaseItems: SyncPurchaseItem[];
  approvals: SyncApproval[];
  audit: SyncAudit[];
  watermarks: Record<string, string>;
}

export interface SyncWatermark {
  key: string;
  watermark: string;
}

export interface SyncApplyResult {
  items: number;
  sales: number;
  purchases: number;
  approvals: number;
  audit: number;
}

/** Result of a finalize_approval RPC, as surfaced by the cloud client. */
export interface CloudFinalizeResult {
  ok: boolean;
  alreadyProcessed?: boolean;
  documentNumber?: string;
  error?: string;
}