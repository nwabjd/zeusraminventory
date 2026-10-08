//! Sales documents (SELL RAM).
//!
//! Mirrors [`crate::core::purchases`]: one atomic transaction covers the header,
//! the lines, stock decrease, the cost snapshot, profit, stock movements, the
//! payment row and the buyer balance.
//!
//! Two rules are enforced twice - once while validating and once inside the
//! transaction - so neither the UI nor a concurrent write can oversell:
//!
//! * every line must have stock available, and
//! * cost is taken from the weighted average *at the moment of the sale*, then
//!   frozen on the line.

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::core::parties::PartyKind;
use crate::util::{money, new_id, normalise_date, now, validate_non_negative};
use rusqlite::Connection;

const COLUMNS: &str = "id, sale_number, buyer_id, buyer_name, sale_date, subtotal, discount,
     total, received, remaining, payment_method, total_cost, gross_profit, profit_margin,
     notes, status, voided_at, void_reason, created_at, updated_at";

fn map_sale(r: &rusqlite::Row<'_>) -> rusqlite::Result<Sale> {
    Ok(Sale {
        id: r.get(0)?,
        sale_number: r.get(1)?,
        buyer_id: r.get(2)?,
        buyer_name: r.get(3)?,
        sale_date: r.get(4)?,
        subtotal: r.get(5)?,
        discount: r.get(6)?,
        total: r.get(7)?,
        received: r.get(8)?,
        remaining: r.get(9)?,
        payment_method: r.get(10)?,
        total_cost: r.get(11)?,
        gross_profit: r.get(12)?,
        profit_margin: r.get(13)?,
        notes: r.get(14)?,
        status: r.get(15)?,
        voided_at: r.get(16)?,
        void_reason: r.get(17)?,
        item_count: 0,
        unit_count: 0,
        items: Vec::new(),
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
        cloud_approval_id: None,
        requested_by_email: None,
        decided_by_email: None,
        decided_at: None,
    })
}

