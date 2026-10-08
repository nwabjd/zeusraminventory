/* ===========================================================================
   Typed bridge to the Rust backend.
   ---------------------------------------------------------------------------
   Every function here is a thin, typed wrapper around one Tauri command. The
   legacy `services/*` layer used `@tauri-apps/plugin-sql`; database access now
   lives in Rust (`rusqlite`), so all data flows through `invoke` and every
   write happens inside a single real database transaction on the Rust side.
   =========================================================================== */

import { invoke } from "@tauri-apps/api/core";
import { cloudEnabled } from "./cloud-config";
import type {
  CloudAuditEntry,
  SyncApplyResult,
  SyncSnapshot,
  SyncWatermark,
  TransactionApproval,
} from "./cloud-types";
import type {
  AdjustmentInput,
  AdjustmentOutcome,
  AuditEntry,
  BackupEntry,
  BackupInfo,
  Coworker,
  CoworkerInput,
  CoworkerTotals,
  CoworkerTransaction,
  DashboardStats,
  DemoSummary,
  InventoryAdjustment,
  InventoryReport,
  NameValueRow,
  NamedValue,
  Party,
  PartyBalanceReport,
  PartyInput,
  Payment,
  PaymentInput,
  PaymentReport,
  ProfitReport,
  Purchase,
  PurchaseInput,
  PurchaseReport,
  RamItem,
  RamItemInput,
  RamSpeed,
  ReturnDoc,
  ReturnInput,
  Sale,
  SaleInput,
  SalesReport,
  SearchHit,
  StartupInfo,
  Statement,
  StockMovement,
  StockMovementReport,
  CoworkerReport,
} from "./types";

/** Backend errors arrive as plain strings so messages reach the UI verbatim. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Something went wrong. Please try again.";
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return (await invoke(cmd, args)) as T;
  } catch (err) {
    throw new Error(errorMessage(err));
  }
}

/* ------------------------------------------------- cloud-aware filtering -- */
// The cloud mirror accepts the same shape as the local ledger commands, so a
// single arg builder serves both. The mirror deliberately ignores buyer/seller
// id, manufacturer and location (kept for API parity) - finalized rows are
// keyed by the cloud records, not local engine references.

export interface SalesListFilter {
  search?: string;
  buyerId?: string;
  status?: string;
  method?: string;
  from?: string;
  to?: string;
  generation?: string;
  category?: string;
  capacity?: string;
  speed?: string;
  manufacturer?: string;
  location?: string;
  limit?: number;
}

export interface PurchaseListFilter {
  search?: string;
  sellerId?: string;
  status?: string;
  method?: string;
  from?: string;
  to?: string;
  generation?: string;
  category?: string;
  capacity?: string;
  speed?: string;
  manufacturer?: string;
  location?: string;
  limit?: number;
}

function salesListArgs(f: SalesListFilter = {}) {
  return {
    search: f.search ?? "",
    buyerId: f.buyerId || null,
    status: f.status || null,
    method: f.method || null,
    from: f.from ?? "",
    to: f.to ?? "",
    generation: f.generation || null,
    category: f.category || null,
    capacity: f.capacity || null,
    speed: f.speed || null,
    manufacturer: f.manufacturer || null,
    location: f.location || null,
    limit: f.limit ?? null,
  };
}

function purchaseListArgs(f: PurchaseListFilter = {}) {
  return salesListArgs({
    ...f,
    buyerId: f.sellerId,
  });
}

/* ================================================================== app === */

