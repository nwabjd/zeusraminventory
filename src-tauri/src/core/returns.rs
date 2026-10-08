//! Sales and purchase returns.
//!
//! * `SALE_RETURN`      - a customer gives RAM back: stock increases, the
//!   credit note reduces what they owe.
//! * `PURCHASE_RETURN` - stock goes back to the supplier: stock decreases and
//!   what we owe them falls.

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::core::parties::PartyKind;
use crate::util::{money, new_id, normalise_date, now, validate_non_negative};
use rusqlite::Connection;

const COLUMNS: &str = "id, return_number, return_type, reference_id, reference_number,
     party_type, party_id, party_name, return_date, total, refund, note, created_at";

fn map_return(r: &rusqlite::Row<'_>) -> rusqlite::Result<ReturnDoc> {
    Ok(ReturnDoc {
        id: r.get(0)?,
        return_number: r.get(1)?,
        return_type: r.get(2)?,
        reference_id: r.get(3)?,
        reference_number: r.get(4)?,
        party_type: r.get(5)?,
        party_id: r.get(6)?,
        party_name: r.get(7)?,
        return_date: r.get(8)?,
        total: r.get(9)?,
        refund: r.get(10)?,
        note: r.get(11)?,
        item_count: 0,
        unit_count: 0,
        items: Vec::new(),
        created_at: r.get(12)?,
    })
}

