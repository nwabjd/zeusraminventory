/* ===========================================================================
   Wire types - a 1:1 mirror of src-tauri/src/models.rs.
   Every struct there is `camelCase` on the wire, so these are camelCase here.
   =========================================================================== */

export type Generation = "DDR3" | "DDR4" | "DDR5";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";
export type ReturnType = "SALE_RETURN" | "PURCHASE_RETURN";
export type CoworkerKind = "LEND" | "BORROW" | "REPAYMENT";
export type AdjustmentKind = "INCREASE" | "DECREASE";
export type PersonType = "buyer" | "seller" | "coworker";

export const PAY_RECEIVE_BUYER = "RECEIVE_FROM_BUYER";
export const PAY_PAY_SELLER = "PAY_SELLER";
export const PAY_COWORKER_LEND = "COWORKER_LEND";
export const PAY_COWORKER_BORROW = "COWORKER_BORROW";
export const PAY_COWORKER_RECEIVE = "COWORKER_RECEIVE";
export const PAY_COWORKER_REPAY = "COWORKER_REPAY";

export type PaymentType =
  | typeof PAY_RECEIVE_BUYER
  | typeof PAY_PAY_SELLER
  | typeof PAY_COWORKER_LEND
  | typeof PAY_COWORKER_BORROW
  | typeof PAY_COWORKER_RECEIVE
  | typeof PAY_COWORKER_REPAY;

/* ------------------------------------------------------------ catalogue -- */

export interface RamItem {
  id: string;
  sku: string;
  generation: Generation;
  category: string;
  capacity: string;
  capacityGb: number;
  speed: string;
  ramType?: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  condition?: string;
  ecc: boolean;
  registered: boolean;
  rank?: string;
  moduleCount: number;
  purchasePrice: number;
  averageCost: number;
  sellingPrice: number;
  quantity: number;
  minimumStock: number;
  location?: string;
  notes?: string;
  isArchived: boolean;
  stockStatus: StockStatus;
  inventoryValue: number;
  retailValue: number;
  createdAt: string;
  updatedAt: string;
}

export interface RamItemInput {
  sku?: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  ramType?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  partNumber?: string | null;
  condition?: string | null;
  ecc?: boolean;
  registered?: boolean;
  rank?: string | null;
  moduleCount?: number;
  purchasePrice?: number;
  sellingPrice?: number;
  openingQuantity?: number;
  minimumStock?: number;
  location?: string | null;
  notes?: string | null;
}

export interface RamSpeed {
  id: string;
  speed: string;
  generation: string;
  category: string;
  description?: string;
}

export interface NamedValue {
  id: string;
  name: string;
  kind: string;
  description?: string;
  createdAt: string;
}

export interface AdjustmentOutcome {
  item: RamItem;
  adjustment: InventoryAdjustment;
}

/* --------------------------------------------------------------- parties -- */

