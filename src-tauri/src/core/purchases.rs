//! Purchase documents (BUY RAM).
//!
//! `create` performs, inside **one** SQLite transaction:
//!   1. the purchase header + lines,
//!   2. stock increase per line with weighted-average costing,
//!   3. one stock-movement row per line,
//!   4. the seller balance increase and the "paid now" payment row,
//!   5. an audit entry.
//!
//! Any failure rolls the whole thing back, so inventory can never drift out of
//! step with the documents that caused it.

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::core::parties::PartyKind;
use crate::util::{money, new_id, normalise_date, now, validate_non_negative};
use rusqlite::Connection;

const COLUMNS: &str = "id, purchase_number, seller_id, seller_name, purchase_date, subtotal,
     discount, total, paid, remaining, payment_method, notes, status, voided_at, void_reason,
     created_at, updated_at";

fn map_purchase(r: &rusqlite::Row<'_>) -> rusqlite::Result<Purchase> {
    Ok(Purchase {
        id: r.get(0)?,
        purchase_number: r.get(1)?,
        seller_id: r.get(2)?,
        seller_name: r.get(3)?,
        purchase_date: r.get(4)?,
        subtotal: r.get(5)?,
        discount: r.get(6)?,
        total: r.get(7)?,
        paid: r.get(8)?,
        remaining: r.get(9)?,
        payment_method: r.get(10)?,
        notes: r.get(11)?,
        status: r.get(12)?,
        voided_at: r.get(13)?,
        void_reason: r.get(14)?,
        item_count: 0,
        unit_count: 0,
        items: Vec::new(),
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
        cloud_approval_id: None,
        requested_by_email: None,
        decided_by_email: None,
        decided_at: None,
    })
}

// ================================================================ queries ===

