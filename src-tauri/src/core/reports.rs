//! Report builders. Every report honours the same filter object so the UI can
//! offer one consistent filter bar across all of them.

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::core::parties::PartyKind;
use crate::util::{money, speed_to_number};
use rusqlite::Connection;

/// Builds the shared `AND (...)` fragment from a catalogue filter.
struct Predicates {
    parts: Vec<String>,
    args: Vec<rusqlite::types::Value>,
}

impl Predicates {
    fn new() -> Self {
        Predicates { parts: Vec::new(), args: Vec::new() }
    }
    fn push(&mut self, template: &str, value: String) {
        self.args.push(rusqlite::types::Value::Text(value));
        self.parts.push(template.replace('@', &format!("?{}", self.args.len())));
    }
    }

/// Catalogue-level filters (generation / category / speed / manufacturer /
/// location / capacity), qualified with the caller's table alias.
fn catalogue_filter(f: &ReportFilter, alias: &str) -> Predicates {
    let mut p = Predicates::new();
    if let Some(g) = &f.generation {
        p.push(&format!("{alias}.generation = @"), g.clone());
    }
    if let Some(c) = &f.category {
        p.push(&format!("{alias}.category = @"), c.clone());
    }
    if let Some(s) = &f.speed {
        p.push(&format!("{alias}.speed = @"), s.clone());
    }
    if let Some(m) = &f.manufacturer {
        p.push(&format!("{alias}.manufacturer = @"), m.clone());
    }
    if let Some(l) = &f.location {
        p.push(&format!("{alias}.location = @"), l.clone());
    }
    if let Some(cap) = &f.capacity {
        if let Some(min) = cap.strip_prefix(">=") {
            p.args
                .push(rusqlite::types::Value::Integer(min.trim().parse().unwrap_or(0)));
            p.parts
                .push(format!("{alias}.capacity_gb >= ?{}", p.args.len()));
        } else {
            p.push(&format!("{alias}.capacity = @"), cap.clone());
        }
    }
    p
}

// ============================================================= inventory ===

pub fn inventory(conn: &Connection, f: &ReportFilter) -> AppResult<InventoryReport> {
    let f = f.clean();
    let cat = catalogue_filter(&f, "r");

    let mut parts = vec!["r.is_archived = 0".to_string()];
    parts.extend(cat.parts.clone());
    let mut args: Vec<rusqlite::types::Value> = cat.args.clone();

    if !f.from.is_empty() {
        args.push(rusqlite::types::Value::Text(f.from.clone()));
        parts.push(format!("r.created_at >= ?{}", args.len()));
    }
    if !f.to.is_empty() {
        args.push(rusqlite::types::Value::Text(f.to.clone()));
        parts.push(format!("r.created_at <= ?{}", args.len()));
    }
    if let Some(st) = &f.status {
        match st.as_str() {
            "in_stock" => parts.push("(r.quantity > 0 AND r.quantity > r.minimum_stock)".into()),
            "low" => parts.push("(r.quantity > 0 AND r.quantity <= r.minimum_stock)".into()),
            "out" => parts.push("r.quantity <= 0".into()),
            _ => {}
        }
    }

    let sql = format!(
        "SELECT r.sku, r.generation, r.category, r.capacity, r.speed, r.manufacturer,
                r.part_number, r.location, r.quantity, r.minimum_stock, r.average_cost,
                r.selling_price
           FROM ram_items r WHERE {} ORDER BY r.sku",
        parts.join(" AND ")
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
        let qty: i64 = r.get(8)?;
        let minimum: i64 = r.get(9)?;
        let cost: f64 = r.get(10)?;
        let price: f64 = r.get(11)?;
        Ok(InventoryReportRow {
            sku: r.get(0)?,
            generation: r.get(1)?,
            category: r.get(2)?,
            capacity: r.get(3)?,
            speed: r.get(4)?,
            manufacturer: r.get(5)?,
            part_number: r.get(6)?,
            location: r.get(7)?,
            quantity: qty,
            minimum_stock: minimum,
            average_cost: cost,
            selling_price: price,
            cost_value: money(cost * qty as f64),
            retail_value: money(price * qty as f64),
            stock_status: if qty <= 0 {
                "out_of_stock".into()
            } else if qty <= minimum {
                "low_stock".into()
            } else {
                "in_stock".into()
            },
        })
    })?;

    let rows: Vec<InventoryReportRow> = rows.collect::<Result<Vec<_>, _>>()?;

    let mut report = InventoryReport {
        total_skus: rows.len() as i64,
        low_stock_count: rows.iter().filter(|r| r.stock_status == "low_stock").count() as i64,
        out_of_stock_count: rows.iter().filter(|r| r.stock_status == "out_of_stock").count() as i64,
        ..Default::default()
    };
    for r in &rows {
        report.total_units += r.quantity;
        report.total_cost_value += r.cost_value;
        report.total_retail_value += r.retail_value;
    }
    report.total_cost_value = money(report.total_cost_value);
    report.total_retail_value = money(report.total_retail_value);
    report.expected_profit = money(report.total_retail_value - report.total_cost_value);
    report.dead_stock_count = rows.iter().filter(|r| r.quantity <= 0).count() as i64;
    report.rows = rows;
    Ok(report)
}