pub fn items_for(conn: &Connection, return_id: &str) -> AppResult<Vec<ReturnItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, return_id, ram_item_id, sku, generation, category, capacity, speed,
                quantity, unit_price, unit_cost, subtotal
           FROM return_items WHERE return_id = ?1 ORDER BY rowid ASC",
    )?;
    let rows = stmt.query_map([return_id], |r| {
        Ok(ReturnItem {
            id: r.get(0)?,
            return_id: r.get(1)?,
            ram_item_id: r.get(2)?,
            sku: r.get(3)?,
            generation: r.get(4)?,
            category: r.get(5)?,
            capacity: r.get(6)?,
            speed: r.get(7)?,
            quantity: r.get(8)?,
            unit_price: r.get(9)?,
            unit_cost: r.get(10)?,
            subtotal: r.get(11)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<ReturnDoc> {
    let mut d = conn
        .query_row(&format!("SELECT {COLUMNS} FROM returns WHERE id = ?1"), [id], map_return)
        .map_err(|_| AppError::not_found("Return not found."))?;
    d.items = items_for(conn, id)?;
    d.item_count = d.items.len() as i64;
    d.unit_count = d.items.iter().map(|i| i.quantity).sum();
    Ok(d)
}

pub fn list(conn: &Connection, return_type: Option<&str>, from: &str, to: &str) -> AppResult<Vec<ReturnDoc>> {
    let mut sql = format!("SELECT {COLUMNS} FROM returns WHERE 1 = 1");
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if return_type.is_some_and(|t| !t.is_empty() && t != "all") {
        args.push(rusqlite::types::Value::Text(return_type.unwrap().to_string()));
        sql.push_str(&format!(" AND return_type = ?{}", args.len()));
    }
    if !from.is_empty() {
        args.push(rusqlite::types::Value::Text(from.to_string()));
        sql.push_str(&format!(" AND return_date >= ?{}", args.len()));
    }
    if !to.is_empty() {
        args.push(rusqlite::types::Value::Text(to.to_string()));
        sql.push_str(&format!(" AND return_date <= ?{}", args.len()));
    }
    sql.push_str(" ORDER BY return_date DESC, rowid DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_return)?;
    let mut docs: Vec<ReturnDoc> = rows.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut counter = conn.prepare(
        "SELECT return_id, COUNT(*), COALESCE(SUM(quantity), 0) FROM return_items GROUP BY return_id",
    )?;
    let counts: std::collections::HashMap<String, (i64, i64)> = counter
        .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))))?
        .collect::<Result<_, _>>()?;
    drop(counter);

    for d in docs.iter_mut() {
        if let Some((n, u)) = counts.get(&d.id) {
            d.item_count = *n;
            d.unit_count = *u;
        }
    }
    Ok(docs)
}

pub fn create(conn: &mut Connection, input: &ReturnInput) -> AppResult<ReturnDoc> {
    if input.items.is_empty() {
        return Err(AppError::validation("Add at least one RAM item to the return."));
    }
    let is_sale = match input.return_type.as_str() {
        "SALE_RETURN" => true,
        "PURCHASE_RETURN" => false,
        other => {
            return Err(AppError::validation(format!(
                "Unknown return type '{other}'. Use Sale Return or Purchase Return."
            )))
        }
    };
    let date = normalise_date(input.return_date.as_deref().unwrap_or(""))?;

    // Resolve the source document, which supplies the party and the price.
    let reference_number: Option<String> = match input.reference_id.as_ref().filter(|s| !s.is_empty()) {
        Some(rid) => {
            if is_sale {
                Some(super::sales::get(conn, rid)?.sale_number)
            } else {
                Some(super::purchases::get(conn, rid)?.purchase_number)
            }
        }
        None => None,
    };

    struct Line {
        ram_item_id: String,
        sku: String,
        generation: String,
        category: String,
        capacity: String,
        speed: String,
        quantity: i64,
        unit_price: f64,
        unit_cost: f64,
    }

    let mut lines: Vec<Line> = Vec::new();
    let mut total = 0.0;
    // Units already committed by an earlier line of *this* return, so two lines
    // for the same SKU cannot slip past the sold-quantity ceiling together.
    let mut pending: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

    for rl in &input.items {
        let item = super::catalog::get(conn, &rl.ram_item_id)?;
        let qty = crate::util::validate_quantity(rl.quantity, "Quantity", false)?;

        // Price comes from the original document when it still has that line.
        let mut price: Option<f64> = rl.unit_price;
        let mut cost: Option<f64> = None;
        if let Some(rid) = input.reference_id.as_ref().filter(|s| !s.is_empty()) {
            if is_sale {
                let doc = super::sales::get(conn, rid)?;
                if let Some(l) = doc.items.iter().find(|l| l.ram_item_id == item.id) {
                    price = Some(l.selling_price);
                    cost = Some(l.cost_per_unit);
                }
                // Never hand back more than the customer actually bought.
                let already = returned_quantity(conn, &item.id, rid)?;
                let in_this_return = pending.get(&item.id).copied().unwrap_or(0);
                let sold = doc.items.iter().find(|l| l.ram_item_id == item.id).map(|l| l.quantity).unwrap_or(0);
                let returnable = (sold - already - in_this_return).max(0);
                if qty > returnable {
                    return Err(AppError::business(format!(
                        "Cannot return {} unit(s) of {}: {} of {} sold on {} {} already back.",
                        qty,
                        item.sku,
                        sold - returnable.min(sold),
                        sold,
                        doc.sale_number,
                        if returnable == 1 { "unit is" } else { "units are" }
                    )));
                }
            } else {
                let doc = super::purchases::get(conn, rid)?;
                if let Some(l) = doc.items.iter().find(|l| l.ram_item_id == item.id) {
                    price = Some(l.cost_per_unit);
                }
                let already = returned_quantity(conn, &item.id, rid)?;
                let in_this_return = pending.get(&item.id).copied().unwrap_or(0);
                let bought = doc.items.iter().find(|l| l.ram_item_id == item.id).map(|l| l.quantity).unwrap_or(0);
                let returnable = (bought - already - in_this_return).max(0);
                if qty > returnable {
                    return Err(AppError::business(format!(
                        "Cannot return {} unit(s) of {}: {} of {} bought on {} {} already back.",
                        qty,
                        item.sku,
                        bought - returnable.min(bought),
                        bought,
                        doc.purchase_number,
                        if returnable == 1 { "unit is" } else { "units are" }
                    )));
                }
            }
        }
        let unit_price = validate_non_negative(price.unwrap_or(0.0), "Unit price")?;
        let unit_cost = cost.unwrap_or(item.average_cost);

        if !is_sale && qty > item.quantity {
            return Err(AppError::business(format!(
                "Cannot return {} unit(s) of {}: only {} in stock.",
                qty, item.sku, item.quantity
            )));
        }

        *pending.entry(item.id.clone()).or_insert(0) += qty;
        total += qty as f64 * unit_price;
        lines.push(Line {
            ram_item_id: item.id,
            sku: item.sku,
            generation: item.generation,
            category: item.category,
            capacity: item.capacity,
            speed: item.speed,
            quantity: qty,
            unit_price,
            unit_cost: money(unit_cost),
        });
    }

    let total = money(total);
    let refund = money(validate_non_negative(input.refund, "Refund")?);

    // Party: fall back to the party of the referenced document. This must be
    // resolved *before* the transaction opens, because reading through `conn`
    // while `tx` holds it mutably is a borrow conflict.
    let party_type = if is_sale { "buyer" } else { "seller" };
    let (party_id, party_name) =
        match input.reference_id.as_ref().filter(|s| !s.is_empty()) {
            Some(rid) if is_sale => {
                let s = super::sales::get(conn, rid)?;
                (s.buyer_id.unwrap_or_default(), s.buyer_name)
            }
            Some(rid) => {
                let p = super::purchases::get(conn, rid)?;
                (p.seller_id.unwrap_or_default(), p.seller_name)
            }
            // No referenced document: the return stays unattributed.
            None => (String::new(), String::new()),
        };

    let tx = conn.transaction()?;
    let id = new_id();
    let prefix = if is_sale { "SRT" } else { "PRT" };
    let number = crate::util::next_doc_number_tx(&tx, prefix, "returns", "return_number")?;
    let ts = now();

    tx.execute(
        "INSERT INTO returns
           (id, return_number, return_type, reference_id, reference_number, party_type,
            party_id, party_name, return_date, total, refund, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
        rusqlite::params![
            id, number, input.return_type, input.reference_id, reference_number,
            party_type, if party_id.is_empty() { None } else { Some(party_id.as_str()) }, party_name,
            date, total, refund, input.note, ts
        ],
    )?;

    for l in &lines {
        let line_total = money(l.quantity as f64 * l.unit_price);
        tx.execute(
            "INSERT INTO return_items
               (id, return_id, ram_item_id, sku, generation, category, capacity, speed,
                quantity, unit_price, unit_cost, subtotal, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                new_id(), id, l.ram_item_id, l.sku, l.generation, l.category, l.capacity,
                l.speed, l.quantity, l.unit_price, l.unit_cost, line_total, ts
            ],
        )?;

        let delta = if is_sale { l.quantity } else { -l.quantity };
        let (prev, new) = super::stock::bump(
            &tx,
            &l.ram_item_id,
            delta,
            if is_sale { None } else { Some(l.unit_price) },
        )?;

        super::stock::record_movement(
            &tx,
            &l.ram_item_id,
            &l.sku,
            delta,
            prev,
            new,
            if is_sale { "SALE_RETURN" } else { "PURCHASE_RETURN" },
            Some("RETURN"),
            Some(id.as_str()),
            Some(number.as_str()),
            input.note.as_deref(),
        )?;
    }

    // Credit / debit the party balance by the returned value, net of the refund
    // already settled in cash.
    if !party_id.is_empty() {
        let kind = if is_sale { PartyKind::Buyer } else { PartyKind::Seller };
        let effect = money(-total + refund);
        super::parties::apply_balance_tx(
            &tx,
            kind,
            &party_id,
            effect,
            -total,
            refund,
        )?;
    }

    super::log(
        &tx,
        "CREATE",
        "RETURN",
        Some(id.as_str()),
        &format!(
            "{} {}: {} units, {}",
            if is_sale { "Sale return" } else { "Purchase return" },
            number,
            lines.iter().map(|l| l.quantity).sum::<i64>(),
            crate::util::money(total)
        ),
    );

    tx.commit()?;
    get(conn, &id)
}

/// Counts how much of a sale/purchase line has already been returned so the UI
/// cannot offer more than was sold.
pub fn returned_quantity(conn: &Connection, ram_item_id: &str, reference_id: &str) -> AppResult<i64> {
    let kind_filter = if reference_id.is_empty() {
        String::new()
    } else {
        format!(" AND r.reference_id = '{reference_id}'")
    };
    let n: i64 = conn.query_row(
        &format!(
            "SELECT COALESCE(SUM(ri.quantity), 0) FROM return_items ri
               JOIN returns r ON r.id = ri.return_id
              WHERE ri.ram_item_id = ?1 {kind_filter}"
        ),
        [ram_item_id],
        |r| r.get(0),
    )?;
    Ok(n)
}