pub fn items_for(conn: &Connection, purchase_id: &str) -> AppResult<Vec<PurchaseItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, purchase_id, ram_item_id, sku, generation, category, capacity, speed,
                quantity, cost_per_unit, subtotal
           FROM purchase_items WHERE purchase_id = ?1 ORDER BY rowid ASC",
    )?;
    let rows = stmt.query_map([purchase_id], |r| {
        Ok(PurchaseItem {
            id: r.get(0)?,
            purchase_id: r.get(1)?,
            ram_item_id: r.get(2)?,
            sku: r.get(3)?,
            generation: r.get(4)?,
            category: r.get(5)?,
            capacity: r.get(6)?,
            speed: r.get(7)?,
            quantity: r.get(8)?,
            cost_per_unit: r.get(9)?,
            subtotal: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Purchase> {
    let mut p = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM purchases WHERE id = ?1"),
            [id],
            map_purchase,
        )
        .map_err(|_| AppError::not_found("Purchase not found."))?;
    p.items = items_for(conn, id)?;
    p.item_count = p.items.len() as i64;
    p.unit_count = p.items.iter().map(|i| i.quantity).sum();
    Ok(p)
}

pub fn get_by_number(conn: &Connection, number: &str) -> AppResult<Purchase> {
    let id: String = conn
        .query_row(
            "SELECT id FROM purchases WHERE purchase_number = ?1",
            [number],
            |r| r.get(0),
        )
        .map_err(|_| AppError::not_found(format!("Purchase {number} not found.")))?;
    get(conn, &id)
}

#[derive(Debug, Clone, Default)]
pub struct DocFilter {
    pub search: String,
    pub seller_id: Option<String>,
    pub status: Option<String>,
    pub method: Option<String>,
    pub from: String,
    pub to: String,
    pub generation: Option<String>,
    pub category: Option<String>,
    pub capacity: Option<String>,
    pub speed: Option<String>,
    pub manufacturer: Option<String>,
    pub location: Option<String>,
    pub limit: Option<i64>,
}

pub fn list(conn: &Connection, f: &DocFilter) -> AppResult<Vec<Purchase>> {
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
    if any!(&f.seller_id) {
        push!("seller_id = @", rusqlite::types::Value::Text(f.seller_id.clone().unwrap()));
    }
    if any!(&f.status) {
        push!("status = @", rusqlite::types::Value::Text(f.status.clone().unwrap()));
    }
    if any!(&f.method) {
        push!("payment_method = @", rusqlite::types::Value::Text(f.method.clone().unwrap()));
    }
    if !f.from.is_empty() {
        push!("purchase_date >= @", rusqlite::types::Value::Text(f.from.clone()));
    }
    if !f.to.is_empty() {
        push!("purchase_date <= @", rusqlite::types::Value::Text(f.to.clone()));
    }
    if any!(&f.generation)
        || any!(&f.category)
        || any!(&f.capacity)
        || any!(&f.speed)
        || any!(&f.manufacturer)
        || any!(&f.location)
    {
        // Generation/category/capacity/speed are snapshotted per line at
        // purchase time; manufacturer and location are the item's current
        // values (they were not captured when the line was recorded).
        let first = args.len();
        for value in [
            f.generation.clone().unwrap_or_default(),
            f.category.clone().unwrap_or_default(),
            f.capacity.clone().unwrap_or_default(),
            f.speed.clone().unwrap_or_default(),
            f.manufacturer.clone().unwrap_or_default(),
            f.location.clone().unwrap_or_default(),
        ] {
            args.push(rusqlite::types::Value::Text(value));
        }
        let (g, c, cap, sp, mf, lo) = (first + 1, first + 2, first + 3, first + 4, first + 5, first + 6);
        where_parts.push(format!(
            "id IN (SELECT pi.purchase_id FROM purchase_items pi
                      LEFT JOIN ram_items r ON r.id = pi.ram_item_id
                     WHERE (@{g} = '' OR pi.generation = @{g})
                       AND (@{c} = '' OR pi.category = @{c})
                       AND (@{cap} = '' OR pi.capacity = @{cap})
                       AND (@{sp} = '' OR pi.speed = @{sp})
                       AND (@{mf} = '' OR COALESCE(r.manufacturer,'') = @{mf})
                       AND (@{lo} = '' OR COALESCE(r.location,'') = @{lo}))"
        ));
    }

    let mut sql = format!("SELECT {COLUMNS} FROM purchases");
    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }
    sql.push_str(" ORDER BY purchase_date DESC, created_at DESC, rowid DESC");
    if let Some(l) = f.limit {
        sql.push_str(&format!(" LIMIT {l}"));
    }

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_purchase)?;
    let mut purchases: Vec<Purchase> = rows.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Attach line counts without loading every line.
    let mut counter = conn.prepare(
        "SELECT purchase_id, COUNT(*), COALESCE(SUM(quantity), 0)
           FROM purchase_items GROUP BY purchase_id",
    )?;
    let counts: std::collections::HashMap<String, (i64, i64)> = counter
        .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))))?
        .collect::<Result<_, _>>()?;
    drop(counter);

    for p in purchases.iter_mut() {
        if let Some((n, u)) = counts.get(&p.id) {
            p.item_count = *n;
            p.unit_count = *u;
        }
    }
    Ok(purchases)
}

pub fn items_for_party(conn: &Connection, seller_id: &str) -> AppResult<Vec<Purchase>> {
    let f = DocFilter { seller_id: Some(seller_id.to_string()), ..Default::default() };
    list(conn, &f)
}

// ================================================================= create ===

