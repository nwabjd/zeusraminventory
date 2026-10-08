//! Inventory ledger: quantity changes, weighted-average costing and stock
//! movements.
//!
//! Costing rule (moving weighted average)
//! -----------------------------------------
//! Receiving stock rolls the average forward:
//!
//! ```text
//! avg' = (qty Ã— avg + in Ã— cost) / (qty + in)
//! ```
//!
//! Issuing stock (sales, purchase returns) leaves the average untouched, which
//! keeps the valuation stable while units leave. Every sale line therefore
//! stores the cost it was valued at, and historical profit never drifts.
//!
//! [`recompute`] replays the whole ledger from scratch. It is used after a
//! document is voided so the resulting quantity and average are provably
//! consistent with the surviving documents.

use crate::error::{AppError, AppResult};
use crate::models::{InventoryAdjustment, StockMovement};
use crate::util::{money, new_id, now};
use rusqlite::{Connection, Transaction};

// ================================================================ reading ===

pub fn current_state(conn: &Connection, ram_item_id: &str) -> AppResult<(i64, f64, String)> {
    conn.query_row(
        "SELECT quantity, average_cost, sku FROM ram_items WHERE id = ?1",
        [ram_item_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .map_err(|_| AppError::not_found("RAM item not found."))
}

fn write_state(
    conn: &Connection,
    ram_item_id: &str,
    quantity: i64,
    average_cost: f64,
) -> AppResult<()> {
    conn.execute(
        "UPDATE ram_items SET quantity = ?2, average_cost = ?3, updated_at = ?4 WHERE id = ?1",
        rusqlite::params![ram_item_id, quantity, money(average_cost), now()],
    )?;
    Ok(())
}

// ============================================================== mutations ===

/// Applies a signed delta to stock.
///
/// `unit_cost` only matters for a positive delta: it is the price the incoming
/// units were bought at and is used to roll the weighted average forward.
///
/// Returns `(previous_stock, new_stock)`.
pub fn bump(
    conn: &Connection,
    ram_item_id: &str,
    delta: i64,
    unit_cost: Option<f64>,
) -> AppResult<(i64, i64)> {
    let (qty, avg, _) = current_state(conn, ram_item_id)?;

    if delta > 0 {
        let new_qty = qty + delta;
        let new_avg = match unit_cost {
            Some(cost) if qty > 0 => (qty as f64 * avg + delta as f64 * cost) / new_qty as f64,
            Some(cost) => cost,
            None => avg,
        };
        write_state(conn, ram_item_id, new_qty, new_avg)?;
        Ok((qty, new_qty))
    } else if delta < 0 {
        let take = -delta;
        if take > qty {
            return Err(AppError::business(format!(
                "Insufficient stock: {take} requested but only {qty} available."
            )));
        }
        let new_qty = qty - take;
        write_state(conn, ram_item_id, new_qty, avg)?;
        Ok((qty, new_qty))
    } else {
        Ok((qty, qty))
    }
}

/// Appends a row to the immutable stock-movement ledger.
#[allow(clippy::too_many_arguments)]
pub fn record_movement(
    conn: &Connection,
    ram_item_id: &str,
    sku: &str,
    quantity_change: i64,
    previous_stock: i64,
    new_stock: i64,
    movement_type: &str,
    reference_type: Option<&str>,
    reference_id: Option<&str>,
    reference_number: Option<&str>,
    notes: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO stock_movements
           (id, ram_item_id, sku, quantity_change, previous_stock, new_stock,
            movement_type, reference_type, reference_id, reference_number, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            new_id(),
            ram_item_id,
            sku,
            quantity_change,
            previous_stock,
            new_stock,
            movement_type,
            reference_type,
            reference_id,
            reference_number,
            notes,
            now()
        ],
    )?;
    Ok(())
}

// ============================================================== recompute ===

/// Rebuilds `quantity` and `average_cost` for one item by replaying every
/// surviving ledger entry in chronological order.
pub fn recompute(conn: &Connection, ram_item_id: &str) -> AppResult<(i64, f64)> {
    let (sku, archived) = conn.query_row(
        "SELECT sku, is_archived FROM ram_items WHERE id = ?1",
        [ram_item_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
    )?;
    let _ = archived;
    let _ = sku;

    let mut stmt = conn.prepare(
        "SELECT delta, cost FROM (
             SELECT pi.created_at AS ts, 1 AS ord, pi.rowid AS seq,
                    pi.quantity AS delta, pi.cost_per_unit AS cost
               FROM purchase_items pi
               JOIN purchases p ON p.id = pi.purchase_id
              WHERE pi.ram_item_id = ?1 AND p.status <> 'void'
             UNION ALL
             SELECT si.created_at, 2, si.rowid, -si.quantity, 0.0
               FROM sale_items si
               JOIN sales s ON s.id = si.sale_id
              WHERE si.ram_item_id = ?1 AND s.status <> 'void'
             UNION ALL
             SELECT ia.created_at, 3, ia.rowid,
                    CASE WHEN ia.adjustment_type = 'DECREASE' THEN -ia.quantity
                         ELSE ia.quantity END,
                    0.0
               FROM inventory_adjustments ia
              WHERE ia.ram_item_id = ?1
             UNION ALL
             SELECT r.created_at, 4, ri.rowid, ri.quantity, ri.unit_cost
               FROM return_items ri
               JOIN returns r ON r.id = ri.return_id
              WHERE ri.ram_item_id = ?1 AND r.return_type = 'SALE_RETURN'
             UNION ALL
             SELECT r.created_at, 5, ri.rowid, -ri.quantity, 0.0
               FROM return_items ri
               JOIN returns r ON r.id = ri.return_id
              WHERE ri.ram_item_id = ?1 AND r.return_type = 'PURCHASE_RETURN'
         ) ORDER BY ts, ord, seq",
    )?;

    let entries: Vec<(i64, f64)> = stmt
        .query_map([ram_item_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut qty: i64 = 0;
    let mut avg: f64 = 0.0;

    for (delta, cost) in entries {
        if delta > 0 && cost > 0.0 {
            avg = if qty == 0 {
                cost
            } else {
                (qty as f64 * avg + delta as f64 * cost) / (qty + delta) as f64
            };
        }
        qty += delta;
        if qty < 0 {
            qty = 0;
        }
    }

    write_state(conn, ram_item_id, qty, avg)?;
    Ok((qty, avg))
}

/// Recomputes every item. Used after bulk operations and by tests.
pub fn recompute_all(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn.prepare("SELECT id FROM ram_items")?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    for id in ids {
        recompute(conn, &id)?;
    }
    Ok(())
}

// =============================================================== queries ===

pub fn movements_for(conn: &Connection, ram_item_id: &str) -> AppResult<Vec<StockMovement>> {
    let mut stmt = conn.prepare(
        "SELECT id, ram_item_id, sku, quantity_change, previous_stock, new_stock,
                movement_type, reference_type, reference_id, reference_number, notes, created_at
           FROM stock_movements
          WHERE ram_item_id = ?1
          ORDER BY created_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map([ram_item_id], map_movement)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn adjustments_for(conn: &Connection, ram_item_id: &str) -> AppResult<Vec<InventoryAdjustment>> {
    let mut stmt = conn.prepare(
        "SELECT id, ram_item_id, sku, adjustment_type, quantity, previous_stock,
                new_stock, reason, notes, created_at
           FROM inventory_adjustments
          WHERE ram_item_id = ?1
          ORDER BY created_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map([ram_item_id], |r| {
        Ok(InventoryAdjustment {
            id: r.get(0)?,
            ram_item_id: r.get(1)?,
            sku: r.get(2)?,
            adjustment_type: r.get(3)?,
            quantity: r.get(4)?,
            previous_stock: r.get(5)?,
            new_stock: r.get(6)?,
            reason: r.get(7)?,
            notes: r.get(8)?,
            created_at: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn map_movement(r: &rusqlite::Row<'_>) -> rusqlite::Result<StockMovement> {
    Ok(StockMovement {
        id: r.get(0)?,
        ram_item_id: r.get(1)?,
        sku: r.get(2)?,
        quantity_change: r.get(3)?,
        previous_stock: r.get(4)?,
        new_stock: r.get(5)?,
        movement_type: r.get(6)?,
        reference_type: r.get(7)?,
        reference_id: r.get(8)?,
        reference_number: r.get(9)?,
        notes: r.get(10)?,
        created_at: r.get(11)?,
    })
}

/// Movement type recorded against a document of the given kind.
///
/// Callers pass document kinds (`purchase`, `sale`) and adjustment types
/// (`INCREASE` / `DECREASE`), so the input is lower-cased before matching —
/// otherwise every `INCREASE` would fall through to `ADJUSTMENT_OUT`.
pub fn movement_label(kind: &str) -> &'static str {
    match kind.to_ascii_lowercase().as_str() {
        "purchase" => "PURCHASE",
        "sale" => "SALE",
        "sale_return" => "SALE_RETURN",
        "purchase_return" => "PURCHASE_RETURN",
        "increase" => "ADJUSTMENT_IN",
        "decrease" => "ADJUSTMENT_OUT",
        other => {
            debug_assert!(
                false,
                "unknown stock movement kind: {other}"
            );
            "ADJUSTMENT_OUT"
        }
    }
}

// ============================================================ adjustments ===

/// Manual stock correction ("Adjust Stock" on the inventory page).
pub fn adjust(
    tx: &Transaction,
    ram_item_id: &str,
    adjustment_type: &str,
    quantity: i64,
    reason: &str,
    notes: Option<&str>,
) -> AppResult<InventoryAdjustment> {
    if quantity <= 0 {
        return Err(AppError::validation("Adjustment quantity must be greater than zero."));
    }

    let (sku, previous_stock) = tx
        .query_row(
            "SELECT sku, quantity FROM ram_items WHERE id = ?1",
            [ram_item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
        .map_err(|_| AppError::not_found("RAM item not found."))?;

    let delta = if adjustment_type == "DECREASE" {
        -quantity
    } else {
        quantity
    };
    if delta < 0 && quantity > previous_stock {
        return Err(AppError::business(format!(
            "Cannot remove {quantity} units from {sku}: only {previous_stock} in stock."
        )));
    }

    // Adjustments do not change the cost basis.
    let (prev, new) = bump(tx, ram_item_id, delta, None)?;

    let id = new_id();
    tx.execute(
        "INSERT INTO inventory_adjustments
           (id, ram_item_id, sku, adjustment_type, quantity, previous_stock, new_stock, reason, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![id, ram_item_id, sku, adjustment_type, quantity, prev, new, reason, notes, now()],
    )?;

    record_movement(
        tx,
        ram_item_id,
        &sku,
        delta,
        prev,
        new,
        movement_label(adjustment_type),
        Some("ADJUSTMENT"),
        Some(id.as_str()),
        None,
        Some(reason),
    )?;

    Ok(InventoryAdjustment {
        id,
        ram_item_id: ram_item_id.to_string(),
        sku,
        adjustment_type: adjustment_type.to_string(),
        quantity,
        previous_stock: prev,
        new_stock: new,
        reason: reason.to_string(),
        notes: notes.map(|s| s.to_string()),
        created_at: now(),
    })
}