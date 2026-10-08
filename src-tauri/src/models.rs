//! Wire-format data transfer objects shared with the React frontend.
//!
//! Every struct is `camelCase` on the wire so the TypeScript side reads
//! idiomatically.

use serde::{Deserialize, Serialize};

// ============================================================ catalogue ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RamItem {
    pub id: String,
    pub sku: String,
    pub generation: String,
    pub category: String,
    pub capacity: String,
    pub capacity_gb: i64,
    pub speed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ram_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
    pub ecc: bool,
    pub registered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<String>,
    pub module_count: i64,
    pub purchase_price: f64,
    pub average_cost: f64,
    pub selling_price: f64,
    pub quantity: i64,
    pub minimum_stock: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub is_archived: bool,
    /// `in_stock` | `low_stock` | `out_of_stock`
    pub stock_status: String,
    /// quantity * average_cost
    pub inventory_value: f64,
    /// quantity * selling_price
    pub retail_value: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RamItemInput {
    #[serde(default)]
    pub sku: Option<String>,
    pub generation: String,
    pub category: String,
    pub capacity: String,
    pub speed: String,
    #[serde(default)]
    pub ram_type: Option<String>,
    #[serde(default)]
    pub manufacturer: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub part_number: Option<String>,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default)]
    pub ecc: bool,
    #[serde(default)]
    pub registered: bool,
    #[serde(default)]
    pub rank: Option<String>,
    #[serde(default = "one")]
    pub module_count: i64,
    #[serde(default)]
    pub purchase_price: f64,
    #[serde(default)]
    pub selling_price: f64,
    #[serde(default)]
    pub opening_quantity: i64,
    #[serde(default)]
    pub minimum_stock: i64,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RamSpeed {
    pub id: String,
    pub speed: String,
    pub generation: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedValue {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

// ============================================================== parties ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    pub id: String,
    pub code: String,
    pub company_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_person: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whatsapp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trn_vat: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub opening_balance: f64,
    /// Buyers: >0 they owe us. Sellers: >0 we owe them.
    pub current_balance: f64,
    pub total_purchases: f64,
    pub total_paid: f64,
    pub total_outstanding: f64,
    pub is_archived: bool,
    /// Number of documents referencing this party.
    pub transaction_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartyInput {
    #[serde(default)]
    pub code: Option<String>,
    pub company_name: String,
    #[serde(default)]
    pub contact_person: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub whatsapp: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub trn_vat: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub opening_balance: f64,
}

// ============================================================== documents ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    pub id: String,
    pub purchase_number: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seller_id: Option<String>,
    pub seller_name: String,
    pub purchase_date: String,
    pub subtotal: f64,
    pub discount: f64,
    pub total: f64,
    pub paid: f64,
    pub remaining: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voided_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void_reason: Option<String>,
    pub item_count: i64,
    pub unit_count: i64,
    pub items: Vec<PurchaseItem>,
    pub created_at: String,
    pub updated_at: String,
    /// Present only for cloud-finalized documents (the mirror). Lets the UI
    /// mark immutable cloud history and link back to its approval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_by_email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_by_email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseItem {
    pub id: String,
    pub purchase_id: String,
    pub ram_item_id: String,
    pub sku: String,
    pub generation: String,
    pub category: String,
    pub capacity: String,
    pub speed: String,
    pub quantity: i64,
    pub cost_per_unit: f64,
    pub subtotal: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseInput {
    #[serde(default)]
    pub purchase_number: Option<String>,
    #[serde(default)]
    pub seller_id: Option<String>,
    #[serde(default)]
    pub seller_name: Option<String>,
    #[serde(default)]
    pub purchase_date: Option<String>,
    #[serde(default)]
    pub discount: f64,
    #[serde(default)]
    pub amount_paid: f64,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub items: Vec<TransactionLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Sale {
    pub id: String,
    pub sale_number: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buyer_id: Option<String>,
    pub buyer_name: String,
    pub sale_date: String,
    pub subtotal: f64,
    pub discount: f64,
    pub total: f64,
    pub received: f64,
    pub remaining: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_method: Option<String>,
    pub total_cost: f64,
    pub gross_profit: f64,
    pub profit_margin: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voided_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void_reason: Option<String>,
    pub item_count: i64,
    pub unit_count: i64,
    pub items: Vec<SaleItem>,
    pub created_at: String,
    pub updated_at: String,
    /// Present only for cloud-finalized documents (the mirror). Lets the UI
    /// mark immutable cloud history and link back to its approval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_approval_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_by_email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_by_email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaleItem {
    pub id: String,
    pub sale_id: String,
    pub ram_item_id: String,
    pub sku: String,
    pub generation: String,
    pub category: String,
    pub capacity: String,
    pub speed: String,
    pub quantity: i64,
    pub selling_price: f64,
    pub cost_per_unit: f64,
    pub subtotal: f64,
    pub cost_total: f64,
    pub profit: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaleInput {
    #[serde(default)]
    pub sale_number: Option<String>,
    #[serde(default)]
    pub buyer_id: Option<String>,
    #[serde(default)]
    pub buyer_name: Option<String>,
    #[serde(default)]
    pub sale_date: Option<String>,
    #[serde(default)]
    pub discount: f64,
    #[serde(default)]
    pub amount_received: f64,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub items: Vec<TransactionLine>,
}

/// One row of a buy/sell document before it is persisted.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransactionLine {
    pub ram_item_id: String,
    pub quantity: i64,
    /// Purchase unit cost, or sale unit price, depending on the document.
    pub unit_price: f64,
}

// =============================================================== returns ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReturnDoc {
    pub id: String,
    pub return_number: String,
    /// `SALE_RETURN` | `PURCHASE_RETURN`
    pub return_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_number: Option<String>,
    pub party_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub party_id: Option<String>,
    pub party_name: String,
    pub return_date: String,
    pub total: f64,
    pub refund: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub item_count: i64,
    pub unit_count: i64,
    pub items: Vec<ReturnItem>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReturnItem {
    pub id: String,
    pub return_id: String,
    pub ram_item_id: String,
    pub sku: String,
    pub generation: String,
    pub category: String,
    pub capacity: String,
    pub speed: String,
    pub quantity: i64,
    pub unit_price: f64,
    pub unit_cost: f64,
    pub subtotal: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReturnInput {
    /// `SALE_RETURN` | `PURCHASE_RETURN`
    pub return_type: String,
    #[serde(default)]
    pub reference_id: Option<String>,
    #[serde(default)]
    pub return_date: Option<String>,
    #[serde(default)]
    pub refund: f64,
    #[serde(default)]
    pub note: Option<String>,
    pub items: Vec<ReturnLine>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReturnLine {
    pub ram_item_id: String,
    pub quantity: i64,
    #[serde(default)]
    pub unit_price: Option<f64>,
}

// ============================================================== payments ===

pub const PAY_RECEIVE_BUYER: &str = "RECEIVE_FROM_BUYER";
pub const PAY_PAY_SELLER: &str = "PAY_SELLER";
pub const PAY_COWORKER_LEND: &str = "COWORKER_LEND";
pub const PAY_COWORKER_RECEIVE: &str = "COWORKER_RECEIVE";
pub const PAY_COWORKER_BORROW: &str = "COWORKER_BORROW";
pub const PAY_COWORKER_REPAY: &str = "COWORKER_REPAY";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: String,
    pub payment_id: String,
    pub payment_type: String,
    pub person_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person_id: Option<String>,
    pub person_name: String,
    pub amount: f64,
    pub payment_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub payment_date: String,
    /// Set when the payment has been reversed; reversed rows stay for audit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voided_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub void_reason: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    /// One of the `PAY_*` constants.
    pub payment_type: String,
    #[serde(default)]
    pub person_id: Option<String>,
    #[serde(default)]
    pub person_name: Option<String>,
    pub amount: f64,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub reference: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub payment_date: Option<String>,
    /// Permit paying more than the outstanding balance (advance payment).
    #[serde(default)]
    pub allow_overpayment: bool,
}

// ============================================================= coworkers ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Coworker {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    /// >0 they owe us, <0 we owe them.
    pub current_balance: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub is_archived: bool,
    pub total_lent: f64,
    pub total_borrowed: f64,
    pub total_repaid: f64,
    pub transaction_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoworkerTransaction {
    pub id: String,
    pub coworker_id: String,
    pub coworker_name: String,
    /// `LEND` | `BORROW` | `REPAYMENT`
    pub kind: String,
    pub amount: f64,
    pub balance_after: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub txn_date: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoworkerInput {
    /// Coworker id, or a name when creating on the fly.
    #[serde(default)]
    pub coworker_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    /// `LEND` | `BORROW` | `REPAYMENT`
    pub kind: String,
    pub amount: f64,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub txn_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoworkerTotals {
    /// Total owed to us across all coworkers.
    pub receivable: f64,
    /// Total we owe across all coworkers.
    pub payable: f64,
    pub net: f64,
    pub coworker_count: i64,
    pub transaction_count: i64,
}

// ================================================================= stock ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StockMovement {
    pub id: String,
    pub ram_item_id: String,
    pub sku: String,
    pub quantity_change: i64,
    pub previous_stock: i64,
    pub new_stock: i64,
    pub movement_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InventoryAdjustment {
    pub id: String,
    pub ram_item_id: String,
    pub sku: String,
    /// `INCREASE` | `DECREASE`
    pub adjustment_type: String,
    pub quantity: i64,
    pub previous_stock: i64,
    pub new_stock: i64,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdjustmentInput {
    pub ram_item_id: String,
    /// `INCREASE` | `DECREASE`
    pub adjustment_type: String,
    pub quantity: i64,
    pub reason: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub action: String,
    pub entity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: String,
}

// ============================================================= dashboard ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStats {
    pub total_stock: i64,
    pub total_skus: i64,
    pub total_inventory_cost: f64,
    pub estimated_sales_value: f64,
    pub potential_profit: f64,
    pub today_sales: f64,
    pub today_purchases: f64,
    pub today_profit: f64,
    pub today_sale_count: i64,
    pub today_purchase_count: i64,
    pub buyer_receivable: f64,
    pub seller_payable: f64,
    pub coworker_receivable: f64,
    pub coworker_payable: f64,
    pub low_stock_count: i64,
    pub out_of_stock_count: i64,
    pub buyer_count: i64,
    pub seller_count: i64,
    pub month_sales: f64,
    pub month_profit: f64,
    pub month_purchases: f64,
    pub average_margin: f64,
    pub inventory_by_generation: Vec<Slice>,
    pub inventory_by_category: Vec<Slice>,
    pub low_stock_items: Vec<RamItem>,
    pub recent_purchases: Vec<Purchase>,
    pub recent_sales: Vec<Sale>,
    pub recent_payments: Vec<Payment>,
    pub recent_movements: Vec<StockMovement>,
    pub top_buyers: Vec<NameValueRow>,
    pub top_sellers: Vec<NameValueRow>,
}

/// A labelled slice used by the donut charts.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Slice {
    pub label: String,
    pub value: f64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NameValueRow {
    pub label: String,
    pub value: f64,
    pub count: i64,
}

// =============================================================== reports ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReportFilter {
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
    #[serde(default)]
    pub generation: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub capacity: Option<String>,
    #[serde(default)]
    pub speed: Option<String>,
    #[serde(default)]
    pub manufacturer: Option<String>,
    #[serde(default)]
    pub party_id: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub payment_type: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

impl ReportFilter {
    /// Treats the "any" sentinel as "no filter".
    pub fn clean(&self) -> ReportFilter {
        let f = |v: &Option<String>| {
            v.as_ref()
                .filter(|s| !s.is_empty() && *s != "all" && *s != "ALL")
                .cloned()
        };
        ReportFilter {
            from: self.from.trim().to_string(),
            to: self.to.trim().to_string(),
            generation: f(&self.generation),
            category: f(&self.category),
            capacity: f(&self.capacity),
            speed: f(&self.speed),
            manufacturer: f(&self.manufacturer),
            party_id: f(&self.party_id),
            location: f(&self.location),
            payment_type: f(&self.payment_type),
            method: f(&self.method),
            status: f(&self.status),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReport {
    pub rows: Vec<InventoryReportRow>,
    pub total_skus: i64,
    pub total_units: i64,
    pub total_cost_value: f64,
    pub total_retail_value: f64,
    pub expected_profit: f64,
    pub low_stock_count: i64,
    pub out_of_stock_count: i64,
    pub dead_stock_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReportRow {
    pub sku: String,
    pub generation: String,
    pub category: String,
    pub capacity: String,
    pub speed: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    pub quantity: i64,
    pub minimum_stock: i64,
    pub average_cost: f64,
    pub selling_price: f64,
    pub cost_value: f64,
    pub retail_value: f64,
    pub stock_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseReport {
    pub rows: Vec<Purchase>,
    pub total_documents: i64,
    pub total_units: i64,
    pub subtotal: f64,
    pub discount: f64,
    pub total: f64,
    pub paid: f64,
    pub balance: f64,
    pub voided: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SalesReport {
    pub rows: Vec<Sale>,
    pub total_documents: i64,
    pub total_units: i64,
    pub subtotal: f64,
    pub discount: f64,
    pub total: f64,
    pub received: f64,
    pub outstanding: f64,
    pub total_cost: f64,
    pub gross_profit: f64,
    pub average_margin: f64,
    pub voided: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfitReport {
    pub rows: Vec<ProfitRow>,
    pub sales_total: f64,
    pub sales_cost: f64,
    pub gross_profit: f64,
    pub purchases_total: f64,
    pub net_cash_flow: f64,
    pub average_margin: f64,
    pub best_day: String,
    pub best_day_profit: f64,
    pub profit_by_generation: Vec<Slice>,
    pub profit_by_category: Vec<Slice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfitRow {
    pub period: String,
    pub sales_total: f64,
    pub sales_cost: f64,
    pub gross_profit: f64,
    pub margin: f64,
    pub units_sold: i64,
    pub transactions: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartyBalanceReport {
    pub rows: Vec<Party>,
    pub total_outstanding: f64,
    pub total_billed: f64,
    pub total_paid: f64,
    pub party_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PaymentReport {
    pub rows: Vec<Payment>,
    pub total_received: f64,
    pub total_paid: f64,
    pub net: f64,
    pub payment_count: i64,
    pub by_method: Vec<Slice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoworkerReport {
    pub rows: Vec<Coworker>,
    pub transactions: Vec<CoworkerTransaction>,
    pub receivable: f64,
    pub payable: f64,
    pub net: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StockMovementReport {
    pub rows: Vec<StockMovement>,
    pub total_in: i64,
    pub total_out: i64,
    pub net_change: i64,
    pub movement_count: i64,
    pub by_type: Vec<Slice>,
}

/// Free-text row used by the statement view.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatementLine {
    pub date: String,
    pub reference: String,
    pub description: String,
    pub debit: f64,
    pub credit: f64,
    pub balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub party_id: String,
    pub party_name: String,
    pub code: String,
    pub opening_balance: f64,
    pub total_debit: f64,
    pub total_credit: f64,
    pub closing_balance: f64,
    pub lines: Vec<StatementLine>,
}

// =========================================================== backup/meta ===

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub database_path: String,
    pub backup_dir: String,
    pub last_backup: String,
    pub last_backup_path: String,
    pub auto_backup: bool,
    pub backup_interval_hours: i64,
    pub database_size_bytes: i64,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// `inventory` | `buyer` | `seller` | `purchase` | `sale` | `payment`
    pub kind: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub meta: String,
    /// In-app route to open on selection.
    pub route: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DemoSummary {
    pub buyers: i64,
    pub sellers: i64,
    pub ram_items: i64,
    pub purchases: i64,
    pub sales: i64,
    pub payments: i64,
    pub coworkers: i64,
}