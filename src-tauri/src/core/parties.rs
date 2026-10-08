//! Buyers and sellers. Both are "parties" with an opposite balance sign, so the
//! logic is shared behind [`PartyKind`].

use crate::error::{AppError, AppResult};
use crate::models::{Party, PartyInput, Statement, StatementLine};
use crate::util::{money, new_id, now, validate_non_negative, validate_required};
use rusqlite::{Connection, Transaction};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartyKind {
    Buyer,
    Seller,
}

impl PartyKind {
    pub fn table(self) -> &'static str {
        match self {
            PartyKind::Buyer => "buyers",
            PartyKind::Seller => "sellers",
        }
    }
    pub fn code_column(self) -> &'static str {
        match self {
            PartyKind::Buyer => "customer_id",
            PartyKind::Seller => "supplier_id",
        }
    }
    pub fn code_prefix(self) -> &'static str {
        match self {
            PartyKind::Buyer => "CUST",
            PartyKind::Seller => "SUP",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            PartyKind::Buyer => "Buyer",
            PartyKind::Seller => "Seller",
        }
    }
    /// Column in `sales` / `purchases` that references this party.
    pub fn doc_column(self) -> &'static str {
        match self {
            PartyKind::Buyer => "buyer_id",
            PartyKind::Seller => "seller_id",
        }
    }
    pub fn doc_name_column(self) -> &'static str {
        match self {
            PartyKind::Buyer => "buyer_name",
            PartyKind::Seller => "seller_name",
        }
    }
    /// Table holding the party's documents.
    pub fn doc_table(self) -> &'static str {
        match self {
            PartyKind::Buyer => "sales",
            PartyKind::Seller => "purchases",
        }
    }
    pub fn payment_types(self) -> &'static [&'static str] {
        match self {
            PartyKind::Buyer => &[crate::models::PAY_RECEIVE_BUYER],
            PartyKind::Seller => &[crate::models::PAY_PAY_SELLER],
        }
    }
    pub fn is_sales(self) -> bool {
        matches!(self, PartyKind::Buyer)
    }
}

const PARTY_COLUMNS: &str = "id, CODECOL, company_name, contact_person, phone, whatsapp, email,
     address, city, trn_vat, notes, opening_balance, current_balance, total_purchases,
     total_paid, total_outstanding, is_archived, created_at, updated_at";

fn sql_with(kind: PartyKind, body: &str) -> String {
    body.replace("CODECOL", kind.code_column())
        .replace("PARTYTABLE", kind.table())
}

fn map_party(r: &rusqlite::Row<'_>) -> rusqlite::Result<Party> {
    Ok(Party {
        id: r.get(0)?,
        code: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
        company_name: r.get(2)?,
        contact_person: r.get(3)?,
        phone: r.get(4)?,
        whatsapp: r.get(5)?,
        email: r.get(6)?,
        address: r.get(7)?,
        city: r.get(8)?,
        trn_vat: r.get(9)?,
        notes: r.get(10)?,
        opening_balance: r.get(11)?,
        current_balance: r.get(12)?,
        total_purchases: r.get(13)?,
        total_paid: r.get(14)?,
        total_outstanding: r.get(15)?,
        is_archived: r.get(16)?,
        // Filled in by `attach_usage` once the row is read.
        transaction_count: 0,
        last_activity: None,
        created_at: r.get(17)?,
        updated_at: r.get(18)?,
    })
}

fn attach_usage(conn: &Connection, kind: PartyKind, mut parties: Vec<Party>) -> AppResult<Vec<Party>> {
    let doc_table = kind.doc_table();
    let doc_col = kind.doc_column();
    let date_col = kind.doc_table_date_column();

    let mut stmt = conn.prepare(&format!(
        "SELECT {doc_col}, COUNT(*), MAX({date_col})
           FROM {doc_table} WHERE {doc_col} IS NOT NULL GROUP BY {doc_col}"
    ))?;

    let usage: std::collections::HashMap<String, (i64, Option<String>)> = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?)))
        })?
        .collect::<Result<_, _>>()?;

    for p in parties.iter_mut() {
        if let Some((count, last)) = usage.get(&p.id) {
            p.transaction_count = *count;
            p.last_activity = last.clone();
        }
    }
    Ok(parties)
}

impl PartyKind {
    pub(crate) fn doc_table_date_column(self) -> &'static str {
        match self {
            PartyKind::Buyer => "sale_date",
            PartyKind::Seller => "purchase_date",
        }
    }
}

// ================================================================== read ===