pub fn items_for(conn: &Connection, sale_id: &str) -> AppResult<Vec<SaleItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, sale_id, ram_item_id, sku, generation, category, capacity, speed,
                quantity, selling_price, cost_per_unit, subtotal, cost_total, profit
           FROM sale_items WHERE sale_id = ?1 ORDER BY rowid ASC",
    )?;
    let rows = stmt.query_map([sale_id], |r| {
        Ok(SaleItem {
            id: r.get(0)?,
            sale_id: r.get(1)?,
            ram_item_id: r.get(2)?,
            sku: r.get(3)?,
            generation: r.get(4)?,
            category: r.get(5)?,
            capacity: r.get(6)?,
            speed: r.get(7)?,
            quantity: r.get(8)?,
            selling_price: r.get(9)?,
            cost_per_unit: r.get(10)?,
            subtotal: r.get(11)?,
            cost_total: r.get(12)?,
            profit: r.get(13)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Sale> {
    let mut s = conn
        .query_row(&format!("SELECT {COLUMNS} FROM sales WHERE id = ?1"), [id], map_sale)
        .map_err(|_| AppError::not_found("Sale not found."))?;
    s.items = items_for(conn, id)?;
    s.item_count = s.items.len() as i64;
    s.unit_count = s.items.iter().map(|i| i.quantity).sum();
    Ok(s)
}

pub fn get_by_number(conn: &Connection, number: &str) -> AppResult<Sale> {
    let id: String = conn
        .query_row("SELECT id FROM sales WHERE sale_number = ?1", [number], |r| r.get(0))
        .map_err(|_| AppError::not_found(format!("Sale {number} not found.")))?;
    get(conn, &id)
}

#[derive(Debug, Clone, Default)]
pub struct DocFilter {
    pub search: String,
    pub buyer_id: Option<String>,
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

pub fn list(conn: &Connection, f: &DocFilter) -> AppResult<Vec<Sale>> {
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
    if any!(&f.buyer_id) {
        push!("buyer_id = @", rusqlite::types::Value::Text(f.buyer_id.clone().unwrap()));
    }
    if any!(&f.status) {
        push!("status = @", rusqlite::types::Value::Text(f.status.clone().unwrap()));
    }
    if any!(&f.method) {
        push!("payment_method = @", rusqlite::types::Value::Text(f.method.clone().unwrap()));
    }
    if !f.from.is_empty() {
        push!("sale_date >= @", rusqlite::types::Value::Text(f.from.clone()));
    }
    if !f.to.is_empty() {
        push!("sale_date <= @", rusqlite::types::Value::Text(f.to.clone()));
    }
    if any!(&f.generation)
        || any!(&f.category)
        || any!(&f.capacity)
        || any!(&f.speed)
        || any!(&f.manufacturer)
        || any!(&f.location)
    {
        // Generation/category/capacity/speed are snapshotted per line at sale
        // time; manufacturer and location are the item's current values.
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
            "id IN (SELECT si.sale_id FROM sale_items si
                      LEFT JOIN ram_items r ON r.id = si.ram_item_id
                     WHERE (@{g} = '' OR si.generation = @{g})
                       AND (@{c} = '' OR si.category = @{c})
                       AND (@{cap} = '' OR si.capacity = @{cap})
                       AND (@{sp} = '' OR si.speed = @{sp})
                       AND (@{mf} = '' OR COALESCE(r.manufacturer,'') = @{mf})
                       AND (@{lo} = '' OR COALESCE(r.location,'') = @{lo}))"
        ));
    }

    let mut sql = format!("SELECT {COLUMNS} FROM sales");
    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }
    sql.push_str(" ORDER BY sale_date DESC, created_at DESC, rowid DESC");
    if let Some(l) = f.limit {
        sql.push_str(&format!(" LIMIT {l}"));
    }

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_sale)?;
    let mut sales: Vec<Sale> = rows.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut counter = conn.prepare(
        "SELECT sale_id, COUNT(*), COALESCE(SUM(quantity), 0) FROM sale_items GROUP BY sale_id",
    )?;
    let counts: std::collections::HashMap<String, (i64, i64)> = counter
        .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))))?
        .collect::<Result<_, _>>()?;
    drop(counter);

    for s in sales.iter_mut() {
        if let Some((n, u)) = counts.get(&s.id) {
            s.item_count = *n;
            s.unit_count = *u;
        }
    }
    Ok(sales)
}

// ================================================================= create ===

struct SaleLine {
    ram_item_id: String,
    sku: String,
    generation: String,
    category: String,
    capacity: String,
    speed: String,
    quantity: i64,
    price: f64,
    cost: f64,
}