// ============================================================= purchases ===

pub fn purchases(conn: &Connection, f: &ReportFilter) -> AppResult<PurchaseReport> {
    let f = f.clean();
    let doc = super::purchases::DocFilter {
        seller_id: f.party_id.clone(),
        status: f.status.clone(),
        method: f.method.clone(),
        from: f.from.clone(),
        to: f.to.clone(),
        generation: f.generation.clone(),
        category: f.category.clone(),
        ..Default::default()
    };
    let rows = super::purchases::list(conn, &doc)?;

    let mut report = PurchaseReport { total_documents: rows.len() as i64, ..Default::default() };
    for p in &rows {
        report.total_units += p.unit_count;
        report.subtotal += p.subtotal;
        report.discount += p.discount;
        report.total += p.total;
        report.paid += p.paid;
        report.balance += p.remaining;
        if p.status == "void" {
            report.voided += 1;
        }
    }
    report.subtotal = money(report.subtotal);
    report.discount = money(report.discount);
    report.total = money(report.total);
    report.paid = money(report.paid);
    report.balance = money(report.balance);
    report.rows = rows;
    Ok(report)
}

// ================================================================= sales ===

pub fn sales(conn: &Connection, f: &ReportFilter) -> AppResult<SalesReport> {
    let f = f.clean();
    let doc = super::sales::DocFilter {
        buyer_id: f.party_id.clone(),
        status: f.status.clone(),
        method: f.method.clone(),
        from: f.from.clone(),
        to: f.to.clone(),
        generation: f.generation.clone(),
        category: f.category.clone(),
        ..Default::default()
    };
    let rows = super::sales::list(conn, &doc)?;

    let mut report = SalesReport { total_documents: rows.len() as i64, ..Default::default() };
    let mut subtotal = 0.0;
    for s in &rows {
        report.total_units += s.unit_count;
        report.discount += s.discount;
        report.total += s.total;
        report.received += s.received;
        report.outstanding += s.remaining;
        report.total_cost += s.total_cost;
        report.gross_profit += s.gross_profit;
        subtotal += s.subtotal;
        if s.status == "void" {
            report.voided += 1;
        }
    }
    report.subtotal = money(subtotal);
    report.discount = money(report.discount);
    report.total = money(report.total);
    report.received = money(report.received);
    report.outstanding = money(report.outstanding);
    report.total_cost = money(report.total_cost);
    report.gross_profit = money(report.gross_profit);
    report.average_margin = if subtotal > 0.0 {
        money(report.gross_profit / subtotal * 100.0)
    } else {
        0.0
    };
    report.rows = rows;
    Ok(report)
}

// ================================================================ profit ===