pub fn list(conn: &Connection, kind: PartyKind, search: &str, include_archived: bool) -> AppResult<Vec<Party>> {
    let mut where_parts: Vec<String> = Vec::new();
    if !include_archived {
        where_parts.push("is_archived = 0".into());
    }
    let q = search.trim();
    if !q.is_empty() {
        where_parts.push(
            "(UPPER(company_name) LIKE ?1 OR UPPER(COALESCE(contact_person,'')) LIKE ?1
              OR COALESCE(phone,'') LIKE ?1 OR COALESCE(whatsapp,'') LIKE ?1
              OR COALESCE(email,'') LIKE ?1 OR COALESCE(city,'') LIKE ?1
              OR COALESCE(CODECOL,'') LIKE ?1)"
                .replace("CODECOL", kind.code_column()),
        );
    }

    let mut sql = sql_with(kind, &format!("SELECT {PARTY_COLUMNS} FROM PARTYTABLE"));
    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }
    sql.push_str(" ORDER BY company_name COLLATE NOCASE ASC");

    let mut stmt = conn.prepare(&sql)?;
    // The `?1` placeholder only exists when a search term was supplied, so the
    // parameter must not be bound unconditionally.
    let parties: Vec<Party> = if q.is_empty() {
        stmt.query_map([], map_party)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        let pattern = format!("%{q}%");
        stmt.query_map(rusqlite::params![pattern], map_party)?
            .collect::<Result<Vec<_>, _>>()?
    };
    drop(stmt);
    attach_usage(conn, kind, parties)
}

pub fn get(conn: &Connection, kind: PartyKind, id: &str) -> AppResult<Party> {
    let party = conn
        .query_row(
            &sql_with(kind, &format!("SELECT {PARTY_COLUMNS} FROM PARTYTABLE WHERE id = ?1")),
            [id],
            |r| map_party(r),
        )
        .map_err(|_| AppError::not_found(format!("{} not found.", kind.label())))?;

    attach_usage(conn, kind, vec![party])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::not_found(format!("{} not found.", kind.label())))
}

pub fn find_by_name(conn: &Connection, kind: PartyKind, name: &str) -> Option<Party> {
    let pattern = name.trim();
    if pattern.is_empty() {
        return None;
    }
    conn.query_row(
        &sql_with(
            kind,
            &format!("SELECT {PARTY_COLUMNS} FROM PARTYTABLE WHERE company_name = ?1 COLLATE NOCASE"),
        ),
        [pattern],
        |r| map_party(r),
    )
    .ok()
}

pub fn search(conn: &Connection, kind: PartyKind, query: &str, limit: i64) -> AppResult<Vec<Party>> {
    let limit = limit.clamp(1, 100);
    let mut all = list(conn, kind, query, false)?;
    all.truncate(limit as usize);
    Ok(all)
}

// ================================================================= write ===

fn next_code(conn: &Connection, kind: PartyKind) -> AppResult<String> {
    let column = kind.code_column();
    let sql = sql_with(
        kind,
        &format!("SELECT {column} FROM PARTYTABLE ORDER BY {column} DESC LIMIT 1"),
    );
    // `None` means "no rows yet"; a real SQL error would also surface as None
    // here, so the query itself is kept valid by going through `sql_with`.
    let last: Option<String> = conn.query_row(&sql, [], |r| r.get::<_, String>(0)).ok();
    let n: i64 = match last {
        Some(v) => v.rsplit('-').next().and_then(|s| s.parse().ok()).unwrap_or(0),
        None => 0,
    };
    Ok(format!("{}-{:04}", kind.code_prefix(), n + 1))
}