export interface Party {
  id: string;
  code: string;
  companyName: string;
  contactPerson?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  address?: string;
  city?: string;
  trnVat?: string;
  notes?: string;
  openingBalance: number;
  currentBalance: number;
  totalPurchases: number;
  totalPaid: number;
  totalOutstanding: number;
  isArchived: boolean;
  transactionCount: number;
  lastActivity?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartyInput {
  code?: string;
  companyName: string;
  contactPerson?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  trnVat?: string | null;
  notes?: string | null;
  openingBalance?: number;
}

/* ------------------------------------------------------------- documents -- */

export interface TransactionLine {
  ramItemId: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  ramItemId: string;
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  quantity: number;
  costPerUnit: number;
  subtotal: number;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  sellerId?: string;
  sellerName: string;
  purchaseDate: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  paymentMethod?: string;
  notes?: string;
  status: "completed" | "void";
  voidedAt?: string;
  voidReason?: string;
  itemCount: number;
  unitCount: number;
  items: PurchaseItem[];
  createdAt: string;
  updatedAt: string;
  /** Present only on finalized cloud documents mirrored from Supabase. */
  cloudApprovalId?: string;
  requestedByEmail?: string;
  decidedByEmail?: string;
  decidedAt?: string;
}

export interface PurchaseInput {
  purchaseNumber?: string;
  sellerId?: string;
  sellerName?: string;
  purchaseDate?: string;
  discount?: number;
  amountPaid?: number;
  paymentMethod?: string;
  notes?: string;
  items: TransactionLine[];
}

export interface SaleItem {
  id: string;
  saleId: string;
  ramItemId: string;
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

export interface Sale {
  id: string;
  saleNumber: string;
  buyerId?: string;
  buyerName: string;
  saleDate: string;
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  remaining: number;
  paymentMethod?: string;
  totalCost: number;
  grossProfit: number;
  profitMargin: number;
  notes?: string;
  status: "completed" | "void";
  voidedAt?: string;
  voidReason?: string;
  itemCount: number;
  unitCount: number;
  items: SaleItem[];
  createdAt: string;
  updatedAt: string;
  /** Present only on finalized cloud documents mirrored from Supabase. */
  cloudApprovalId?: string;
  requestedByEmail?: string;
  decidedByEmail?: string;
  decidedAt?: string;
}

export interface SaleInput {
  saleNumber?: string;
  buyerId?: string;
  buyerName?: string;
  saleDate?: string;
  discount?: number;
  amountReceived?: number;
  paymentMethod?: string;
  notes?: string;
  items: TransactionLine[];
}

/* --------------------------------------------------------------- returns -- */

export interface ReturnItem {
  id: string;
  returnId: string;
  ramItemId: string;
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  subtotal: number;
}

export interface ReturnDoc {
  id: string;
  returnNumber: string;
  returnType: ReturnType;
  referenceId?: string;
  referenceNumber?: string;
  partyType: PersonType;
  partyId?: string;
  partyName: string;
  returnDate: string;
  total: number;
  refund: number;
  note?: string;
  itemCount: number;
  unitCount: number;
  items: ReturnItem[];
  createdAt: string;
}

export interface ReturnLine {
  ramItemId: string;
  quantity: number;
  unitPrice?: number;
}

export interface ReturnInput {
  returnType: ReturnType;
  referenceId?: string;
  returnDate?: string;
  refund?: number;
  note?: string;
  items: ReturnLine[];
}

/* -------------------------------------------------------------- payments -- */

export interface Payment {
  id: string;
  paymentId: string;
  paymentType: PaymentType;
  personType: PersonType;
  personId?: string;
  personName: string;
  amount: number;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  paymentDate: string;
  voidedAt?: string;
  voidReason?: string;
  status: "completed" | "void";
  createdAt: string;
}

export interface PaymentInput {
  paymentType: PaymentType;
  personId?: string;
  personName?: string;
  amount: number;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  paymentDate?: string;
  allowOverpayment?: boolean;
}

/* ------------------------------------------------------------- coworkers -- */

export interface Coworker {
  id: string;
  name: string;
  phone?: string;
  currentBalance: number;
  notes?: string;
  isArchived: boolean;
  totalLent: number;
  totalBorrowed: number;
  totalRepaid: number;
  transactionCount: number;
  lastActivity?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoworkerTransaction {
  id: string;
  coworkerId: string;
  coworkerName: string;
  kind: CoworkerKind;
  amount: number;
  balanceAfter: number;
  method?: string;
  notes?: string;
  txnDate: string;
  createdAt: string;
}

export interface CoworkerInput {
  coworkerId?: string;
  name?: string;
  kind: CoworkerKind;
  amount: number;
  method?: string;
  notes?: string;
  txnDate?: string;
}

export interface CoworkerTotals {
  receivable: number;
  payable: number;
  net: number;
  coworkerCount: number;
  transactionCount: number;
}

/* ----------------------------------------------------------------- stock -- */

export interface StockMovement {
  id: string;
  ramItemId: string;
  sku: string;
  quantityChange: number;
  previousStock: number;
  newStock: number;
  movementType:
    | "PURCHASE"
    | "SALE"
    | "ADJUSTMENT_IN"
    | "ADJUSTMENT_OUT"
    | "SALE_RETURN"
    | "PURCHASE_RETURN"
    | "INITIAL";
  referenceType?: string;
  referenceId?: string;
  referenceNumber?: string;
  notes?: string;
  createdAt: string;
}

export interface InventoryAdjustment {
  id: string;
  ramItemId: string;
  sku: string;
  adjustmentType: AdjustmentKind;
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;
  notes?: string;
  createdAt: string;
}

export interface AdjustmentInput {
  ramItemId: string;
  adjustmentType: AdjustmentKind;
  quantity: number;
  reason: string;
  notes?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  description?: string;
  createdAt: string;
}

/* ------------------------------------------------------------- dashboard -- */

export interface Slice {
  label: string;
  value: number;
  count: number;
}

export interface NameValueRow {
  label: string;
  value: number;
  count: number;
}

export interface DashboardStats {
  totalStock: number;
  totalSkus: number;
  totalInventoryCost: number;
  estimatedSalesValue: number;
  potentialProfit: number;
  todaySales: number;
  todayPurchases: number;
  todayProfit: number;
  todaySaleCount: number;
  todayPurchaseCount: number;
  buyerReceivable: number;
  sellerPayable: number;
  coworkerReceivable: number;
  coworkerPayable: number;
  lowStockCount: number;
  outOfStockCount: number;
  buyerCount: number;
  sellerCount: number;
  monthSales: number;
  monthProfit: number;
  monthPurchases: number;
  averageMargin: number;
  inventoryByGeneration: Slice[];
  inventoryByCategory: Slice[];
  lowStockItems: RamItem[];
  recentPurchases: Purchase[];
  recentSales: Sale[];
  recentPayments: Payment[];
  recentMovements: StockMovement[];
  topBuyers: NameValueRow[];
  topSellers: NameValueRow[];
}

/* --------------------------------------------------------------- reports -- */

/**
 * Mirrors `models::ReportFilter`. Every field is present, because the Rust
 * struct deserialises empty strings as "no filter" rather than treating a
 * missing key as a filter - so the frontend always sends the full object and
 * never has to deal with `undefined`.
 */
export interface ReportFilter {
  from: string;
  to: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  manufacturer: string;
  partyId: string;
  location: string;
  paymentType: string;
  method: string;
  status: string;
}

export const emptyReportFilter = (): ReportFilter => ({
  from: "",
  to: "",
  generation: "",
  category: "",
  capacity: "",
  speed: "",
  manufacturer: "",
  partyId: "",
  location: "",
  paymentType: "",
  method: "",
  status: "",
});

export interface InventoryReportRow {
  sku: string;
  generation: string;
  category: string;
  capacity: string;
  speed: string;
  manufacturer?: string;
  partNumber?: string;
  location?: string;
  quantity: number;
  minimumStock: number;
  averageCost: number;
  sellingPrice: number;
  costValue: number;
  retailValue: number;
  stockStatus: StockStatus;
}

export interface InventoryReport {
  rows: InventoryReportRow[];
  totalSkus: number;
  totalUnits: number;
  totalCostValue: number;
  totalRetailValue: number;
  expectedProfit: number;
  lowStockCount: number;
  outOfStockCount: number;
  deadStockCount: number;
}

export interface PurchaseReport {
  rows: Purchase[];
  totalDocuments: number;
  totalUnits: number;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  voided: number;
}

export interface SalesReport {
  rows: Sale[];
  totalDocuments: number;
  totalUnits: number;
  subtotal: number;
  discount: number;
  total: number;
  received: number;
  outstanding: number;
  totalCost: number;
  grossProfit: number;
  averageMargin: number;
  voided: number;
}

export interface ProfitRow {
  period: string;
  salesTotal: number;
  salesCost: number;
  grossProfit: number;
  margin: number;
  unitsSold: number;
  transactions: number;
}

export interface ProfitReport {
  rows: ProfitRow[];
  salesTotal: number;
  salesCost: number;
  grossProfit: number;
  purchasesTotal: number;
  netCashFlow: number;
  averageMargin: number;
  bestDay: string;
  bestDayProfit: number;
  profitByGeneration: Slice[];
  profitByCategory: Slice[];
}

export interface PartyBalanceReport {
  rows: Party[];
  totalOutstanding: number;
  totalBilled: number;
  totalPaid: number;
  partyCount: number;
}

export interface PaymentReport {
  rows: Payment[];
  totalReceived: number;
  totalPaid: number;
  net: number;
  paymentCount: number;
  byMethod: Slice[];
}

export interface CoworkerReport {
  rows: Coworker[];
  transactions: CoworkerTransaction[];
  receivable: number;
  payable: number;
  net: number;
}

export interface StockMovementReport {
  rows: StockMovement[];
  totalIn: number;
  totalOut: number;
  netChange: number;
  movementCount: number;
  byType: Slice[];
}

/* ------------------------------------------------------------- statements -- */

export interface StatementLine {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface Statement {
  partyId: string;
  partyName: string;
  code: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: StatementLine[];
}

/* ---------------------------------------------------------- backup / app -- */

export interface BackupInfo {
  databasePath: string;
  backupDir: string;
  lastBackup: string;
  lastBackupPath: string;
  autoBackup: boolean;
  backupIntervalHours: number;
  databaseSizeBytes: number;
  available: boolean;
}

export interface BackupEntry {
  path: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface SearchHit {
  kind: "inventory" | "buyer" | "seller" | "purchase" | "sale" | "payment";
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  route: string;
}

export interface DemoSummary {
  buyers: number;
  sellers: number;
  ramItems: number;
  purchases: number;
  sales: number;
  payments: number;
  coworkers: number;
}

export interface StartupInfo {
  version: string;
  databasePath: string;
  databaseSizeBytes: number;
  settings: Record<string, string>;
  backup: BackupInfo;
  autoBackup: string;
}