pub fn profit(conn: &Connection, f: &ReportFilter, grouping: &str) -> AppResult<ProfitReport> {
    let f = f.clean();

    // SQLite's strftime on a local 'YYYY-MM-DD HH:MM:SS' string works directly.
    let expr = match grouping {
        "month" => "substr(sale_date, 1, 7)",
        "week" => "strftime('%Y-W%W', sale_date)",
        "quarter" => "substr(sale_date, 1, 4) || '-Q' || ((CAST(substr(sale_date, 6, 2) AS INTEGER) + 2) / 3)",
        _ => "sale_date",
    };

    let mut parts = vec!["status <> 'void'".to_string()];
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if !f.from.is_empty() {
        args.push(rusqlite::types::Value::Text(f.from.clone()));
        parts.push(format!("sale_date >= ?{}", args.len()));
    }
    if !f.to.is_empty() {
        args.push(rusqlite::types::Value::Text(f.to.clone()));
        parts.push(format!("sale_date <= ?{}", args.len()));
    }

    // Units are aggregated in their own CTE: a correlated subquery cannot
    // reference the `period` GROUP BY alias, so the two aggregates are joined
    // on a real column instead.
    let sql = format!(
        "WITH doc AS (
             SELECT {expr} AS period, subtotal, total_cost, gross_profit, total
               FROM sales WHERE {filters}
         ),
         units_by_period AS (
             SELECT {expr} AS period, SUM(si.quantity) AS units
               FROM sale_items si
               JOIN sales s2 ON s2.id = si.sale_id
              WHERE s2.status <> 'void'
              GROUP BY 1
         )
         SELECT d.period AS period,
                COALESCE(SUM(d.subtotal), 0)     AS net_revenue,
                COALESCE(SUM(d.total_cost), 0)   AS cost,
                COALESCE(SUM(d.gross_profit), 0) AS profit,
                COALESCE(SUM(d.total), 0)        AS invoiced,
                COALESCE(MAX(u.units), 0)         AS units,
                COUNT(*)                         AS txns
           FROM doc d
           LEFT JOIN units_by_period u ON u.period = d.period
          GROUP BY d.period
          ORDER BY d.period DESC",
        filters = parts.join(" AND ")
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
        let net_revenue: f64 = r.get(1)?;
        let profit: f64 = r.get(3)?;
        Ok(ProfitRow {
            period: r.get(0)?,
            sales_total: money(r.get::<_, f64>(4)?),
            sales_cost: money(r.get::<_, f64>(2)?),
            gross_profit: money(profit),
            margin: if net_revenue > 0.0 { money(profit / net_revenue * 100.0) } else { 0.0 },
            units_sold: r.get(5)?,
            transactions: r.get(6)?,
        })
    })?;
    let rows: Vec<ProfitRow> = rows.collect::<Result<Vec<_>, _>>()?;

    let mut report = ProfitReport {
        best_day_profit: rows.first().map(|r| r.gross_profit).unwrap_or(0.0),
        best_day: rows.first().map(|r| r.period.clone()).unwrap_or_default(),
        ..Default::default()
    };
    for r in &rows {
        report.sales_total += r.sales_total;
        report.sales_cost += r.sales_cost;
        report.gross_profit += r.gross_profit;
    }
    report.sales_total = money(report.sales_total);
    report.sales_cost = money(report.sales_cost);
    report.gross_profit = money(report.gross_profit);
    let sub: f64 = rows.iter().map(|r| r.sales_total).sum();
    report.average_margin = if sub > 0.0 { money(report.gross_profit / sub * 100.0) } else { 0.0 };

    // Purchases in the same window, for the cash-flow line.
    let mut pparts = vec!["status <> 'void'".to_string()];
    let mut pargs: Vec<rusqlite::types::Value> = Vec::new();
    if !f.from.is_empty() {
        pargs.push(rusqlite::types::Value::Text(f.from.clone()));
        pparts.push(format!("purchase_date >= ?{}", pargs.len()));
    }
    if !f.to.is_empty() {
        pargs.push(rusqlite::types::Value::Text(f.to.clone()));
        pparts.push(format!("purchase_date <= ?{}", pargs.len()));
    }
    let purchases_total: f64 = conn.query_row(
        &format!("SELECT COALESCE(SUM(total), 0) FROM purchases WHERE {}", pparts.join(" AND ")),
        rusqlite::params_from_iter(pargs.iter()),
        |r| r.get(0),
    )?;
    report.purchases_total = money(purchases_total);
    report.net_cash_flow = money(report.sales_total - report.purchases_total);

    // Profit split by catalogue attribute.
    let attr_parts: Vec<String> = parts.clone();
    for (label, column) in [("generation", "generation"), ("category", "category")] {
        let sql = format!(
            "SELECT si.{column}, COALESCE(SUM(si.profit), 0)
               FROM sale_items si JOIN sales s ON s.id = si.sale_id
              WHERE {} GROUP BY si.{column} ORDER BY 2 DESC",
            attr_parts.join(" AND ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let data: Vec<Slice> = stmt
            .query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok(Slice {
                    label: r.get::<_, String>(0)?,
                    value: money(r.get::<_, f64>(1)?),
                    count: 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if label == "generation" {
            report.profit_by_generation = data;
        } else {
            report.profit_by_category = data;
        }
    }

    report.rows = rows;
    Ok(report)
}

// ========================================================== party balances ===

pub fn buyer_balances(conn: &Connection, f: &ReportFilter) -> AppResult<PartyBalanceReport> {
    party_balances(conn, f, PartyKind::Buyer)
}

pub fn seller_balances(conn: &Connection, f: &ReportFilter) -> AppResult<PartyBalanceReport> {
    party_balances(conn, f, PartyKind::Seller)
}

fn party_balances(conn: &Connection, f: &ReportFilter, kind: PartyKind) -> AppResult<PartyBalanceReport> {
    let f = f.clean();
    let all = super::parties::list(conn, kind, "", false)?;
    let mut rows: Vec<Party> = Vec::new();

    for mut p in all {
        if let Some(only) = f.party_id.as_ref().filter(|s| !s.is_empty()) {
            if &p.id != only {
                continue;
            }
        }
        // Scope the money columns to the requested window.
        let (billed, paid) = windowed_totals(conn, kind, &p.id, &f)?;
        p.total_purchases = billed;
        p.total_paid = paid;
        p.total_outstanding = money(billed - paid + p.opening_balance);
        if f.from.is_empty() && f.to.is_empty() {
            p.total_outstanding = money(p.current_balance);
        }
        rows.push(p);
    }

    rows.sort_by(|a, b| b.total_outstanding.total_cmp(&a.total_outstanding));

    Ok(PartyBalanceReport {
        total_outstanding: money(rows.iter().map(|r| r.total_outstanding).sum()),
        total_billed: money(rows.iter().map(|r| r.total_purchases).sum()),
        total_paid: money(rows.iter().map(|r| r.total_paid).sum()),
        party_count: rows.len() as i64,
        rows,
    })
}

fn windowed_totals(
    conn: &Connection,
    kind: PartyKind,
    party_id: &str,
    f: &ReportFilter,
) -> AppResult<(f64, f64)> {
    let table = kind.doc_table();
    let id_col = kind.doc_column();
    let date_col = kind.doc_table_date_column();
    let ptype = kind.label().to_lowercase();

    let mut args: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Text(party_id.to_string())];
    let mut parts = vec!["status <> 'void'".to_string(), format!("{id_col} = ?1")];
    if !f.from.is_empty() {
        args.push(rusqlite::types::Value::Text(f.from.clone()));
        parts.push(format!("{date_col} >= ?{}", args.len()));
    }
    if !f.to.is_empty() {
        args.push(rusqlite::types::Value::Text(f.to.clone()));
        parts.push(format!("{date_col} <= ?{}", args.len()));
    }

    let billed: f64 = conn.query_row(
        &format!("SELECT COALESCE(SUM(total), 0) FROM {table} WHERE {}", parts.join(" AND ")),
        rusqlite::params_from_iter(args.iter()),
        |r| r.get(0),
    )?;

    let mut pargs = vec![rusqlite::types::Value::Text(party_id.to_string()), rusqlite::types::Value::Text(ptype)];
    let mut pparts = vec!["voided_at IS NULL".into(), "person_id = ?1".into(), "person_type = ?2".into()];
    if !f.from.is_empty() {
        pargs.push(rusqlite::types::Value::Text(f.from.clone()));
        pparts.push(format!("payment_date >= ?{}", pargs.len()));
    }
    if !f.to.is_empty() {
        pargs.push(rusqlite::types::Value::Text(f.to.clone()));
        pparts.push(format!("payment_date <= ?{}", pargs.len()));
    }
    let paid: f64 = conn.query_row(
        &format!("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE {}", pparts.join(" AND ")),
        rusqlite::params_from_iter(pargs.iter()),
        |r| r.get(0),
    )?;

    Ok((money(billed), money(paid)))
}

// =============================================================== payments ===

pub fn payments(conn: &Connection, f: &ReportFilter) -> AppResult<PaymentReport> {
    let f = f.clean();
    let pf = super::payments::PaymentFilter {
        payment_type: f.payment_type.clone(),
        person_id: f.party_id.clone(),
        method: f.method.clone(),
        from: f.from.clone(),
        to: f.to.clone(),
        ..Default::default()
    };
    let rows = super::payments::list(conn, &pf)?;
    let (totals, by_method) = super::payments::totals(conn, &pf)?;

    Ok(PaymentReport {
        total_received: totals.received,
        total_paid: totals.paid,
        net: totals.net,
        payment_count: totals.count,
        by_method,
        rows,
    })
}

// ============================================================== coworkers ===

pub fn coworkers(conn: &Connection, f: &ReportFilter) -> AppResult<CoworkerReport> {
    let f = f.clean();
    let totals = super::coworkers::totals(conn)?;
    Ok(CoworkerReport {
        rows: super::coworkers::list(conn, "", false)?,
        transactions: super::coworkers::all_transactions(conn, &f.from, &f.to)?,
        receivable: totals.receivable,
        payable: totals.payable,
        net: totals.net,
    })
}

// ========================================================= stock movement ===

pub fn stock_movements(conn: &Connection, f: &ReportFilter) -> AppResult<StockMovementReport> {
    let f = f.clean();
    let mut parts: Vec<String> = Vec::new();
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    if !f.from.is_empty() {
        args.push(rusqlite::types::Value::Text(f.from.clone()));
        parts.push(format!("m.created_at >= ?{}", args.len()));
    }
    if !f.to.is_empty() {
        args.push(rusqlite::types::Value::Text(f.to.clone()));
        parts.push(format!("m.created_at <= ?{}", args.len()));
    }
    if let Some(g) = &f.generation {
        args.push(rusqlite::types::Value::Text(g.clone()));
        parts.push(format!("r.generation = ?{}", args.len()));
    }
    if let Some(c) = &f.category {
        args.push(rusqlite::types::Value::Text(c.clone()));
        parts.push(format!("r.category = ?{}", args.len()));
    }
    if let Some(s) = &f.speed {
        args.push(rusqlite::types::Value::Text(s.clone()));
        parts.push(format!("r.speed = ?{}", args.len()));
    }
    if let Some(m) = &f.manufacturer {
        args.push(rusqlite::types::Value::Text(m.clone()));
        parts.push(format!("r.manufacturer = ?{}", args.len()));
    }

    let clause = if parts.is_empty() { String::new() } else { format!("WHERE {}", parts.join(" AND ")) };
    let sql = format!(
        "SELECT m.id, m.ram_item_id, m.sku, m.quantity_change, m.previous_stock, m.new_stock,
                m.movement_type, m.reference_type, m.reference_id, m.reference_number, m.notes,
                m.created_at
           FROM stock_movements m
           JOIN ram_items r ON r.id = m.ram_item_id
           {clause}
          ORDER BY m.created_at DESC, m.rowid DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<StockMovement> = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), super::stock::map_movement)?
        .collect::<Result<Vec<_>, _>>()?;

    let mut report = StockMovementReport { movement_count: rows.len() as i64, ..Default::default() };
    let mut by_type: Vec<Slice> = Vec::new();
    for m in &rows {
        if m.quantity_change >= 0 {
            report.total_in += m.quantity_change;
        } else {
            report.total_out += -m.quantity_change;
        }
        match by_type.iter_mut().find(|s| s.label == m.movement_type) {
            Some(s) => {
                s.count += 1;
                s.value += m.quantity_change.abs() as f64;
            }
            None => by_type.push(Slice {
                label: m.movement_type.clone(),
                value: m.quantity_change.abs() as f64,
                count: 1,
            }),
        }
    }
    report.net_change = report.total_in - report.total_out;
    by_type.sort_by(|a, b| b.count.cmp(&a.count));
    report.by_type = by_type;
    report.rows = rows;
    Ok(report)
}

// ========================================================== returns report ===

pub fn returns(conn: &Connection, f: &ReportFilter) -> AppResult<crate::models::InventoryReport> {
    let f = f.clean();
    let docs = super::returns::list(conn, None, &f.from, &f.to)?;
    let total_units: i64 = docs.iter().map(|d| d.unit_count).sum();
    let total: f64 = docs.iter().map(|d| d.total).sum();
    let refund: f64 = docs.iter().map(|d| d.refund).sum();

    let rows = docs
        .iter()
        .map(|d| InventoryReportRow {
            sku: d.return_number.clone(),
            generation: d.return_type.replace('_', " "),
            category: d.party_name.clone(),
            quantity: d.unit_count,
            cost_value: money(d.total),
            retail_value: money(d.total - d.refund),
            stock_status: "returned".into(),
            ..Default::default()
        })
        .collect();

    Ok(crate::models::InventoryReport {
        rows,
        total_skus: docs.len() as i64,
        total_units,
        total_cost_value: money(total),
        total_retail_value: money(total - refund),
        expected_profit: 0.0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        dead_stock_count: 0,
    })
}

// ================================================================= ranking ===

/// Top SKUs by units moved, used by the inventory report footer.
pub fn top_movers(conn: &Connection, f: &ReportFilter, limit: i64) -> AppResult<Vec<NameValueRow>> {
    let f = f.clean();
    let mut parts = vec!["s.status <> 'void'".to_string()];
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if !f.from.is_empty() {
        args.push(rusqlite::types::Value::Text(f.from.clone()));
        parts.push(format!("s.sale_date >= ?{}", args.len()));
    }
    if !f.to.is_empty() {
        args.push(rusqlite::types::Value::Text(f.to.clone()));
        parts.push(format!("s.sale_date <= ?{}", args.len()));
    }
    let sql = format!(
        "SELECT si.sku, COALESCE(SUM(si.quantity), 0), COALESCE(SUM(si.profit), 0)
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE {} GROUP BY si.sku ORDER BY 2 DESC LIMIT {limit}",
        parts.join(" AND ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
        let units: i64 = r.get(1)?;
        Ok(NameValueRow {
            label: r.get::<_, String>(0)?,
            value: money(units as f64),
            count: money(r.get::<_, f64>(2)?) as i64,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Speeds present in stock, ordered numerically (used by settings + filters).
pub fn speeds_in_use(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT speed FROM ram_items WHERE speed <> '' ORDER BY speed",
    )?;
    let raw: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut out = raw;
    out.sort_by_key(|s| speed_to_number(s));
    Ok(out)
}

pub fn unsupported() -> AppError {
    AppError::internal("Unsupported report.")
}