/// A company name identifies one trading partner, so it must stay unique
/// (case-insensitively) across the whole list. Every lookup by name - the
/// "+ New" flow on the buy/sell screens, `find_by_name` above - depends on it.
fn ensure_name_free(
    conn: &Connection,
    kind: PartyKind,
    company: &str,
    except_id: Option<&str>,
) -> AppResult<()> {
    if let Some(existing) = find_by_name(conn, kind, company) {
        if except_id != Some(existing.id.as_str()) {
            return Err(AppError::conflict(format!(
                "{} '{}' already exists. Open the existing record instead of adding a duplicate.",
                kind.label(),
                company
            )));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, kind: PartyKind, input: &PartyInput) -> AppResult<Party> {
    let company = validate_required(&input.company_name, "Company name")?;
    let opening = validate_non_negative(input.opening_balance, "Opening balance")?;
    ensure_name_free(conn, kind, &company, None)?;
    let code = match input.code.as_ref().filter(|c| !c.trim().is_empty()) {
        Some(c) => c.trim().to_uppercase(),
        None => next_code(conn, kind)?,
    };

    let id = new_id();
    let ts = now();
    conn.execute(
        &sql_with(
            kind,
            "INSERT INTO PARTYTABLE
                   (id, CODECOL, company_name, contact_person, phone, whatsapp, email,
                    address, city, trn_vat, notes, opening_balance, current_balance,
                    total_purchases, total_paid, total_outstanding, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, 0, ?12, ?14, ?14)",
        ),
        rusqlite::params![
            id, code, company, input.contact_person, input.phone, input.whatsapp,
            input.email, input.address, input.city, input.trn_vat, input.notes,
            opening, opening, ts
        ],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(_, Some(m)) if m.contains("UNIQUE") => {
            AppError::conflict(format!("The code {code} is already in use."))
        }
        other => AppError::from(other),
    })?;

    super::audit::write(
        conn,
        "CREATE",
        kind.label().to_uppercase().as_str(),
        Some(id.as_str()),
        &format!("Created {} {company}", kind.label().to_lowercase()),
    )?;

    get(conn, kind, &id)
}

pub fn update(conn: &Connection, kind: PartyKind, id: &str, input: &PartyInput) -> AppResult<Party> {
    let existing = get(conn, kind, id)?;
    let company = validate_required(&input.company_name, "Company name")?;
    let opening = validate_non_negative(input.opening_balance, "Opening balance")?;
    ensure_name_free(conn, kind, &company, Some(id))?;

    let code = match input.code.as_ref().filter(|c| !c.trim().is_empty()) {
        Some(c) => c.trim().to_uppercase(),
        None => existing.code.clone(),
    };

    conn.execute(
        &sql_with(
            kind,
            "UPDATE PARTYTABLE SET CODECOL = ?2, company_name = ?3, contact_person = ?4,
                    phone = ?5, whatsapp = ?6, email = ?7, address = ?8, city = ?9, trn_vat = ?10,
                    notes = ?11, updated_at = ?12
                  WHERE id = ?1",
        ),
        rusqlite::params![
            id, code, company, input.contact_person, input.phone, input.whatsapp,
            input.email, input.address, input.city, input.trn_vat, input.notes, now()
        ],
    )?;

    // Changing the opening balance must not corrupt the running balance; it is
    // treated as a documented adjustment instead.
    let delta = opening - existing.opening_balance;
    if delta.abs() > 0.005 {
        apply_balance(
            conn,
            kind,
            id,
            delta,
            delta.max(0.0),
            0.0,
        )?;
    }

    super::audit::write(
        conn,
        "UPDATE",
        kind.label().to_uppercase().as_str(),
        Some(id),
        &format!("Updated {}", existing.company_name),
    )?;

    get(conn, kind, id)
}

pub fn set_archived(conn: &Connection, kind: PartyKind, id: &str, archived: bool) -> AppResult<Party> {
    let party = get(conn, kind, id)?;
    conn.execute(
        &sql_with(kind, "UPDATE PARTYTABLE SET is_archived = ?2, updated_at = ?3 WHERE id = ?1"),
        rusqlite::params![id, archived as i64, now()],
    )?;
    super::audit::write(
        conn,
        if archived { "ARCHIVE" } else { "RESTORE" },
        kind.label().to_uppercase().as_str(),
        Some(id),
        &format!("{} {}", if archived { "Archived" } else { "Restored" }, party.company_name),
    )?;
    get(conn, kind, id)
}

pub fn delete(conn: &Connection, kind: PartyKind, id: &str) -> AppResult<()> {
    let party = get(conn, kind, id)?;
    if party.transaction_count > 0 {
        return Err(AppError::business(format!(
            "{} has {} transaction(s) and cannot be deleted. Archive it instead.",
            party.company_name, party.transaction_count
        )));
    }
    let n = conn.execute(
        &sql_with(kind, "DELETE FROM PARTYTABLE WHERE id = ?1"),
        [id],
    )?;
    if n == 0 {
        return Err(AppError::not_found(format!("{} not found.", kind.label())));
    }
    super::audit::write(
        conn,
        "DELETE",
        kind.label().to_uppercase().as_str(),
        Some(id),
        &format!("Deleted {}", party.company_name),
    )?;
    Ok(())
}

/// The single place a party balance changes.
///
/// * `balance_delta`  - signed change of `current_balance`
/// * `billed_delta`   - added to `total_purchases`
/// * `paid_delta`     - added to `total_paid`
pub fn apply_balance(
    conn: &Connection,
    kind: PartyKind,
    id: &str,
    balance_delta: f64,
    billed_delta: f64,
    paid_delta: f64,
) -> AppResult<()> {
    conn.execute(
        &sql_with(
            kind,
            "UPDATE PARTYTABLE SET
                current_balance   = ROUND(current_balance + ?2, 2),
                total_purchases   = ROUND(total_purchases + ?3, 2),
                total_paid        = ROUND(total_paid + ?4, 2),
                total_outstanding = ROUND(current_balance + ?2, 2),
                updated_at = ?5
              WHERE id = ?1",
        ),
        rusqlite::params![
            id,
            money(balance_delta),
            money(billed_delta),
            money(paid_delta),
            now()
        ],
    )?;
    Ok(())
}

/// Same as [`apply_balance`] but participates in a document transaction.
pub fn apply_balance_tx(
    tx: &Transaction,
    kind: PartyKind,
    id: &str,
    balance_delta: f64,
    billed_delta: f64,
    paid_delta: f64,
) -> AppResult<()> {
    tx.execute(
        &sql_with(
            kind,
            "UPDATE PARTYTABLE SET
                current_balance   = ROUND(current_balance + ?2, 2),
                total_purchases   = ROUND(total_purchases + ?3, 2),
                total_paid        = ROUND(total_paid + ?4, 2),
                total_outstanding = ROUND(current_balance + ?2, 2),
                updated_at = ?5
              WHERE id = ?1",
        ),
        rusqlite::params![
            id,
            money(balance_delta),
            money(billed_delta),
            money(paid_delta),
            now()
        ],
    )?;
    Ok(())
}

// ============================================================ statement ===

/// Account statement: documents increase the balance, payments reduce it.
pub fn statement(
    conn: &Connection,
    kind: PartyKind,
    id: &str,
    from: &str,
    to: &str,
) -> AppResult<Statement> {
    let party = get(conn, kind, id)?;
    let doc_table = kind.doc_table();
    let doc_col = kind.doc_column();
    let date_col = kind.doc_table_date_column();
    let number_col = if kind.is_sales() { "sale_number" } else { "purchase_number" };

    // Numbered placeholders are only emitted when the corresponding filter is
    // present, so the bind list has to grow in exactly the same order.
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    let push = |args: &mut Vec<rusqlite::types::Value>, v: &str| -> String {
        args.push(rusqlite::types::Value::Text(v.to_string()));
        format!("?{}", args.len())
    };

    let id_ph = push(&mut args, id);
    let from_ph = if from.is_empty() { None } else { Some(push(&mut args, from)) };
    let to_ph = if to.is_empty() { None } else { Some(push(&mut args, to)) };
    let kind_ph = push(&mut args, &kind.label().to_lowercase());

    let mut sql = format!(
        "SELECT {date_col} AS dt, {number_col} AS ref, 'Debit' AS side, total AS amt
           FROM {doc_table}
          WHERE {doc_col} = {id_ph} AND status <> 'void'"
    );
    if let Some(p) = &from_ph {
        sql.push_str(&format!(" AND {date_col} >= {p}"));
    }
    if let Some(p) = &to_ph {
        sql.push_str(&format!(" AND {date_col} <= {p}"));
    }
    sql.push_str(" UNION ALL ");
    sql.push_str(&format!(
        "SELECT payment_date, payment_id, 'Credit', amount
           FROM payments
          WHERE person_type = {kind_ph} AND person_id = {id_ph}"
    ));
    if let Some(p) = &from_ph {
        sql.push_str(&format!(" AND payment_date >= {p}"));
    }
    if let Some(p) = &to_ph {
        sql.push_str(&format!(" AND payment_date <= {p}"));
    }
    sql.push_str(" ORDER BY dt ASC, ref ASC");

    let mut rows = conn.prepare(&sql)?;
    let raw: Vec<(String, String, String, f64)> = rows
        .query_map(rusqlite::params_from_iter(args.iter()), |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut balance = party.opening_balance;
    let mut lines = Vec::with_capacity(raw.len());
    let mut total_debit = 0.0;
    let mut total_credit = 0.0;

    for (date, reference, side, amount) in raw {
        let (debit, credit) = if side == "Debit" {
            (money(amount), 0.0)
        } else {
            (0.0, money(amount))
        };
        balance = money(balance + debit - credit);
        total_debit += debit;
        total_credit += credit;
        lines.push(StatementLine {
            date,
            reference,
            description: if side == "Debit" {
                format!("{} invoice", if kind.is_sales() { "Sales" } else { "Purchase" })
            } else {
                "Payment received".into()
            },
            debit,
            credit,
            balance,
        });
    }

    Ok(Statement {
        party_id: party.id,
        party_name: party.company_name,
        code: party.code,
        opening_balance: money(party.opening_balance),
        total_debit: money(total_debit),
        total_credit: money(total_credit),
        closing_balance: money(balance),
        lines,
    })
}

// =============================================================== totals ===

pub fn outstanding(conn: &Connection, kind: PartyKind) -> AppResult<f64> {
    let v: f64 = conn.query_row(
        &sql_with(
            kind,
            "SELECT COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END), 0)
               FROM PARTYTABLE WHERE is_archived = 0",
        ),
        [],
        |r| r.get(0),
    )?;
    Ok(money(v))
}