pub fn create(conn: &mut Connection, input: &SaleInput) -> AppResult<Sale> {
    if input.items.is_empty() {
        return Err(AppError::validation("Add at least one RAM item to the sale."));
    }

    let date = normalise_date(input.sale_date.as_deref().unwrap_or(""))?;
    let discount = validate_non_negative(input.discount, "Discount")?;
    let method = input.payment_method.clone().unwrap_or_else(|| "Cash".into());

    let buyer = match input.buyer_id.as_ref().filter(|s| !s.is_empty()) {
        Some(id) => Some(super::parties::get(conn, PartyKind::Buyer, id)?),
        None => match input.buyer_name.as_ref().filter(|s| !s.trim().is_empty()) {
            Some(n) => super::parties::find_by_name(conn, PartyKind::Buyer, n),
            None => None,
        },
    };
    let (buyer_id, buyer_name) = match &buyer {
        Some(b) => (Some(b.id.clone()), b.company_name.clone()),
        None => (
            None,
            input
                .buyer_name
                .as_deref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::validation("Select or create a buyer first."))?,
        ),
    };

    // --- validate stock and capture the cost basis -------------------------
    let mut lines: Vec<SaleLine> = Vec::new();
    let mut subtotal = 0.0;
    let mut total_cost = 0.0;
    let mut seen: std::collections::HashMap<&str, i64> = std::collections::HashMap::new();

    for line in &input.items {
        let item = super::catalog::get(conn, &line.ram_item_id)?;
        let qty = crate::util::validate_quantity(line.quantity, "Quantity", false)?;
        let price = validate_non_negative(line.unit_price, "Selling price")?;

        // Two lines for the same SKU must not individually pass and jointly fail.
        let requested = seen.get(line.ram_item_id.as_str()).copied().unwrap_or(0) + qty;
        seen.insert(&line.ram_item_id, requested);
        if requested > item.quantity {
            return Err(AppError::business(format!(
                "Insufficient stock for {} ({}): {} available, {} requested.",
                item.sku,
                format!("{} {} {}", item.generation, item.capacity, item.speed),
                item.quantity,
                requested
            )));
        }

        let cost = money(item.average_cost);
        subtotal += qty as f64 * price;
        total_cost += qty as f64 * cost;
        lines.push(SaleLine {
            ram_item_id: item.id,
            sku: item.sku,
            generation: item.generation,
            category: item.category,
            capacity: item.capacity,
            speed: item.speed,
            quantity: qty,
            price,
            cost,
        });
    }

    let subtotal = money(subtotal);
    let total_cost = money(total_cost);
    let total = money(subtotal - discount);
    if total < 0.0 {
        return Err(AppError::validation("The discount cannot exceed the subtotal."));
    }
    let received = money(validate_non_negative(input.amount_received, "Amount received")?);
    let remaining = money(total - received);
    let gross_profit = money(subtotal - total_cost);
    let profit_margin = if subtotal > 0.0 { money(gross_profit / subtotal * 100.0) } else { 0.0 };

    let tx = conn.transaction()?;

    let id = new_id();
    let number = match input.sale_number.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(n) => n.trim().to_uppercase(),
        None => crate::util::next_doc_number_tx(&tx, "SAL", "sales", "sale_number")?,
    };
    let ts = now();

    tx.execute(
        "INSERT INTO sales
           (id, sale_number, buyer_id, buyer_name, sale_date, subtotal, discount, total,
            received, remaining, payment_method, total_cost, gross_profit, profit_margin,
            notes, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'completed', ?16, ?16)",
        rusqlite::params![
            id, number, buyer_id, buyer_name, date, subtotal, discount, total,
            received, remaining, method, total_cost, gross_profit, profit_margin,
            input.notes, ts
        ],
    )?;

    let total_units: i64 = lines.iter().map(|l| l.quantity).sum();
    for line in &lines {
        let line_total = money(line.quantity as f64 * line.price);
        let line_cost = money(line.quantity as f64 * line.cost);
        let line_profit = money(line_total - line_cost);

        tx.execute(
            "INSERT INTO sale_items
               (id, sale_id, ram_item_id, sku, generation, category, capacity, speed,
                quantity, selling_price, cost_per_unit, subtotal, cost_total, profit, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                new_id(), id, line.ram_item_id, line.sku, line.generation, line.category,
                line.capacity, line.speed, line.quantity, line.price, line.cost,
                line_total, line_cost, line_profit, ts
            ],
        )?;

        // Re-check inside the transaction, then move the stock.
        let (prev, _, _) = super::stock::current_state(&tx, &line.ram_item_id)?;
        if line.quantity > prev {
            return Err(AppError::business(format!(
                "Insufficient stock for {}: {} available, {} requested.",
                line.sku, prev, line.quantity
            )));
        }
        let (_, new) = super::stock::bump(&tx, &line.ram_item_id, -line.quantity, None)?;

        super::stock::record_movement(
            &tx, &line.ram_item_id, &line.sku, -line.quantity, prev, new,
            "SALE", Some("SALE"), Some(id.as_str()), Some(number.as_str()), None,
        )?;
    }

    if received > 0.0 {
        if let Some(bid) = buyer_id.as_deref() {
            super::payments::insert_tx(
                &tx, crate::models::PAY_RECEIVE_BUYER, "buyer", Some(bid), &buyer_name,
                received, &method, Some(number.as_str()),
                Some(&format!("Payment for sale {number}")), &date,
            )?;
        }
    }

    if let Some(bid) = buyer_id.as_deref() {
        super::parties::apply_balance_tx(&tx, PartyKind::Buyer, bid, remaining, total, received)?;
    }

    super::log(
        &tx, "CREATE", "SALE", Some(id.as_str()),
        &format!(
            "Sale {number} to {buyer_name}: {total_units} units, revenue {}, profit {}",
            crate::util::money(total),
            crate::util::money(gross_profit)
        ),
    );

    tx.commit()?;
    get(conn, &id)
}