pub fn create(conn: &mut Connection, input: &PurchaseInput) -> AppResult<Purchase> {
    if input.items.is_empty() {
        return Err(AppError::validation("Add at least one RAM item to the purchase."));
    }

    let date = normalise_date(input.purchase_date.as_deref().unwrap_or(""))?;
    let discount = validate_non_negative(input.discount, "Discount")?;
    let method = input.payment_method.clone().unwrap_or_else(|| "Cash".into());

    // Resolve the seller: id wins, otherwise match by name, otherwise it must
    // be supplied because the document stores a denormalised name.
    let seller = match input.seller_id.as_ref().filter(|s| !s.is_empty()) {
        Some(id) => Some(super::parties::get(conn, PartyKind::Seller, id)?),
        None => match input.seller_name.as_ref().filter(|s| !s.trim().is_empty()) {
            Some(n) => super::parties::find_by_name(conn, PartyKind::Seller, n),
            None => None,
        },
    };
    let (seller_id, seller_name) = match &seller {
        Some(s) => (Some(s.id.clone()), s.company_name.clone()),
        None => (
            None,
            input
                .seller_name
                .as_deref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::validation("Select or create a seller first."))?,
        ),
    };

    // Validate every line before opening the transaction. Snapshotting the
    // catalogue fields here keeps the document readable even if the catalogue
    // item is edited later.
    let mut lines: Vec<PurchaseLine> = Vec::new();
    let mut subtotal = 0.0;
    for line in &input.items {
        let item = super::catalog::get(conn, &line.ram_item_id)?;
        let qty = crate::util::validate_quantity(line.quantity, "Quantity", false)?;
        let unit = validate_non_negative(line.unit_price, "Unit cost")?;
        subtotal += qty as f64 * unit;
        lines.push(PurchaseLine {
            ram_item_id: item.id,
            sku: item.sku,
            generation: item.generation,
            category: item.category,
            capacity: item.capacity,
            speed: item.speed,
            quantity: qty,
            unit,
        });
    }

    let total = money(subtotal - discount);
    if total < 0.0 {
        return Err(AppError::validation("The discount cannot exceed the subtotal."));
    }
    let paid = money(validate_non_negative(input.amount_paid, "Amount paid")?);
    let remaining = money(total - paid);

    let tx = conn.transaction()?;

    let id = new_id();
    let number = match input.purchase_number.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(n) => n.trim().to_uppercase(),
        None => crate::util::next_doc_number_tx(&tx, "PUR", "purchases", "purchase_number")?,
    };
    let ts = now();

    tx.execute(
        "INSERT INTO purchases
           (id, purchase_number, seller_id, seller_name, purchase_date, subtotal, discount,
            total, paid, remaining, payment_method, notes, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'completed', ?13, ?13)",
        rusqlite::params![
            id, number, seller_id, seller_name, date, money(subtotal), discount,
            total, paid, remaining, method, input.notes, ts
        ],
    )?;

    let total_units: i64 = lines.iter().map(|l| l.quantity).sum();

    for line in &lines {
        let line_total = money(line.quantity as f64 * line.unit);

        tx.execute(
            "INSERT INTO purchase_items
               (id, purchase_id, ram_item_id, sku, generation, category, capacity, speed,
                quantity, cost_per_unit, subtotal, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                new_id(), id, line.ram_item_id, line.sku, line.generation, line.category,
                line.capacity, line.speed, line.quantity, line.unit, line_total, ts
            ],
        )?;

        let (prev, new) = super::stock::bump(&tx, &line.ram_item_id, line.quantity, Some(line.unit))?;

        super::stock::record_movement(
            &tx, &line.ram_item_id, &line.sku, line.quantity, prev, new,
            "PURCHASE", Some("PURCHASE"), Some(id.as_str()), Some(number.as_str()), None,
        )?;
    }

    if paid > 0.0 {
        if let Some(sid) = seller_id.as_deref() {
            super::payments::insert_tx(
                &tx, crate::models::PAY_PAY_SELLER, "seller", Some(sid), &seller_name,
                paid, &method, Some(number.as_str()),
                Some(&format!("Payment for purchase {number}")), &date,
            )?;
        }
    }

    if let Some(sid) = seller_id.as_deref() {
        // We now owe the seller the unpaid part.
        super::parties::apply_balance_tx(&tx, PartyKind::Seller, sid, remaining, total, paid)?;
    }

    super::log(
        &tx, "CREATE", "PURCHASE", Some(id.as_str()),
        &format!(
            "Purchase {number} from {seller_name}: {total_units} units, {}",
            crate::util::money(total)
        ),
    );

    tx.commit()?;
    get(conn, &id)
}

/// A validated purchase line, captured from the catalogue before insert.
struct PurchaseLine {
    ram_item_id: String,
    sku: String,
    generation: String,
    category: String,
    capacity: String,
    speed: String,
    quantity: i64,
    unit: f64,
}

// =================================================================== void ===

