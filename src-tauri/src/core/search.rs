//! Global search across inventory, parties, documents and payments.

use crate::error::AppResult;
use crate::models::SearchHit;
use crate::util::money;
use rusqlite::Connection;

/// The single search box in the top bar. Results are grouped by kind and capped
/// so the dropdown stays readable.
pub fn global(conn: &Connection, query: &str, limit: i64) -> AppResult<Vec<SearchHit>> {
    let q = query.trim();
    if q.len() < 2 {
        return Ok(Vec::new());
    }
    let per = limit.clamp(3, 20);
    let like = format!("%{q}%");
    let mut hits: Vec<SearchHit> = Vec::new();

    // --- inventory ------------------------------------------------------
    {
        let mut stmt = conn.prepare(
            "SELECT id, sku, generation || ' | ' || category || ' | ' || capacity || ' | ' || speed,
                    COALESCE(manufacturer, '')
               FROM ram_items
              WHERE is_archived = 0
                AND (UPPER(sku) LIKE ?1 OR UPPER(generation) LIKE ?1 OR UPPER(category) LIKE ?1
                     OR UPPER(capacity) LIKE ?1 OR UPPER(speed) LIKE ?1
                     OR UPPER(COALESCE(manufacturer,'')) LIKE ?1 OR UPPER(COALESCE(part_number,'')) LIKE ?1)
              ORDER BY CASE WHEN UPPER(sku) = ?2 THEN 0 ELSE 1 END, sku LIMIT ?3",
        )?;
        let rows = stmt.query_map(rusqlite::params![like, q.to_uppercase(), per], |r| {
            Ok(SearchHit {
                kind: "inventory".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get(2)?,
                meta: "RAM item".into(),
                route: format!("/inventory/{}", r.get::<_, String>(0)?),
            })
        })?;
        hits.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }

    // --- buyers ---------------------------------------------------------
    for (kind, route) in [("buyer", "/buyers"), ("seller", "/sellers")] {
        let table = if kind == "buyer" { "buyers" } else { "sellers" };
        let sql = format!(
            "SELECT id, company_name, COALESCE(contact_person,''), COALESCE(phone,''), current_balance
               FROM {table}
              WHERE is_archived = 0
                AND (UPPER(company_name) LIKE ?1 OR UPPER(COALESCE(contact_person,'')) LIKE ?1
                     OR COALESCE(phone,'') LIKE ?1 OR COALESCE(city,'') LIKE ?1)
              ORDER BY company_name LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params![like, per], |r| {
            let name: String = r.get(1)?;
            let balance: f64 = r.get(4)?;
            Ok(SearchHit {
                kind: kind.to_string(),
                id: r.get(0)?,
                title: name.clone(),
                subtitle: {
                    let c: String = r.get(2)?;
                    let p: String = r.get(3)?;
                    [c, p].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("  ")
                },
                meta: format!("Balance {}", money(balance)),
                route: format!("{route}/{}", r.get::<_, String>(0)?),
            })
        })?;
        hits.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }

    // --- purchases ------------------------------------------------------
    {
        let mut stmt = conn.prepare(
            "SELECT id, purchase_number, seller_name, purchase_date, total
               FROM purchases
              WHERE UPPER(purchase_number) LIKE ?1 OR UPPER(seller_name) LIKE ?1
              ORDER BY purchase_date DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![like, per], |r| {
            let total: f64 = r.get(4)?;
            Ok(SearchHit {
                kind: "purchase".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get(2)?,
                meta: format!("{}  {}", r.get::<_, String>(3)?, money(total)),
                route: format!("/purchases/{}", r.get::<_, String>(0)?),
            })
        })?;
        hits.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }

    // --- sales ----------------------------------------------------------
    {
        let mut stmt = conn.prepare(
            "SELECT id, sale_number, buyer_name, sale_date, total
               FROM sales
              WHERE UPPER(sale_number) LIKE ?1 OR UPPER(buyer_name) LIKE ?1
              ORDER BY sale_date DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![like, per], |r| {
            let total: f64 = r.get(4)?;
            Ok(SearchHit {
                kind: "sale".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get(2)?,
                meta: format!("{}  {}", r.get::<_, String>(3)?, money(total)),
                route: format!("/sales/{}", r.get::<_, String>(0)?),
            })
        })?;
        hits.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }

    // --- payments -------------------------------------------------------
    {
        let mut stmt = conn.prepare(
            "SELECT id, payment_id, person_name, payment_type, amount, payment_date
               FROM payments
              WHERE voided_at IS NULL
                AND (UPPER(payment_id) LIKE ?1 OR UPPER(person_name) LIKE ?1
                     OR UPPER(COALESCE(reference,'')) LIKE ?1)
              ORDER BY payment_date DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![like, per], |r| {
            let amount: f64 = r.get(4)?;
            Ok(SearchHit {
                kind: "payment".into(),
                id: r.get(0)?,
                title: r.get(1)?,
                subtitle: r.get(2)?,
                meta: format!("{}  {}", money(amount), r.get::<_, String>(5)?),
                route: "/payments".into(),
            })
        })?;
        hits.extend(rows.collect::<Result<Vec<_>, _>>()?);
    }

    Ok(hits)
}