export const api = {
  ping: () => call<string>("ping"),
  bootstrap: () => call<StartupInfo>("bootstrap"),
  roundMoney: (value: number) => call<number>("round_money", { value }),

  /* ----------------------------------------------------------- settings -- */
  appSettings: () => call<Record<string, string>>("app_settings"),
  saveSettings: (values: Record<string, string>) =>
    call<number>("save_settings", { values }),

  /* ---------------------------------------------------------- dashboard -- */
  dashboard: () => call<DashboardStats>("dashboard_stats"),

  /* ---------------------------------------------------------- inventory -- */
  listRamItems: (
    f: Partial<{
      search: string;
      generation: string;
      category: string;
      capacity: string;
      speed: string;
      manufacturer: string;
      condition: string;
      location: string;
      stockStatus: string;
      includeArchived: boolean;
      sort: string;
      limit: number;
    }> = {},
  ) =>
    call<RamItem[]>("list_ram_items", {
      search: f.search ?? "",
      generation: f.generation || null,
      category: f.category || null,
      capacity: f.capacity || null,
      speed: f.speed || null,
      manufacturer: f.manufacturer || null,
      condition: f.condition || null,
      location: f.location || null,
      stockStatus: f.stockStatus ?? "all",
      includeArchived: f.includeArchived ?? false,
      sort: f.sort ?? "sku_asc",
      limit: f.limit ?? null,
    }),

  getRamItem: (id: string) => call<RamItem>("get_ram_item", { id }),
  searchRamItems: (query: string, inStockOnly: boolean, limit = 25) =>
    call<RamItem[]>("search_ram_items", { query, inStockOnly, limit }),
  lowStockItems: (limit = 50) => call<RamItem[]>("low_stock_items", { limit }),
  ramFacets: () => call<[string, string[]][]>("ram_facets"),

  createRamItem: (input: RamItemInput) =>
    call<RamItem>("create_ram_item", { input }),
  updateRamItem: (id: string, input: RamItemInput) =>
    call<RamItem>("update_ram_item", { id, input }),
  setRamArchived: (id: string, archived: boolean) =>
    call<RamItem>("set_ram_archived", { id, archived }),
  adjustStock: (input: AdjustmentInput) =>
    call<AdjustmentOutcome>("adjust_stock", { input }),

  itemMovements: (ramItemId: string) =>
    call<StockMovement[]>("item_movements", { ramItemId }),
  itemAdjustments: (ramItemId: string) =>
    call<InventoryAdjustment[]>("item_adjustments", { ramItemId }),
  itemPurchases: (ramItemId: string) =>
    call<Purchase[]>("item_purchases", { ramItemId }),
  itemSales: (ramItemId: string) => call<Sale[]>("item_sales", { ramItemId }),

  /* ------------------------------------------------------ master / refs -- */
  listSpeeds: (generation?: string) =>
    call<RamSpeed[]>("list_speeds", { generation: generation || null }),
  saveSpeed: (
    id: string | null,
    speed: string,
    generation: string,
    category: string,
    description?: string,
  ) =>
    call<RamSpeed>("save_speed", {
      id,
      speed,
      generation,
      category,
      description: description || null,
    }),
  deleteSpeed: (id: string) => call<void>("delete_speed", { id }),

  listNamedValues: (kind: string) => call<NamedValue[]>("list_named_values", { kind }),
  saveNamedValue: (kind: string, id: string | null, name: string, description?: string) =>
    call<NamedValue>("save_named_value", {
      kind,
      id,
      name,
      description: description || null,
    }),
  deleteNamedValue: (kind: string, id: string) =>
    call<void>("delete_named_value", { kind, id }),

  /* -------------------------------------------------------------- buyers -- */
  listBuyers: (search = "", includeArchived = false) =>
    call<Party[]>("list_buyers", { search, includeArchived }),
  getBuyer: (id: string) => call<Party>("get_buyer", { id }),
  searchBuyers: (query: string, limit = 25) =>
    call<Party[]>("search_buyers", { query, limit }),
  createBuyer: (input: PartyInput) => call<Party>("create_buyer", { input }),
  updateBuyer: (id: string, input: PartyInput) =>
    call<Party>("update_buyer", { id, input }),
  setBuyerArchived: (id: string, archived: boolean) =>
    call<Party>("set_buyer_archived", { id, archived }),
  deleteBuyer: (id: string) => call<void>("delete_buyer", { id }),
  buyerStatement: (id: string, from = "", to = "") =>
    call<Statement>("buyer_statement", { id, from, to }),

  /* ------------------------------------------------------------- sellers -- */
  listSellers: (search = "", includeArchived = false) =>
    call<Party[]>("list_sellers", { search, includeArchived }),
  getSeller: (id: string) => call<Party>("get_seller", { id }),
  searchSellers: (query: string, limit = 25) =>
    call<Party[]>("search_sellers", { query, limit }),
  createSeller: (input: PartyInput) => call<Party>("create_seller", { input }),
  updateSeller: (id: string, input: PartyInput) =>
    call<Party>("update_seller", { id, input }),
  setSellerArchived: (id: string, archived: boolean) =>
    call<Party>("set_seller_archived", { id, archived }),
  deleteSeller: (id: string) => call<void>("delete_seller", { id }),
  sellerStatement: (id: string, from = "", to = "") =>
    call<Statement>("seller_statement", { id, from, to }),

  /* ----------------------------------------------------------- purchases -- */
  listPurchases: (f: PurchaseListFilter = {}) =>
    call<Purchase[]>("list_purchases", purchaseListArgs(f)),
  getPurchase: async (id: string) => {
    // Cloud mode: a finalized cloud document lives in the local mirror, not the
    // engine ledger. Try the ledger first (legacy docs still load), then the
    // authoritative mirror.
    if (!cloudEnabled()) return call<Purchase>("get_purchase", { id });
    try {
      return await call<Purchase>("get_purchase", { id });
    } catch {
      return call<Purchase>("get_cloud_purchase", { id });
    }
  },
  getPurchaseByNumber: (number: string) =>
    call<Purchase>("get_purchase_by_number", { number }),
  createPurchase: (input: PurchaseInput) =>
    call<Purchase>("create_purchase", { input }),
  voidPurchase: (id: string, reason: string) =>
    call<Purchase>("void_purchase", { id, reason }),
  payPurchase: (
    id: string,
    amount: number,
    method: string,
    notes?: string,
    date?: string,
  ) =>
    call<Purchase>("pay_purchase", {
      id,
      amount,
      method,
      notes: notes || null,
      date: date ?? todayIso(),
    }),

  /* --------------------------------------------------------------- sales -- */
  listSales: (f: SalesListFilter = {}) => call<Sale[]>("list_sales", salesListArgs(f)),
  getSale: async (id: string) => {
    // Cloud mode: try the legacy engine ledger first, then the authoritative
    // mirrored cloud document (which is what a cloud-doc URL id refers to).
    if (!cloudEnabled()) return call<Sale>("get_sale", { id });
    try {
      return await call<Sale>("get_sale", { id });
    } catch {
      return call<Sale>("get_cloud_sale", { id });
    }
  },
  getSaleByNumber: (number: string) => call<Sale>("get_sale_by_number", { number }),
  createSale: (input: SaleInput) => call<Sale>("create_sale", { input }),
  voidSale: (id: string, reason: string) => call<Sale>("void_sale", { id, reason }),
  receiveSale: (
    id: string,
    amount: number,
    method: string,
    notes?: string,
    date?: string,
  ) =>
    call<Sale>("receive_sale", {
      id,
      amount,
      method,
      notes: notes || null,
      date: date ?? todayIso(),
    }),

  /* -------------------------------------- cloud history + mirror (C2L) ----- */
  // The visible sale/purchase history in cloud mode is the authoritative,
  // finalized set mirrored from Supabase. Statements/returns keep using the
  // engine `listSales`/`listPurchases` so local balances stay consistent.
  salesHistory: (f: SalesListFilter = {}) =>
    cloudEnabled()
      ? call<Sale[]>("list_cloud_sales", salesListArgs(f))
      : call<Sale[]>("list_sales", salesListArgs(f)),

  purchasesHistory: (f: PurchaseListFilter = {}) =>
    cloudEnabled()
      ? call<Purchase[]>("list_cloud_purchases", purchaseListArgs(f))
      : call<Purchase[]>("list_purchases", purchaseListArgs(f)),

  listCloudSales: (f: SalesListFilter = {}) =>
    call<Sale[]>("list_cloud_sales", salesListArgs(f)),
  getCloudSale: (id: string) => call<Sale>("get_cloud_sale", { id }),
  listCloudPurchases: (f: PurchaseListFilter = {}) =>
    call<Purchase[]>("list_cloud_purchases", purchaseListArgs(f)),
  getCloudPurchase: (id: string) => call<Purchase>("get_cloud_purchase", { id }),
  listCloudCachedApprovals: (status: string | null = null) =>
    call<TransactionApproval[]>("list_cloud_cached_approvals", { status }),
  listCloudCachedAudit: (limit = 200) =>
    call<CloudAuditEntry[]>("list_cloud_cached_audit", { limit }),

  /* ---------------------------------------------------------------- sync -- */
  syncGetWatermarks: () => call<SyncWatermark[]>("sync_get_watermarks"),
  syncApply: (snapshot: SyncSnapshot) => call<SyncApplyResult>("sync_apply", { snapshot }),
  syncClear: () => call<void>("sync_clear"),

  /* ------------------------------------------------------------- returns -- */
  listReturns: (returnType?: string, from = "", to = "") =>
    call<ReturnDoc[]>("list_returns", {
      returnType: returnType || null,
      from,
      to,
    }),
  getReturn: (id: string) => call<ReturnDoc>("get_return", { id }),
  createReturn: (input: ReturnInput) => call<ReturnDoc>("create_return", { input }),
  returnedQuantity: (ramItemId: string, referenceId: string) =>
    call<number>("returned_quantity", { ramItemId, referenceId }),

  /* ------------------------------------------------------------ payments -- */
  listPayments: (
    f: Partial<{
      search: string;
      paymentType: string;
      personType: string;
      personId: string;
      method: string;
      status: string;
      from: string;
      to: string;
      limit: number;
    }> = {},
  ) =>
    call<Payment[]>("list_payments", {
      search: f.search ?? "",
      paymentType: f.paymentType || null,
      personType: f.personType || null,
      personId: f.personId || null,
      method: f.method || null,
      status: f.status || null,
      from: f.from ?? "",
      to: f.to ?? "",
      limit: f.limit ?? null,
    }),
  paymentTotals: (
    from = "",
    to = "",
    paymentType?: string,
    personId?: string,
  ) =>
    call<[number, number, number, number]>("payment_totals", {
      from,
      to,
      paymentType: paymentType || null,
      personId: personId || null,
    }),
  recordPayment: (input: PaymentInput) => call<Payment>("record_payment", { input }),
  reversePayment: (id: string, reason: string) =>
    call<Payment>("reverse_payment", { id, reason }),

  /* ----------------------------------------------------------- coworker -- */
  listCoworkers: (search = "", includeArchived = false) =>
    call<Coworker[]>("list_coworkers", { search, includeArchived }),
  getCoworker: (id: string) => call<Coworker>("get_coworker", { id }),
  coworkerTotals: () => call<CoworkerTotals>("coworker_totals"),
  coworkerTransactions: (coworkerId: string, from = "", to = "") =>
    call<CoworkerTransaction[]>("coworker_transactions", {
      coworkerId,
      from,
      to,
    }),
  allCoworkerTransactions: (from = "", to = "") =>
    call<CoworkerTransaction[]>("all_coworker_transactions", { from, to }),
  createCoworker: (name: string, phone?: string, notes?: string) =>
    call<Coworker>("create_coworker", { name, phone: phone || null, notes: notes || null }),
  updateCoworker: (id: string, name: string, phone?: string, notes?: string) =>
    call<Coworker>("update_coworker", {
      id,
      name,
      phone: phone || null,
      notes: notes || null,
    }),
  setCoworkerArchived: (id: string, archived: boolean) =>
    call<Coworker>("set_coworker_archived", { id, archived }),
  recordCoworkerEntry: (input: CoworkerInput) =>
    call<CoworkerTransaction>("record_coworker_entry", { input }),

  /* ----------------------------------------------------------- movements -- */
  recentMovements: (limit = 20) => call<StockMovement[]>("recent_movements", { limit }),
  listAudit: (limit = 100, entity?: string) =>
    call<AuditEntry[]>("list_audit", { limit, entity: entity || null }),

  /* ------------------------------------------------------------- reports -- */
  reportInventory: (filter: unknown) =>
    call<InventoryReport>("report_inventory", { filter }),
  reportPurchases: (filter: unknown) =>
    call<PurchaseReport>("report_purchases", { filter }),
  reportSales: (filter: unknown) => call<SalesReport>("report_sales", { filter }),
  reportProfit: (filter: unknown, grouping: string) =>
    call<ProfitReport>("report_profit", { filter, grouping }),
  reportBuyerBalances: (filter: unknown) =>
    call<PartyBalanceReport>("report_buyer_balances", { filter }),
  reportSellerBalances: (filter: unknown) =>
    call<PartyBalanceReport>("report_seller_balances", { filter }),
  reportPayments: (filter: unknown) => call<PaymentReport>("report_payments", { filter }),
  reportCoworkers: (filter: unknown) => call<CoworkerReport>("report_coworkers", { filter }),
  reportStockMovements: (filter: unknown) =>
    call<StockMovementReport>("report_stock_movements", { filter }),
  reportReturns: (filter: unknown) => call<InventoryReport>("report_returns", { filter }),
  reportTopMovers: (filter: unknown, limit = 10) =>
    call<NameValueRow[]>("report_top_movers", { filter, limit }),

  /* -------------------------------------------------------------- search -- */
  globalSearch: (query: string, limit = 12) =>
    call<SearchHit[]>("global_search", { query, limit }),

  /* ------------------------------------------------------------- backups -- */
  backupInfo: () => call<BackupInfo>("backup_info"),
  listBackups: () => call<BackupEntry[]>("list_backups"),
  backupNow: () => call<BackupInfo>("backup_now"),
  restoreBackup: (path: string) => call<BackupInfo>("restore_backup", { path }),
  verifyBackup: (path: string) => call<void>("verify_backup", { path }),

  /* --------------------------------------------------------------- demo -- */
  demoSummary: () => call<DemoSummary>("demo_summary"),
  demoIsEmpty: () => call<boolean>("demo_is_empty"),
  loadDemoData: () => call<DemoSummary>("load_demo_data"),
  clearAllData: () => call<DemoSummary>("clear_all_data"),
};

/** Local calendar date as `YYYY-MM-DD`, which is what the backend stores. */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export { call as invokeCommand };