/// Reverses a purchase: stock goes back out and the seller balance unwinds.
///
/// The weighted average is rebuilt from the surviving documents so the cost
/// basis stays exact.
pub fn void(conn: &mut Connection, id: &str, reason: &str) -> AppResult<Purchase> {
    let reason = crate::util::validate_required(reason, "Reason")?;
    let purchase = get(conn, id)?;

    if purchase.status == "void" {
        return Err(AppError::business(format!("Purchase {} is already voided.", purchase.purchase_number)));
    }

    let tx = conn.transaction()?;

    let mut touched: Vec<String> = Vec::new();
    for item in &purchase.items {
        let (prev, _, _) = super::stock::current_state(&tx, &item.ram_item_id)?;
        if item.quantity > prev {
            return Err(AppError::business(format!(
                "Cannot void {}: it would take {} below zero (currently {} in stock).",
                purchase.purchase_number, item.sku, prev
            )));
        }
        let (_, new) = super::stock::bump(&tx, &item.ram_item_id, -item.quantity, None)?;
        super::stock::record_movement(
            &tx, &item.ram_item_id, &item.sku, -item.quantity, prev, new,
            "ADJUSTMENT_OUT", Some("PURCHASE_VOID"), Some(id), Some(&purchase.purchase_number),
            Some(reason.as_str()),
        )?;
        touched.push(item.ram_item_id.clone());
    }

    tx.execute(
        "UPDATE purchases SET status = 'void', voided_at = ?2, void_reason = ?3, updated_at = ?2
          WHERE id = ?1",
        rusqlite::params![id, now(), reason],
    )?;

    // The payment generated by the document is voided alongside it.
    tx.execute(
        "UPDATE payments SET voided_at = ?2, void_reason = ?3, updated_at = ?2
          WHERE reference = ?1 AND voided_at IS NULL",
        rusqlite::params![
            purchase.purchase_number,
            now(),
            format!("Voided {}", purchase.purchase_number)
        ],
    )?;

    if let Some(sid) = purchase.seller_id.as_deref() {
        super::parties::apply_balance_tx(
            &tx, PartyKind::Seller, sid,
            -purchase.total + purchase.paid,
            -purchase.total,
            -purchase.paid,
        )?;
    }

    for item_id in &touched {
        super::stock::recompute(&tx, item_id)?;
    }

    super::log(
        &tx, "VOID", "PURCHASE", Some(id),
        &format!("Voided {} - {reason}", purchase.purchase_number),
    );

    tx.commit()?;
    get(conn, id)
}

/// Records an additional payment against an existing purchase.
pub fn pay(conn: &mut Connection, id: &str, amount: f64, method: &str, notes: Option<&str>, date: &str) -> AppResult<Purchase> {
    let amount = crate::util::validate_positive(amount, "Amount")?;
    let purchase = get(conn, id)?;
    if purchase.status == "void" {
        return Err(AppError::business("Cannot pay a voided purchase."));
    }
    if amount > purchase.remaining + 0.005 {
        return Err(AppError::business(format!(
            "{} exceeds the remaining balance of {} on {}.",
            crate::util::money(amount),
            crate::util::money(purchase.remaining),
            purchase.purchase_number
        )));
    }

    let paid = money(purchase.paid + amount);
    let remaining = money(purchase.total - paid);
    let date = normalise_date(date)?;

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE purchases SET paid = ?2, remaining = ?3, payment_method = ?4, updated_at = ?5 WHERE id = ?1",
        rusqlite::params![id, paid, remaining, method, now()],
    )?;

    if let Some(sid) = purchase.seller_id.as_deref() {
        super::payments::insert_tx(
            &tx, crate::models::PAY_PAY_SELLER, "seller", Some(sid), &purchase.seller_name,
            amount, method, Some(&purchase.purchase_number),
            notes.map(|s| s.to_string()).as_deref(), &date,
        )?;
        super::parties::apply_balance_tx(&tx, PartyKind::Seller, sid, -amount, 0.0, amount)?;
    }

    super::log(
        &tx, "PAYMENT", "PURCHASE", Some(id),
        &format!("Payment {} against {}", crate::util::money(amount), purchase.purchase_number),
    );
    tx.commit()?;

    get(conn, id)
}