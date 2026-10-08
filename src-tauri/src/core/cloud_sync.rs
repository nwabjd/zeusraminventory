//! Cloud mirror - the desktop's local cache of the authoritative cloud ledger.
//!
//! When the cloud layer is configured, the Supabase database owns finalized
//! sales, purchases, inventory quantities and the audit trail. This module is
//! what ZEUS uses to *render* that data on the device:
//!
//!   * [`apply`] applies a `CloudSyncSnapshot` atomically and idempotently.
//!     Inventory rows are mirrored into `ram_items` **by SKU** (the cloud row
//!     is authoritative and replaces the local figure, so a stale local stock
//!     count can never overwrite a newer cloud value); finalized documents /
//!     approvals / audit are cached into dedicated mirror tables that the local
//!     engine (`recompute`, reports, dashboard) never reads, so they cannot
//!     corrupt quantity/cost derivations on this device.
//!   * `list_cloud_sales` / `list_cloud_purchases` / `get_cloud_*` shape the
//!     mirrored documents into the same wire types the local engine returns,
//!     so the existing pages render identical, device-independent history.
//!   * watermarks are stored per dataset so pulls can resume incrementally.

use crate::error::{AppError, AppResult};
use crate::models::{Purchase, PurchaseItem, Sale, SaleItem};
use crate::util::{money, new_id, now};
use rusqlite::{Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

pub const WM_ITEMS: &str = "items";
pub const WM_APPROVALS: &str = "approvals";
pub const WM_SALES: &str = "sales";
pub const WM_PURCHASES: &str = "purchases";
pub const WM_AUDIT: &str = "audit";

/// Watermark default: nothing has ever been synced.
pub const EPOCH: &str = "1970-01-01T00:00:00.000Z";

// ============================================================= wire types ===

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudItemRow {
    pub sku: String,
    pub generation: String,
    pub category: String,
    pub capacity: String,
    #[serde(default)]
    pub capacity_gb: i64,
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
    #[serde(default)]
    pub module_count: i64,
    #[serde(default)]
    pub purchase_price: f64,
    #[serde(default)]
    pub selling_price: f64,
    #[serde(default)]
    pub average_cost: f64,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub minimum_stock: i64,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudSaleRow {
    pub id: String,
    #[serde(default)]
    pub approval_id: Option<String>,
    pub sale_number: String,
    pub buyer_name: String,
    pub sale_date: String,
    #[serde(default)]
    pub subtotal: f64,
    #[serde(default)]
    pub discount: f64,
    #[serde(default)]
    pub total: f64,
    #[serde(default)]
    pub received: f64,
    #[serde(default)]
    pub remaining: f64,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub total_cost: f64,
    #[serde(default)]
    pub gross_profit: f64,
    #[serde(default)]
    pub profit_margin: f64,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub requested_by: Option<String>,
    #[serde(default)]
    pub requested_by_email: String,
    #[serde(default)]
    pub decided_by_email: Option<String>,
    #[serde(default)]
    pub decided_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudSaleItemRow {
    #[serde(default)]
    pub id: Option<String>,
    pub cloud_sale_id: String,
    pub sku: String,
    #[serde(default)]
    pub generation: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub capacity: String,
    #[serde(default)]
    pub speed: String,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub selling_price: f64,
    #[serde(default)]
    pub cost_per_unit: f64,
    #[serde(default)]
    pub subtotal: f64,
    #[serde(default)]
    pub cost_total: f64,
    #[serde(default)]
    pub profit: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudPurchaseRow {
    pub id: String,
    #[serde(default)]
    pub approval_id: Option<String>,
    pub purchase_number: String,
    pub seller_name: String,
    pub purchase_date: String,
    #[serde(default)]
    pub subtotal: f64,
    #[serde(default)]
    pub discount: f64,
    #[serde(default)]
    pub total: f64,
    #[serde(default)]
    pub paid: f64,
    #[serde(default)]
    pub remaining: f64,
    #[serde(default)]
    pub payment_method: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub requested_by: Option<String>,
    #[serde(default)]
    pub requested_by_email: String,
    #[serde(default)]
    pub decided_by_email: Option<String>,
    #[serde(default)]
    pub decided_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudPurchaseItemRow {
    #[serde(default)]
    pub id: Option<String>,
    pub cloud_purchase_id: String,
    pub sku: String,
    #[serde(default)]
    pub generation: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub capacity: String,
    #[serde(default)]
    pub speed: String,
    #[serde(default)]
    pub quantity: i64,
    #[serde(default)]
    pub cost_per_unit: f64,
    #[serde(default)]
    pub subtotal: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudApprovalRow {
    pub id: String,
    pub kind: String,
    pub transaction_number: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub total_amount: f64,
    #[serde(default)]
    pub item_count: i64,
    #[serde(default)]
    pub unit_count: i64,
    #[serde(default)]
    pub party_name: String,
    #[serde(default)]
    pub requested_by: Option<String>,
    #[serde(default)]
    pub requested_by_email: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub lock_owner: Option<String>,
    #[serde(default)]
    pub locked_at: Option<String>,
    #[serde(default)]
    pub decided_by: Option<String>,
    #[serde(default)]
    pub decided_by_email: Option<String>,
    #[serde(default)]
    pub decided_at: Option<String>,
    #[serde(default)]
    pub rejection_reason: Option<String>,
    #[serde(default)]
    pub final_document_number: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudAuditRow {
    pub id: String,
    #[serde(default)]
    pub actor_id: Option<String>,
    #[serde(default)]
    pub actor_email: Option<String>,
    pub action: String,
    #[serde(default)]
    pub entity: String,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncSnapshot {
    #[serde(default)]
    pub items: Vec<CloudItemRow>,
    #[serde(default)]
    pub sales: Vec<CloudSaleRow>,
    #[serde(default)]
    pub sale_items: Vec<CloudSaleItemRow>,
    #[serde(default)]
    pub purchases: Vec<CloudPurchaseRow>,
    #[serde(default)]
    pub purchase_items: Vec<CloudPurchaseItemRow>,
    #[serde(default)]
    pub approvals: Vec<CloudApprovalRow>,
    #[serde(default)]
    pub audit: Vec<CloudAuditRow>,
    /// New watermark per dataset the client computed from what it pulled.
    #[serde(default)]
    pub watermarks: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncApplyResult {
    pub items: usize,
    pub sales: usize,
    pub purchases: usize,
    pub approvals: usize,
    pub audit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncWatermark {
    pub key: String,
    pub watermark: String,
}

/// Read-shape of the cached approval (snake_case to match the Supabase wire
/// shape the rest of the UI already consumes).
#[derive(Debug, Clone, Serialize)]
pub struct CachedApproval {
    pub id: String,
    pub kind: String,
    pub transaction_number: String,
    pub payload: serde_json::Value,
    pub total_amount: f64,
    pub item_count: i64,
    pub unit_count: i64,
    pub party_name: String,
    pub requested_by: Option<String>,
    pub requested_by_email: String,
    pub status: String,
    pub lock_owner: Option<String>,
    pub locked_at: Option<String>,
    pub decided_by: Option<String>,
    pub decided_by_email: Option<String>,
    pub decided_at: Option<String>,
    pub rejection_reason: Option<String>,
    pub final_document_number: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Read-shape of the cached audit row (snake_case, matching `CloudAuditEntry`).
#[derive(Debug, Clone, Serialize)]
pub struct CachedAuditRow {
    pub id: String,
    pub actor_id: Option<String>,
    pub actor_email: Option<String>,
    pub action: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: String,
}

/// Filters for mirror-backed document lists. Deliberately the same fields the
/// local `list_sales` / `list_purchases` accept so the API layer only picks a
/// different command, not a different contract.
#[derive(Debug, Clone, Default)]
pub struct CloudDocFilter {
    pub search: String,
    pub status: Option<String>,
    pub method: Option<String>,
    pub from: String,
    pub to: String,
    pub generation: Option<String>,
    pub category: Option<String>,
    pub capacity: Option<String>,
    pub speed: Option<String>,
    pub limit: Option<i64>,
}

// ============================================================== watermarks ==

pub fn get_watermarks(conn: &Connection) -> AppResult<Vec<SyncWatermark>> {
    let mut stmt = conn.prepare("SELECT key, watermark FROM cloud_sync_state")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut map: std::collections::HashMap<String, String> = rows.into_iter().collect();
    for key in [WM_ITEMS, WM_APPROVALS, WM_SALES, WM_PURCHASES, WM_AUDIT] {
        map.entry(key.to_string()).or_insert_with(|| EPOCH.to_string());
    }
    let mut out: Vec<SyncWatermark> = map
        .into_iter()
        .map(|(key, watermark)| SyncWatermark { key, watermark })
        .collect();
    out.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(out)
}

fn set_watermark(tx: &Transaction, key: &str, watermark: &str) -> AppResult<()> {
    tx.execute(
        "INSERT INTO cloud_sync_state (key, watermark, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET watermark = excluded.watermark, updated_at = excluded.updated_at",
        rusqlite::params![key, watermark, now()],
    )?;
    Ok(())
}

// =================================================================== apply ==

/// Applies a snapshot to the local cache in one transaction. Idempotent:
/// applying the same snapshot twice has no additional effect (rows are
/// upserted by their stable cloud identity, so no duplicates can accumulate).
pub fn apply(conn: &mut Connection, snapshot: &CloudSyncSnapshot) -> AppResult<SyncApplyResult> {
    let tx = conn.transaction()?;
    let mut result = SyncApplyResult::default();

    for item in &snapshot.items {
        if item.sku.trim().is_empty() {
            continue;
        }
        if item.quantity < 0 {
            continue; // defensive: the cloud check constraint already blocks it
        }
        upsert_item(&tx, item)?;
        result.items += 1;
    }

    // Sale items must land after their parent rows (the snapshot is built in
    // that order by the sync provider, parent then children).
    for s in &snapshot.sales {
        upsert_cloud_sale(&tx, s)?;
        result.sales += 1;
    }
    for si in &snapshot.sale_items {
        upsert_cloud_sale_item(&tx, si)?;
    }

    for p in &snapshot.purchases {
        upsert_cloud_purchase(&tx, p)?;
        result.purchases += 1;
    }
    for pi in &snapshot.purchase_items {
        upsert_cloud_purchase_item(&tx, pi)?;
    }

    for a in &snapshot.approvals {
        upsert_cloud_approval(&tx, a)?;
        result.approvals += 1;
    }

    for e in &snapshot.audit {
        upsert_cloud_audit(&tx, e)?;
        result.audit += 1;
    }

    for (key, watermark) in &snapshot.watermarks {
        if watermark.trim().is_empty() || watermark == EPOCH {
            continue; // never move a watermark backwards / to the epoch
        }
        set_watermark(&tx, key, watermark)?;
    }

    tx.commit()?;
    Ok(result)
}

/// Mirrors the authoritative inventory row into `ram_items` by SKU. Existing
/// rows are overwritten with the cloud figure (cloud wins - see §12 conflict
/// handling); unknown SKUs are inserted. Returns `true` when the row was
/// created or its quantity changed, so callers can record a movement.
fn upsert_item(tx: &Transaction, r: &CloudItemRow) -> AppResult<bool> {
    let unow = now();
    let created = r.created_at.as_deref().unwrap_or(&unow);
    let updated = r.updated_at.as_deref().unwrap_or(&unow);
    let sku = r.sku.trim();
    let ecc = if r.ecc { 1 } else { 0 };
    let registered = if r.registered { 1 } else { 0 };
    let archived = if r.is_archived { 1 } else { 0 };

    let prev: Option<(String, i64)> = tx
        .query_row(
            "SELECT id, quantity FROM ram_items WHERE sku = ?1",
            [sku],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;

    if let Some((id, prev_qty)) = prev {
        if prev_qty != r.quantity {
            let change = r.quantity - prev_qty;
            let movement_type = if change >= 0 { "ADJUSTMENT_IN" } else { "ADJUSTMENT_OUT" };
            super::stock::record_movement(
                tx,
                &id,
                sku,
                change,
                prev_qty,
                r.quantity,
                movement_type,
                Some("CLOUD_SYNC"),
                None,
                None,
                Some("Synced from the cloud ledger"),
            )?;
        }
        tx.execute(
            "UPDATE ram_items
                SET generation = ?1, category = ?2, capacity = ?3, capacity_gb = ?4,
                    speed = ?5, ram_type = ?6, manufacturer = ?7, model = ?8,
                    part_number = ?9, condition = ?10, ecc = ?11, registered = ?12,
                    rank = ?13, module_count = ?14, purchase_price = ?15,
                    average_cost = ?16, selling_price = ?17, quantity = ?18,
                    minimum_stock = ?19, location = ?20, notes = ?21,
                    is_archived = ?22, updated_at = ?23
              WHERE sku = ?24",
            rusqlite::params![
                r.generation,
                r.category,
                r.capacity,
                r.capacity_gb,
                r.speed,
                r.ram_type,
                r.manufacturer,
                r.model,
                r.part_number,
                r.condition,
                ecc,
                registered,
                r.rank,
                r.module_count,
                money(r.purchase_price),
                money(r.average_cost),
                money(r.selling_price),
                r.quantity,
                r.minimum_stock,
                r.location,
                r.notes,
                archived,
                updated,
                sku,
            ],
        )?;
        Ok(prev_qty != r.quantity)
    } else {
        let id = new_id();
        tx.execute(
            "INSERT INTO ram_items
               (id, sku, generation, category, capacity, capacity_gb, speed, ram_type,
                manufacturer, model, part_number, condition, ecc, registered, rank,
                module_count, purchase_price, average_cost, selling_price, quantity,
                minimum_stock, location, notes, is_archived, created_at, updated_at)
             VALUES
               (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26)",
            rusqlite::params![
                id,
                sku,
                r.generation,
                r.category,
                r.capacity,
                r.capacity_gb,
                r.speed,
                r.ram_type,
                r.manufacturer,
                r.model,
                r.part_number,
                r.condition,
                ecc,
                registered,
                r.rank,
                r.module_count,
                money(r.purchase_price),
                money(r.average_cost),
                money(r.selling_price),
                r.quantity,
                r.minimum_stock,
                r.location,
                r.notes,
                archived,
                created,
                updated,
            ],
        )?;
        Ok(true)
    }
}

fn upsert_cloud_sale(tx: &Transaction, s: &CloudSaleRow) -> AppResult<()> {
    // Children first, so foreign keys never see a half-removed parent.
    tx.execute("DELETE FROM cloud_sale_items WHERE cloud_sale_id = ?1", [&s.id])?;
    tx.execute(
        "INSERT INTO cloud_sales
           (id, approval_id, sale_number, buyer_name, sale_date, subtotal, discount,
            total, received, remaining, payment_method, total_cost, gross_profit,
            profit_margin, notes, requested_by, requested_by_email, decided_by_email,
            decided_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21)
         ON CONFLICT (id) DO UPDATE SET
            approval_id = excluded.approval_id, sale_number = excluded.sale_number,
            buyer_name = excluded.buyer_name, sale_date = excluded.sale_date,
            subtotal = excluded.subtotal, discount = excluded.discount,
            total = excluded.total, received = excluded.received,
            remaining = excluded.remaining, payment_method = excluded.payment_method,
            total_cost = excluded.total_cost, gross_profit = excluded.gross_profit,
            profit_margin = excluded.profit_margin, notes = excluded.notes,
            requested_by = excluded.requested_by,
            requested_by_email = excluded.requested_by_email,
            decided_by_email = excluded.decided_by_email,
            decided_at = excluded.decided_at, updated_at = excluded.updated_at",
        rusqlite::params![
            s.id,
            s.approval_id,
            s.sale_number,
            s.buyer_name,
            s.sale_date,
            money(s.subtotal),
            money(s.discount),
            money(s.total),
            money(s.received),
            money(s.remaining),
            s.payment_method,
            money(s.total_cost),
            money(s.gross_profit),
            money(s.profit_margin),
            s.notes,
            s.requested_by,
            s.requested_by_email,
            s.decided_by_email,
            s.decided_at,
            s.created_at.as_deref().unwrap_or(&now()),
            s.updated_at.as_deref().unwrap_or(&now()),
        ],
    )?;
    Ok(())
}

fn upsert_cloud_sale_item(tx: &Transaction, i: &CloudSaleItemRow) -> AppResult<()> {
    let row_id = i.id.clone().unwrap_or_else(new_id);
    tx.execute(
        "INSERT INTO cloud_sale_items
           (id, cloud_sale_id, sku, generation, category, capacity, speed, quantity,
            selling_price, cost_per_unit, subtotal, cost_total, profit)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT (id) DO UPDATE SET
            cloud_sale_id = excluded.cloud_sale_id, sku = excluded.sku,
            generation = excluded.generation, category = excluded.category,
            capacity = excluded.capacity, speed = excluded.speed,
            quantity = excluded.quantity, selling_price = excluded.selling_price,
            cost_per_unit = excluded.cost_per_unit, subtotal = excluded.subtotal,
            cost_total = excluded.cost_total, profit = excluded.profit",
        rusqlite::params![
            row_id,
            i.cloud_sale_id,
            i.sku,
            i.generation,
            i.category,
            i.capacity,
            i.speed,
            i.quantity,
            money(i.selling_price),
            money(i.cost_per_unit),
            money(i.subtotal),
            money(i.cost_total),
            money(i.profit),
        ],
    )?;
    Ok(())
}

fn upsert_cloud_purchase(tx: &Transaction, p: &CloudPurchaseRow) -> AppResult<()> {
    tx.execute(
        "DELETE FROM cloud_purchase_items WHERE cloud_purchase_id = ?1",
        [&p.id],
    )?;
    tx.execute(
        "INSERT INTO cloud_purchases
           (id, approval_id, purchase_number, seller_name, purchase_date, subtotal,
            discount, total, paid, remaining, payment_method, notes, requested_by,
            requested_by_email, decided_by_email, decided_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18)
         ON CONFLICT (id) DO UPDATE SET
            approval_id = excluded.approval_id,
            purchase_number = excluded.purchase_number,
            seller_name = excluded.seller_name,
            purchase_date = excluded.purchase_date,
            subtotal = excluded.subtotal, discount = excluded.discount,
            total = excluded.total, paid = excluded.paid,
            remaining = excluded.remaining, payment_method = excluded.payment_method,
            notes = excluded.notes, requested_by = excluded.requested_by,
            requested_by_email = excluded.requested_by_email,
            decided_by_email = excluded.decided_by_email,
            decided_at = excluded.decided_at, updated_at = excluded.updated_at",
        rusqlite::params![
            p.id,
            p.approval_id,
            p.purchase_number,
            p.seller_name,
            p.purchase_date,
            money(p.subtotal),
            money(p.discount),
            money(p.total),
            money(p.paid),
            money(p.remaining),
            p.payment_method,
            p.notes,
            p.requested_by,
            p.requested_by_email,
            p.decided_by_email,
            p.decided_at,
            p.created_at.as_deref().unwrap_or(&now()),
            p.updated_at.as_deref().unwrap_or(&now()),
        ],
    )?;
    Ok(())
}

fn upsert_cloud_purchase_item(tx: &Transaction, i: &CloudPurchaseItemRow) -> AppResult<()> {
    let row_id = i.id.clone().unwrap_or_else(new_id);
    tx.execute(
        "INSERT INTO cloud_purchase_items
           (id, cloud_purchase_id, sku, generation, category, capacity, speed,
            quantity, cost_per_unit, subtotal)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT (id) DO UPDATE SET
            cloud_purchase_id = excluded.cloud_purchase_id, sku = excluded.sku,
            generation = excluded.generation, category = excluded.category,
            capacity = excluded.capacity, speed = excluded.speed,
            quantity = excluded.quantity, cost_per_unit = excluded.cost_per_unit,
            subtotal = excluded.subtotal",
        rusqlite::params![
            row_id,
            i.cloud_purchase_id,
            i.sku,
            i.generation,
            i.category,
            i.capacity,
            i.speed,
            i.quantity,
            money(i.cost_per_unit),
            money(i.subtotal),
        ],
    )?;
    Ok(())
}

fn upsert_cloud_approval(tx: &Transaction, a: &CloudApprovalRow) -> AppResult<()> {
    tx.execute(
        "INSERT INTO cloud_approvals
           (id, kind, transaction_number, payload, total_amount, item_count,
            unit_count, party_name, requested_by, requested_by_email, status,
            lock_owner, locked_at, decided_by, decided_by_email, decided_at,
            rejection_reason, final_document_number, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18, ?19, ?20)
         ON CONFLICT (id) DO UPDATE SET
            kind = excluded.kind, transaction_number = excluded.transaction_number,
            payload = excluded.payload, total_amount = excluded.total_amount,
            item_count = excluded.item_count, unit_count = excluded.unit_count,
            party_name = excluded.party_name, requested_by = excluded.requested_by,
            requested_by_email = excluded.requested_by_email,
            status = excluded.status, lock_owner = excluded.lock_owner,
            locked_at = excluded.locked_at, decided_by = excluded.decided_by,
            decided_by_email = excluded.decided_by_email,
            decided_at = excluded.decided_at,
            rejection_reason = excluded.rejection_reason,
            final_document_number = excluded.final_document_number,
            updated_at = excluded.updated_at",
        rusqlite::params![
            a.id,
            a.kind,
            a.transaction_number,
            a.payload.to_string(),
            money(a.total_amount),
            a.item_count,
            a.unit_count,
            a.party_name,
            a.requested_by,
            a.requested_by_email,
            a.status,
            a.lock_owner,
            a.locked_at,
            a.decided_by,
            a.decided_by_email,
            a.decided_at,
            a.rejection_reason,
            a.final_document_number,
            a.created_at,
            a.updated_at,
        ],
    )?;
    Ok(())
}

fn upsert_cloud_audit(tx: &Transaction, e: &CloudAuditRow) -> AppResult<()> {
    let metadata = e.metadata.as_ref().map(|m| m.to_string());
    tx.execute(
        "INSERT INTO cloud_audit
           (id, actor_id, actor_email, action, entity, entity_id, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (id) DO UPDATE SET
            actor_id = excluded.actor_id, actor_email = excluded.actor_email,
            action = excluded.action, entity = excluded.entity,
            entity_id = excluded.entity_id, metadata = excluded.metadata,
            created_at = excluded.created_at",
        rusqlite::params![
            e.id,
            e.actor_id,
            e.actor_email,
            e.action,
            e.entity,
            e.entity_id,
            metadata,
            e.created_at,
        ],
    )?;
    Ok(())
}

// ======================================================== mirror reads ======

const SALE_COLS: &str = "id, approval_id, sale_number, buyer_name, sale_date, subtotal,
     discount, total, received, remaining, payment_method, total_cost, gross_profit,
     profit_margin, notes, requested_by, requested_by_email, decided_by_email,
     decided_at, created_at, updated_at";

const PURCHASE_COLS: &str = "id, approval_id, purchase_number, seller_name, purchase_date,
     subtotal, discount, total, paid, remaining, payment_method, notes, requested_by,
     requested_by_email, decided_by_email, decided_at, created_at, updated_at";

fn local_item_id(conn: &Connection, sku: &str) -> String {
    conn.query_row("SELECT id FROM ram_items WHERE sku = ?1", [sku], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn map_cloud_sale(conn: &Connection, r: &rusqlite::Row<'_>) -> AppResult<Sale> {
    let id: String = r.get(0)?;
    let approval_id: Option<String> = r.get(1)?;
    let sale_number: String = r.get(2)?;
    let buyer_name: String = r.get(3)?;
    let sale_date: String = r.get(4)?;
    let subtotal: f64 = r.get(5)?;
    let discount: f64 = r.get(6)?;
    let total: f64 = r.get(7)?;
    let received: f64 = r.get(8)?;
    let remaining: f64 = r.get(9)?;
    let payment_method: Option<String> = r.get(10)?;
    let total_cost: f64 = r.get(11)?;
    let gross_profit: f64 = r.get(12)?;
    let profit_margin: f64 = r.get(13)?;
    let notes: Option<String> = r.get(14)?;
    let _requested_by: Option<String> = r.get(15)?;
    let requested_by_email: String = r.get(16)?;
    let decided_by_email: Option<String> = r.get(17)?;
    let decided_at: Option<String> = r.get(18)?;
    let created_at: String = r.get(19)?;
    let updated_at: String = r.get(20)?;

    let mut items = Vec::new();
    let mut unit_count: i64 = 0;
    let mut stmt = conn.prepare(
        "SELECT id, cloud_sale_id, sku, generation, category, capacity, speed, quantity,
                selling_price, cost_per_unit, subtotal, cost_total, profit
           FROM cloud_sale_items WHERE cloud_sale_id = ?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map([&id], |i| {
        Ok((
            i.get::<_, String>(0)?,
            i.get::<_, String>(2)?,
            i.get::<_, String>(3)?,
            i.get::<_, String>(4)?,
            i.get::<_, String>(5)?,
            i.get::<_, String>(6)?,
            i.get::<_, i64>(7)?,
            i.get::<_, f64>(8)?,
            i.get::<_, f64>(9)?,
            i.get::<_, f64>(10)?,
            i.get::<_, f64>(11)?,
            i.get::<_, f64>(12)?,
        ))
    })?;
    for item in rows {
        let (iid, sku, gen, cat, cap, spd, qty, price, cost, subt, ctotal, profit) = item?;
        items.push(SaleItem {
            id: iid,
            sale_id: id.clone(),
            ram_item_id: local_item_id(conn, &sku),
            sku,
            generation: gen,
            category: cat,
            capacity: cap,
            speed: spd,
            quantity: qty,
            selling_price: money(price),
            cost_per_unit: money(cost),
            subtotal: money(subt),
            cost_total: money(ctotal),
            profit: money(profit),
        });
        unit_count += qty;
    }
    drop(stmt);

    Ok(Sale {
        id,
        sale_number,
        buyer_id: None,
        buyer_name,
        sale_date,
        subtotal: money(subtotal),
        discount: money(discount),
        total: money(total),
        received: money(received),
        remaining: money(remaining),
        payment_method,
        total_cost: money(total_cost),
        gross_profit: money(gross_profit),
        profit_margin: money(profit_margin),
        notes,
        status: "completed".to_string(),
        voided_at: None,
        void_reason: None,
        item_count: items.len() as i64,
        unit_count,
        items,
        created_at,
        updated_at,
        // The approval id travels over the wire so the UI marks cloud docs and
        // links back to the approval. Optional: absent for legacy rows.
        cloud_approval_id: approval_id.filter(|s| !s.is_empty()),
        requested_by_email: Some(requested_by_email),
        decided_by_email,
        decided_at,
    })
}

pub fn get_cloud_sale(conn: &Connection, id: &str) -> AppResult<Sale> {
    let mut stmt = conn.prepare(&format!("SELECT {SALE_COLS} FROM cloud_sales WHERE id = ?1"))?;
    let mut rows = stmt.query([id])?;
    if let Some(row) = rows.next()? {
        return map_cloud_sale(conn, &row);
    }
    Err(AppError::not_found(format!("Sale {id} not found.")))
}

pub fn list_cloud_sales(conn: &Connection, f: &CloudDocFilter) -> AppResult<Vec<Sale>> {
    let mut where_parts: Vec<String> = Vec::new();
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    macro_rules! push {
        ($cond:expr, $val:expr) => {{
            args.push($val);
            where_parts.push($cond.replace('@', &format!("?{}", args.len())));
        }};
    }
    macro_rules! any {
        ($v:expr) => {
            $v.as_ref().is_some_and(|s| !s.is_empty() && s != "all")
        };
    }

    let q = f.search.trim();
    if !q.is_empty() {
        push!(
            "(UPPER(sale_number) LIKE @ OR UPPER(buyer_name) LIKE @
              OR COALESCE(payment_method,'') LIKE @ OR COALESCE(notes,'') LIKE @)",
            rusqlite::types::Value::Text(format!("%{q}%"))
        );
    }
    // Cloud documents are immutable: status filter 'void' matches nothing.
    if any!(&f.status) && f.status.as_deref() == Some("void") {
        return Ok(vec![]);
    }
    if any!(&f.method) {
        push!(
            "payment_method = @",
            rusqlite::types::Value::Text(f.method.clone().unwrap())
        );
    }
    if !f.from.is_empty() {
        push!(
            "sale_date >= @",
            rusqlite::types::Value::Text(f.from.clone())
        );
    }
    if !f.to.is_empty() {
        push!(
            "sale_date <= @",
            rusqlite::types::Value::Text(f.to.clone())
        );
    }
    if any!(&f.generation)
        || any!(&f.category)
        || any!(&f.capacity)
        || any!(&f.speed)
    {
        let first = args.len();
        for value in [
            f.generation.clone().unwrap_or_default(),
            f.category.clone().unwrap_or_default(),
            f.capacity.clone().unwrap_or_default(),
            f.speed.clone().unwrap_or_default(),
        ] {
            args.push(rusqlite::types::Value::Text(value));
        }
        let (g, c, cap, sp) = (first + 1, first + 2, first + 3, first + 4);
        where_parts.push(format!(
            "id IN (SELECT i.cloud_sale_id FROM cloud_sale_items i
                     WHERE (@{g} = '' OR i.generation = @{g})
                       AND (@{c} = '' OR i.category = @{c})
                       AND (@{cap} = '' OR i.capacity = @{cap})
                       AND (@{sp} = '' OR i.speed = @{sp}))"
        ));
    }

    let mut sql = format!("SELECT {SALE_COLS} FROM cloud_sales");
    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }
    sql.push_str(" ORDER BY sale_date DESC, created_at DESC, rowid DESC");
    if let Some(l) = f.limit {
        sql.push_str(&format!(" LIMIT {l}"));
    }

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(args.iter()))?;
    let mut sales = Vec::new();
    while let Some(row) = rows.next()? {
        sales.push(map_cloud_sale(conn, &row)?);
    }
    Ok(sales)
}

fn map_cloud_purchase(conn: &Connection, r: &rusqlite::Row<'_>) -> AppResult<Purchase> {
    let id: String = r.get(0)?;
    let approval_id: Option<String> = r.get(1)?;
    let purchase_number: String = r.get(2)?;
    let seller_name: String = r.get(3)?;
    let purchase_date: String = r.get(4)?;
    let subtotal: f64 = r.get(5)?;
    let discount: f64 = r.get(6)?;
    let total: f64 = r.get(7)?;
    let paid: f64 = r.get(8)?;
    let remaining: f64 = r.get(9)?;
    let payment_method: Option<String> = r.get(10)?;
    let notes: Option<String> = r.get(11)?;
    let _requested_by: Option<String> = r.get(12)?;
    let requested_by_email: String = r.get(13)?;
    let decided_by_email: Option<String> = r.get(14)?;
    let decided_at: Option<String> = r.get(15)?;
    let created_at: String = r.get(16)?;
    let updated_at: String = r.get(17)?;

    let mut items = Vec::new();
    let mut unit_count: i64 = 0;
    let mut stmt = conn.prepare(
        "SELECT id, cloud_purchase_id, sku, generation, category, capacity, speed,
                quantity, cost_per_unit, subtotal
           FROM cloud_purchase_items WHERE cloud_purchase_id = ?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map([&id], |i| {
        Ok((
            i.get::<_, String>(0)?,
            i.get::<_, String>(2)?,
            i.get::<_, String>(3)?,
            i.get::<_, String>(4)?,
            i.get::<_, String>(5)?,
            i.get::<_, String>(6)?,
            i.get::<_, i64>(7)?,
            i.get::<_, f64>(8)?,
            i.get::<_, f64>(9)?,
        ))
    })?;
    for item in rows {
        let (iid, sku, gen, cat, cap, spd, qty, cost, subt) = item?;
        items.push(PurchaseItem {
            id: iid,
            purchase_id: id.clone(),
            ram_item_id: local_item_id(conn, &sku),
            sku,
            generation: gen,
            category: cat,
            capacity: cap,
            speed: spd,
            quantity: qty,
            cost_per_unit: money(cost),
            subtotal: money(subt),
        });
        unit_count += qty;
    }
    drop(stmt);

    Ok(Purchase {
        id,
        purchase_number,
        seller_id: None,
        seller_name,
        purchase_date,
        subtotal: money(subtotal),
        discount: money(discount),
        total: money(total),
        paid: money(paid),
        remaining: money(remaining),
        payment_method,
        notes,
        status: "completed".to_string(),
        voided_at: None,
        void_reason: None,
        item_count: items.len() as i64,
        unit_count,
        items,
        created_at,
        updated_at,
        cloud_approval_id: approval_id.filter(|s| !s.is_empty()),
        requested_by_email: Some(requested_by_email),
        decided_by_email,
        decided_at,
    })
}

pub fn get_cloud_purchase(conn: &Connection, id: &str) -> AppResult<Purchase> {
    let mut stmt = conn
        .prepare(&format!("SELECT {PURCHASE_COLS} FROM cloud_purchases WHERE id = ?1"))?;
    let mut rows = stmt.query([id])?;
    if let Some(row) = rows.next()? {
        return map_cloud_purchase(conn, &row);
    }
    Err(AppError::not_found(format!("Purchase {id} not found.")))
}

pub fn list_cloud_purchases(conn: &Connection, f: &CloudDocFilter) -> AppResult<Vec<Purchase>> {
    let mut where_parts: Vec<String> = Vec::new();
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    macro_rules! push {
        ($cond:expr, $val:expr) => {{
            args.push($val);
            where_parts.push($cond.replace('@', &format!("?{}", args.len())));
        }};
    }
    macro_rules! any {
        ($v:expr) => {
            $v.as_ref().is_some_and(|s| !s.is_empty() && s != "all")
        };
    }

    let q = f.search.trim();
    if !q.is_empty() {
        push!(
            "(UPPER(purchase_number) LIKE @ OR UPPER(seller_name) LIKE @
              OR COALESCE(payment_method,'') LIKE @ OR COALESCE(notes,'') LIKE @)",
            rusqlite::types::Value::Text(format!("%{q}%"))
        );
    }
    if any!(&f.status) && f.status.as_deref() == Some("void") {
        return Ok(vec![]);
    }
    if any!(&f.method) {
        push!(
            "payment_method = @",
            rusqlite::types::Value::Text(f.method.clone().unwrap())
        );
    }
    if !f.from.is_empty() {
        push!(
            "purchase_date >= @",
            rusqlite::types::Value::Text(f.from.clone())
        );
    }
    if !f.to.is_empty() {
        push!(
            "purchase_date <= @",
            rusqlite::types::Value::Text(f.to.clone())
        );
    }
    if any!(&f.generation)
        || any!(&f.category)
        || any!(&f.capacity)
        || any!(&f.speed)
    {
        let first = args.len();
        for value in [
            f.generation.clone().unwrap_or_default(),
            f.category.clone().unwrap_or_default(),
            f.capacity.clone().unwrap_or_default(),
            f.speed.clone().unwrap_or_default(),
        ] {
            args.push(rusqlite::types::Value::Text(value));
        }
        let (g, c, cap, sp) = (first + 1, first + 2, first + 3, first + 4);
        where_parts.push(format!(
            "id IN (SELECT i.cloud_purchase_id FROM cloud_purchase_items i
                     WHERE (@{g} = '' OR i.generation = @{g})
                       AND (@{c} = '' OR i.category = @{c})
                       AND (@{cap} = '' OR i.capacity = @{cap})
                       AND (@{sp} = '' OR i.speed = @{sp}))"
        ));
    }

    let mut sql = format!("SELECT {PURCHASE_COLS} FROM cloud_purchases");
    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }
    sql.push_str(" ORDER BY purchase_date DESC, created_at DESC, rowid DESC");
    if let Some(l) = f.limit {
        sql.push_str(&format!(" LIMIT {l}"));
    }

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(args.iter()))?;
    let mut purchases = Vec::new();
    while let Some(row) = rows.next()? {
        purchases.push(map_cloud_purchase(conn, &row)?);
    }
    Ok(purchases)
}

fn map_cloud_approval(r: &rusqlite::Row<'_>) -> rusqlite::Result<CachedApproval> {
    let payload: String = r.get(3)?;
    let payload_value = serde_json::from_str(&payload).unwrap_or_else(|_| serde_json::Value::Null);
    Ok(CachedApproval {
        id: r.get(0)?,
        kind: r.get(1)?,
        transaction_number: r.get(2)?,
        payload: payload_value,
        total_amount: r.get(4)?,
        item_count: r.get(5)?,
        unit_count: r.get(6)?,
        party_name: r.get(7)?,
        requested_by: r.get(8)?,
        requested_by_email: r.get(9)?,
        status: r.get(10)?,
        lock_owner: r.get(11)?,
        locked_at: r.get(12)?,
        decided_by: r.get(13)?,
        decided_by_email: r.get(14)?,
        decided_at: r.get(15)?,
        rejection_reason: r.get(16)?,
        final_document_number: r.get(17)?,
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
    })
}

pub fn list_cloud_approvals(conn: &Connection, status: Option<String>) -> AppResult<Vec<CachedApproval>> {
    let mut sql = String::from(
        "SELECT id, kind, transaction_number, payload, total_amount, item_count,
                unit_count, party_name, requested_by, requested_by_email, status,
                lock_owner, locked_at, decided_by, decided_by_email, decided_at,
                rejection_reason, final_document_number, created_at, updated_at
           FROM cloud_approvals",
    );
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    match status.as_deref() {
        Some(s) if !s.is_empty() && s != "all" => {
            args.push(rusqlite::types::Value::Text(s.to_string()));
            sql.push_str(" WHERE status = ?1");
        }
        _ => {}
    }
    sql.push_str(" ORDER BY created_at DESC, rowid DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_cloud_approval)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn map_cloud_audit(r: &rusqlite::Row<'_>) -> rusqlite::Result<CachedAuditRow> {
    let metadata: Option<String> = r.get(6)?;
    let metadata_value = metadata
        .and_then(|m| serde_json::from_str(&m).ok());
    Ok(CachedAuditRow {
        id: r.get(0)?,
        actor_id: r.get(1)?,
        actor_email: r.get(2)?,
        action: r.get(3)?,
        entity: r.get(4)?,
        entity_id: r.get(5)?,
        metadata: metadata_value,
        created_at: r.get(7)?,
    })
}

pub fn list_cloud_audit(conn: &Connection, limit: Option<i64>) -> AppResult<Vec<CachedAuditRow>> {
    let mut sql = String::from(
        "SELECT id, actor_id, actor_email, action, entity, entity_id, metadata, created_at
           FROM cloud_audit ORDER BY created_at DESC, rowid DESC",
    );
    if let Some(l) = limit {
        sql.push_str(&format!(" LIMIT {l}"));
    }
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_cloud_audit)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Drops every cached cloud document / approval / audit row and resets the
/// watermarks, so the next sync repulls everything. `ram_items` quantities are
/// deliberately left untouched - they are the mirrored inventory, not a cache.
pub fn clear(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(
        "DELETE FROM cloud_sale_items;
         DELETE FROM cloud_sales;
         DELETE FROM cloud_purchase_items;
         DELETE FROM cloud_purchases;
         DELETE FROM cloud_approvals;
         DELETE FROM cloud_audit;
         DELETE FROM cloud_sync_state;",
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::collections::HashMap;

    fn item(sku: &str, qty: i64, avg: f64) -> CloudItemRow {
        CloudItemRow {
            sku: sku.to_string(),
            generation: "DDR5".into(),
            category: "PC".into(),
            capacity: "16GB".into(),
            capacity_gb: 16,
            speed: "5600".into(),
            average_cost: avg,
            selling_price: 80.0,
            quantity: qty,
            ..Default::default()
        }
    }

    fn sale_row() -> CloudSaleRow {
        CloudSaleRow {
            id: "11111111-1111-4111-8111-111111111111".into(),
            approval_id: Some("aaaa1111-1111-4111-8111-111111111111".into()),
            sale_number: "CLDSLS-000001".into(),
            buyer_name: "Acme".into(),
            sale_date: "2026-10-01".into(),
            subtotal: 400.0,
            total: 400.0,
            received: 400.0,
            payment_method: Some("Cash".into()),
            gross_profit: 50.0,
            created_at: Some("2026-10-01T10:00:00Z".into()),
            updated_at: Some("2026-10-01T10:00:00Z".into()),
            ..Default::default()
        }
    }

    fn purchase_row() -> CloudPurchaseRow {
        CloudPurchaseRow {
            id: "22222222-2222-4222-8222-222222222222".into(),
            approval_id: Some("bbbb2222-2222-4222-8222-222222222222".into()),
            purchase_number: "CLDPUR-000001".into(),
            seller_name: "SuppCo".into(),
            purchase_date: "2026-10-02".into(),
            subtotal: 140.0,
            total: 140.0,
            paid: 140.0,
            payment_method: Some("Bank".into()),
            created_at: Some("2026-10-02T10:00:00Z".into()),
            updated_at: Some("2026-10-02T10:00:00Z".into()),
            ..Default::default()
        }
    }

    fn approval_row() -> CloudApprovalRow {
        CloudApprovalRow {
            id: "aaaa1111-1111-4111-8111-111111111111".into(),
            kind: "sale".into(),
            transaction_number: "SALRQ-000001".into(),
            status: "approved".into(),
            party_name: "Acme".into(),
            requested_by_email: "rep@zeus.local".into(),
            final_document_number: Some("CLDSLS-000001".into()),
            created_at: "2026-10-01T09:00:00Z".into(),
            updated_at: "2026-10-01T10:00:00Z".into(),
            ..Default::default()
        }
    }

    fn audit_row() -> CloudAuditRow {
        CloudAuditRow {
            id: "cccc3333-3333-4333-8333-333333333333".into(),
            actor_email: Some("admin@zeus.local".into()),
            action: "SALE_APPROVED".into(),
            entity: "transaction_approval".into(),
            created_at: "2026-10-01T10:00:00Z".into(),
            ..Default::default()
        }
    }

    fn rich_snapshot() -> CloudSyncSnapshot {
        CloudSyncSnapshot {
            items: vec![item("RAM-D5-16-5600", 10, 50.0)],
            sales: vec![sale_row()],
            sale_items: vec![CloudSaleItemRow {
                id: Some("dddd4444-4444-4444-8444-444444444444".into()),
                cloud_sale_id: "11111111-1111-4111-8111-111111111111".into(),
                sku: "RAM-D5-16-5600".into(),
                generation: "DDR5".into(),
                category: "PC".into(),
                quantity: 5,
                selling_price: 80.0,
                cost_per_unit: 50.0,
                subtotal: 400.0,
                cost_total: 250.0,
                profit: 150.0,
                ..Default::default()
            }],
            purchases: vec![purchase_row()],
            purchase_items: vec![CloudPurchaseItemRow {
                id: Some("eeee5555-5555-4555-8555-555555555555".into()),
                cloud_purchase_id: "22222222-2222-4222-8222-222222222222".into(),
                sku: "RAM-D5-16-5600".into(),
                generation: "DDR5".into(),
                category: "PC".into(),
                quantity: 2,
                cost_per_unit: 70.0,
                subtotal: 140.0,
                ..Default::default()
            }],
            approvals: vec![approval_row()],
            audit: vec![audit_row()],
            watermarks: HashMap::from([
                (WM_ITEMS.to_string(), "2026-10-01T10:00:00Z".to_string()),
                (WM_SALES.to_string(), "2026-10-01T10:00:00Z".to_string()),
                (WM_PURCHASES.to_string(), "2026-10-02T10:00:00Z".to_string()),
                (WM_APPROVALS.to_string(), "2026-10-01T10:00:00Z".to_string()),
                (WM_AUDIT.to_string(), "2026-10-01T10:00:00Z".to_string()),
            ]),
            ..Default::default()
        }
    }

    fn rows_in(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn apply_is_idempotent_and_mirrors_everything() {
        let mut conn = db::open_in_memory().unwrap();
        let snap = rich_snapshot();

        let first = apply(&mut conn, &snap).unwrap();
        assert_eq!(first.items, 1);
        assert_eq!(first.sales, 1);
        assert_eq!(first.purchases, 1);
        assert_eq!(first.approvals, 1);
        assert_eq!(first.audit, 1);

        // Quantity lands in the local engine table (authoritative mirror).
        let (qty, avg): (i64, f64) = conn
            .query_row("SELECT quantity, average_cost FROM ram_items WHERE sku = 'RAM-D5-16-5600'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(qty, 10);
        assert_eq!(avg, 50.0);

        // Mirror tables cached.
        assert_eq!(rows_in(&conn, "cloud_sales"), 1);
        assert_eq!(rows_in(&conn, "cloud_sale_items"), 1);
        assert_eq!(rows_in(&conn, "cloud_purchases"), 1);
        assert_eq!(rows_in(&conn, "cloud_purchase_items"), 1);
        assert_eq!(rows_in(&conn, "cloud_approvals"), 1);
        assert_eq!(rows_in(&conn, "cloud_audit"), 1);

        // Applying the same snapshot again changes nothing.
        let second = apply(&mut conn, &snap).unwrap();
        assert_eq!(second.items, 1);
        assert_eq!(rows_in(&conn, "cloud_sales"), 1);
        assert_eq!(rows_in(&conn, "cloud_sale_items"), 1);
        assert_eq!(rows_in(&conn, "cloud_purchases"), 1);
        assert_eq!(rows_in(&conn, "cloud_approvals"), 1);
        assert_eq!(rows_in(&conn, "cloud_audit"), 1);
        let (qty2, _): (i64, f64) = conn
            .query_row("SELECT quantity, average_cost FROM ram_items WHERE sku = 'RAM-D5-16-5600'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(qty2, 10);

        // Watermarks persisted.
        let wms = get_watermarks(&conn).unwrap();
        let items_wm = wms.iter().find(|w| w.key == WM_ITEMS).unwrap();
        assert_eq!(items_wm.watermark, "2026-10-01T10:00:00Z");
    }

    #[test]
    fn cloud_document_wins_over_stale_local_quantity() {
        let mut conn = db::open_in_memory().unwrap();
        // Local stale cache says 100 units.
        let snap_stale = CloudSyncSnapshot {
            items: vec![item("RAM-D5-16-5600", 100, 50.0)],
            ..Default::default()
        };
        apply(&mut conn, &snap_stale).unwrap();

        // Cloud approved a sale: authoritative quantity is now 90.
        let snap_cloud = CloudSyncSnapshot {
            items: vec![item("RAM-D5-16-5600", 90, 50.0)],
            ..Default::default()
        };
        apply(&mut conn, &snap_cloud).unwrap();

        let (qty,): (i64,) = conn
            .query_row("SELECT quantity FROM ram_items WHERE sku = 'RAM-D5-16-5600'", [], |r| Ok((r.get(0)?,)))
            .unwrap();
        assert_eq!(qty, 90); // never 100: the stale local value cannot overwrite cloud
    }

    #[test]
    fn mirrored_sales_and_purchases_shape_like_local_documents() {
        let mut conn = db::open_in_memory().unwrap();
        apply(&mut conn, &rich_snapshot()).unwrap();

        let sales = list_cloud_sales(&conn, &CloudDocFilter::default()).unwrap();
        assert_eq!(sales.len(), 1);
        assert_eq!(sales[0].sale_number, "CLDSLS-000001");
        assert_eq!(sales[0].status, "completed");
        assert_eq!(sales[0].item_count, 1);
        assert_eq!(sales[0].unit_count, 5);
        assert_eq!(sales[0].items[0].sku, "RAM-D5-16-5600");
        assert_eq!(sales[0].cloud_approval_id.as_deref(), Some("aaaa1111-1111-4111-8111-111111111111"));
        // ram_item_id resolves to the mirrored local item.
        assert!(!sales[0].items[0].ram_item_id.is_empty());

        let got = get_cloud_sale(&conn, &sales[0].id).unwrap();
        assert_eq!(got.sale_number, "CLDSLS-000001");

        let purchases = list_cloud_purchases(&conn, &CloudDocFilter::default()).unwrap();
        assert_eq!(purchases.len(), 1);
        assert_eq!(purchases[0].purchase_number, "CLDPUR-000001");
        assert_eq!(purchases[0].paid, 140.0);
        assert_eq!(purchases[0].unit_count, 2);

        // Search by party finds it.
        let filtered = list_cloud_sales(
            &conn,
            &CloudDocFilter { search: "acme".into(), ..Default::default() },
        )
        .unwrap();
        assert_eq!(filtered.len(), 1);

        // Void status filter is empty for immutable cloud documents.
        let void_only = list_cloud_sales(
            &conn,
            &CloudDocFilter { status: Some("void".into()), ..Default::default() },
        )
        .unwrap();
        assert!(void_only.is_empty());
    }

    #[test]
    fn approval_and_audit_caches_round_trip() {
        let mut conn = db::open_in_memory().unwrap();
        apply(&mut conn, &rich_snapshot()).unwrap();

        let approvals = list_cloud_approvals(&conn, None).unwrap();
        assert_eq!(approvals.len(), 1);
        assert_eq!(approvals[0].status, "approved");
        assert_eq!(approvals[0].transaction_number, "SALRQ-000001");

        let approved_only = list_cloud_approvals(&conn, Some("approved".into())).unwrap();
        assert_eq!(approved_only.len(), 1);
        let pending_only = list_cloud_approvals(&conn, Some("pending_approval".into())).unwrap();
        assert!(pending_only.is_empty());

        let audit = list_cloud_audit(&conn, None).unwrap();
        assert_eq!(audit.len(), 1);
        assert_eq!(audit[0].action, "SALE_APPROVED");
    }

    #[test]
    fn clear_resets_cache_not_inventory() {
        let mut conn = db::open_in_memory().unwrap();
        apply(&mut conn, &rich_snapshot()).unwrap();

        clear(&mut conn).unwrap();

        assert_eq!(rows_in(&conn, "cloud_sales"), 0);
        assert_eq!(rows_in(&conn, "cloud_approvals"), 0);
        assert_eq!(rows_in(&conn, "cloud_sync_state"), 0);
        // The inventory mirror survives: a cache reset must not wipe quantities.
        let (qty,): (i64,) = conn
            .query_row("SELECT quantity FROM ram_items WHERE sku = 'RAM-D5-16-5600'", [], |r| Ok((r.get(0)?,)))
            .unwrap();
        assert_eq!(qty, 10);
        // Watermarks fell back to the epoch so the next pull is a full re-sync.
        let wms = get_watermarks(&conn).unwrap();
        assert!(wms.iter().all(|w| w.watermark == EPOCH));
    }
}