// =================================================================== void ===

/// Reverses a sale: stock returns and the buyer balance unwinds.
pub fn void(conn: &mut Connection, id: &str, reason: &str) -> AppResult<Sale> {
    let reason = crate::util::validate_required(reason, "Reason")?;
    let sale = get(conn, id)?;

    if sale.status == "void" {
        return Err(AppError::business(format!("Sale {} is already voided.", sale.sale_number)));
    }

    let tx = conn.transaction()?;
    for item in &sale.items {
        let (_, new) = super::stock::bump(&tx, &item.ram_item_id, item.quantity, None)?;
        let prev = new - item.quantity;
        super::stock::record_movement(
            &tx, &item.ram_item_id, &item.sku, item.quantity, prev, new,
            "ADJUSTMENT_IN", Some("SALE_VOID"), Some(id), Some(&sale.sale_number),
            Some(reason.as_str()),
        )?;
    }

    tx.execute(
        "UPDATE sales SET status = 'void', voided_at = ?2, void_reason = ?3, updated_at = ?2
          WHERE id = ?1",
        rusqlite::params![id, now(), reason],
    )?;

    tx.execute(
        "UPDATE payments SET voided_at = ?2, void_reason = ?3, updated_at = ?2
          WHERE reference = ?1 AND voided_at IS NULL",
        rusqlite::params![sale.sale_number, now(), format!("Voided {}", sale.sale_number)],
    )?;

    if let Some(bid) = sale.buyer_id.as_deref() {
        super::parties::apply_balance_tx(
            &tx, PartyKind::Buyer, bid, -sale.total + sale.received, -sale.total, -sale.received,
        )?;
    }

    super::log(
        &tx, "VOID", "SALE", Some(id),
        &format!("Voided {} - {reason}", sale.sale_number),
    );

    tx.commit()?;
    get(conn, id)
}

/// Records an additional receipt against an existing sale.
pub fn receive(conn: &mut Connection, id: &str, amount: f64, method: &str, notes: Option<&str>, date: &str) -> AppResult<Sale> {
    let amount = crate::util::validate_positive(amount, "Amount")?;
    let sale = get(conn, id)?;
    if sale.status == "void" {
        return Err(AppError::business("Cannot pay a voided sale."));
    }
    if amount > sale.remaining + 0.005 {
        return Err(AppError::business(format!(
            "{} exceeds the outstanding balance of {} on {}.",
            crate::util::money(amount),
            crate::util::money(sale.remaining),
            sale.sale_number
        )));
    }

    let received = money(sale.received + amount);
    let remaining = money(sale.total - received);
    let date = normalise_date(date)?;

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE sales SET received = ?2, remaining = ?3, payment_method = ?4, updated_at = ?5
          WHERE id = ?1",
        rusqlite::params![id, received, remaining, method, now()],
    )?;

    if let Some(bid) = sale.buyer_id.as_deref() {
        super::payments::insert_tx(
            &tx, crate::models::PAY_RECEIVE_BUYER, "buyer", Some(bid), &sale.buyer_name,
            amount, method, Some(&sale.sale_number), notes, &date,
        )?;
        super::parties::apply_balance_tx(&tx, PartyKind::Buyer, bid, -amount, 0.0, amount)?;
    }

    super::log(
        &tx, "PAYMENT", "SALE", Some(id),
        &format!("Receipt {} against {}", crate::util::money(amount), sale.sale_number),
    );
    tx.commit()?;

    get(conn, id)
}