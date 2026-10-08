//! Dashboard aggregation. One round trip populates the whole home screen.

use crate::error::AppResult;
use crate::models::*;
use crate::core::parties::PartyKind;
use crate::util::money;
use rusqlite::{Connection, Row};

pub fn stats(conn: &Connection) -> AppResult<DashboardStats> {
    let mut s = DashboardStats::default();

    conn.query_row(
        "SELECT COALESCE(SUM(quantity), 0),
                COUNT(*),
                COALESCE(SUM(quantity * average_cost), 0),
                COALESCE(SUM(quantity * selling_price), 0),
                COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN quantity > 0 AND quantity <= minimum_stock THEN 1 ELSE 0 END), 0)
           FROM ram_items WHERE is_archived = 0",
        [],
        |r| {
            s.total_stock = r.get(0)?;
            s.total_skus = r.get(1)?;
            s.total_inventory_cost = money(r.get::<_, f64>(2)?);
            s.estimated_sales_value = money(r.get::<_, f64>(3)?);
            s.out_of_stock_count = r.get(4)?;
            s.low_stock_count = r.get(5)?;
            Ok(())
        },
    )?;
    s.potential_profit = money(s.estimated_sales_value - s.total_inventory_cost);

    // --- today ---------------------------------------------------------
    let today = crate::util::today();
    let month = format!("{}-{:02}", &today[..4], &today[5..7]);

    conn.query_row(
        "SELECT COALESCE(SUM(total), 0), COALESCE(SUM(gross_profit), 0), COUNT(*)
           FROM sales WHERE status <> 'void' AND sale_date = ?1",
        [&today],
        |r| {
            s.today_sales = money(r.get::<_, f64>(0)?);
            s.today_profit = money(r.get::<_, f64>(1)?);
            s.today_sale_count = r.get(2)?;
            Ok(())
        },
    )?;
    conn.query_row(
        "SELECT COALESCE(SUM(total), 0), COUNT(*) FROM purchases
          WHERE status <> 'void' AND purchase_date = ?1",
        [&today],
        |r| {
            s.today_purchases = money(r.get::<_, f64>(0)?);
            s.today_purchase_count = r.get(1)?;
            Ok(())
        },
    )?;

    // --- this month ----------------------------------------------------
    conn.query_row(
        "SELECT COALESCE(SUM(total), 0), COALESCE(SUM(gross_profit), 0),
                COALESCE(SUM(subtotal), 0)
           FROM sales WHERE status <> 'void' AND sale_date >= ?1",
        [&month],
        |r| {
            s.month_sales = money(r.get::<_, f64>(0)?);
            s.month_profit = money(r.get::<_, f64>(1)?);
            let sub = r.get::<_, f64>(2)?;
            s.average_margin = if sub > 0.0 { money(s.month_profit / sub * 100.0) } else { 0.0 };
            Ok(())
        },
    )?;
    conn.query_row(
        "SELECT COALESCE(SUM(total), 0) FROM purchases
          WHERE status <> 'void' AND purchase_date >= ?1",
        [&month],
        |r| {
            s.month_purchases = money(r.get(0)?);
            Ok(())
        },
    )?;

    // --- balances ------------------------------------------------------
    s.buyer_receivable = super::parties::outstanding(conn, PartyKind::Buyer)?;
    s.seller_payable = super::parties::outstanding(conn, PartyKind::Seller)?;
    let cw = super::coworkers::totals(conn)?;
    s.coworker_receivable = cw.receivable;
    s.coworker_payable = cw.payable;

    conn.query_row(
        "SELECT (SELECT COUNT(*) FROM buyers WHERE is_archived = 0),
                (SELECT COUNT(*) FROM sellers WHERE is_archived = 0)",
        [],
        |r| {
            s.buyer_count = r.get(0)?;
            s.seller_count = r.get(1)?;
            Ok(())
        },
    )?;

    // --- distributions -------------------------------------------------
    s.inventory_by_generation = slice_query(
        conn,
        "SELECT generation, COALESCE(SUM(quantity), 0) FROM ram_items
          WHERE is_archived = 0 AND generation <> '' GROUP BY generation ORDER BY 2 DESC",
    )?;
    s.inventory_by_category = slice_query(
        conn,
        "SELECT category, COALESCE(SUM(quantity), 0) FROM ram_items
          WHERE is_archived = 0 AND category <> '' GROUP BY category ORDER BY 2 DESC",
    )?;
    s.top_buyers = name_value_query(
        conn,
        "SELECT buyer_name, COALESCE(SUM(total), 0), COUNT(*) FROM sales
          WHERE status <> 'void' GROUP BY buyer_id, buyer_name ORDER BY 2 DESC LIMIT 5",
    )?;
    s.top_sellers = name_value_query(
        conn,
        "SELECT seller_name, COALESCE(SUM(total), 0), COUNT(*) FROM purchases
          WHERE status <> 'void' GROUP BY seller_id, seller_name ORDER BY 2 DESC LIMIT 5",
    )?;

    // --- recent activity -----------------------------------------------
    s.low_stock_items = super::catalog::low_stock(conn, 8)?;
    s.recent_purchases = super::purchases::list(
        conn,
        &super::purchases::DocFilter { limit: Some(5), ..Default::default() },
    )?;
    s.recent_sales = super::sales::list(
        conn,
        &super::sales::DocFilter { limit: Some(5), ..Default::default() },
    )?;
    s.recent_payments = super::payments::list(
        conn,
        &super::payments::PaymentFilter { limit: Some(6), ..Default::default() },
    )?;
    s.recent_movements = recent_movements(conn, 8)?;

    Ok(s)
}

fn slice_query(conn: &Connection, sql: &str) -> AppResult<Vec<Slice>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r: &Row<'_>| {
        Ok(Slice {
            label: r.get::<_, String>(0)?,
            value: money(r.get::<_, f64>(1)?),
            count: r.get::<_, i64>(1)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn name_value_query(conn: &Connection, sql: &str) -> AppResult<Vec<NameValueRow>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(NameValueRow {
            label: r.get::<_, String>(0)?,
            value: money(r.get::<_, f64>(1)?),
            count: r.get::<_, i64>(2)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn recent_movements(conn: &Connection, limit: i64) -> AppResult<Vec<StockMovement>> {
    let mut stmt = conn.prepare(
        "SELECT id, ram_item_id, sku, quantity_change, previous_stock, new_stock, movement_type,
                reference_type, reference_id, reference_number, notes, created_at
           FROM stock_movements
          ORDER BY created_at DESC, rowid DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], super::stock::map_movement)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}