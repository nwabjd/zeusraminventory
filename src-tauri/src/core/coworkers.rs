//! Coworker ledger: money lent to and borrowed from colleagues.
//!
//! `current_balance > 0` means they owe us; `< 0` means we owe them.
//!
//! A repayment always moves the balance *towards zero*, whichever side it is
//! currently on. That is the rule a shop owner expects and it makes the ledger
//! self-correcting.

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::util::{money, new_id, normalise_date, now, validate_positive, validate_required};
use rusqlite::{Connection, Transaction};

const CW_COLUMNS: &str = "id, name, phone, current_balance, notes, is_archived, created_at, updated_at";

fn map_coworker(r: &rusqlite::Row<'_>) -> rusqlite::Result<Coworker> {
    Ok(Coworker {
        id: r.get(0)?,
        name: r.get(1)?,
        phone: r.get(2)?,
        current_balance: r.get(3)?,
        notes: r.get(4)?,
        is_archived: r.get(5)?,
        total_lent: 0.0,
        total_borrowed: 0.0,
        total_repaid: 0.0,
        transaction_count: 0,
        last_activity: None,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn map_txn(r: &rusqlite::Row<'_>) -> rusqlite::Result<CoworkerTransaction> {
    Ok(CoworkerTransaction {
        id: r.get(0)?,
        coworker_id: r.get(1)?,
        coworker_name: r.get(9)?,
        kind: r.get(2)?,
        amount: r.get(3)?,
        balance_after: r.get(4)?,
        method: r.get(5)?,
        notes: r.get(6)?,
        txn_date: r.get(7)?,
        created_at: r.get(8)?,
    })
}

const TXN_COLUMNS: &str = "t.id, t.coworker_id, t.type, t.amount, t.balance_after, t.method,
     t.notes, t.txn_date, t.created_at, c.name";

// ================================================================== read ===

fn attach_stats(conn: &Connection, mut rows: Vec<Coworker>) -> AppResult<Vec<Coworker>> {
    let mut stmt = conn.prepare(
        "SELECT coworker_id,
                COALESCE(SUM(CASE WHEN type = 'LEND' THEN amount ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN type = 'BORROW' THEN amount ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN type = 'REPAYMENT' THEN amount ELSE 0 END), 0),
                COUNT(*), MAX(txn_date)
           FROM coworker_transactions GROUP BY coworker_id",
    )?;
    let stats: std::collections::HashMap<String, (f64, f64, f64, i64, Option<String>)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?, r.get::<_, i64>(4)?, r.get::<_, Option<String>>(5)?),
            ))
        })?
        .collect::<Result<_, _>>()?;

    for c in rows.iter_mut() {
        if let Some((lent, borrowed, repaid, count, last)) = stats.get(&c.id) {
            c.total_lent = money(*lent);
            c.total_borrowed = money(*borrowed);
            c.total_repaid = money(*repaid);
            c.transaction_count = *count;
            c.last_activity = last.clone();
        }
    }
    Ok(rows)
}

pub fn list(conn: &Connection, search: &str, include_archived: bool) -> AppResult<Vec<Coworker>> {
    let mut sql = format!("SELECT {CW_COLUMNS} FROM coworkers");
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    let mut clauses: Vec<String> = Vec::new();
    if !include_archived {
        clauses.push("is_archived = 0".into());
    }
    let q = search.trim();
    if !q.is_empty() {
        args.push(rusqlite::types::Value::Text(format!("%{q}%")));
        let n = args.len();
        clauses.push(format!(
            "(UPPER(name) LIKE ?{n} OR COALESCE(phone,'') LIKE ?{n} OR COALESCE(notes,'') LIKE ?{n})"
        ));
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY ABS(current_balance) DESC, name COLLATE NOCASE ASC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_coworker)?;
    let collected: Vec<Coworker> = rows.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    attach_stats(conn, collected)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Coworker> {
    let c = conn
        .query_row(
            &format!("SELECT {CW_COLUMNS} FROM coworkers WHERE id = ?1"),
            [id],
            map_coworker,
        )
        .map_err(|_| AppError::not_found("Coworker not found."))?;
    attach_stats(conn, vec![c])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::not_found("Coworker not found."))
}

pub fn find_by_name(conn: &Connection, name: &str) -> Option<Coworker> {
    conn.query_row(
        &format!("SELECT {CW_COLUMNS} FROM coworkers WHERE name = ?1 COLLATE NOCASE"),
        [name.trim()],
        map_coworker,
    )
    .ok()
}

pub fn transactions(conn: &Connection, coworker_id: &str, from: &str, to: &str) -> AppResult<Vec<CoworkerTransaction>> {
    // Bind only what the SQL actually references: an optional filter must not be
    // bound when its placeholder was never emitted.
    let mut sql = format!(
        "SELECT {TXN_COLUMNS} FROM coworker_transactions t
           JOIN coworkers c ON c.id = t.coworker_id WHERE t.coworker_id = ?1"
    );
    let mut args: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Text(coworker_id.to_string())];
    if !from.is_empty() {
        args.push(rusqlite::types::Value::Text(from.to_string()));
        sql.push_str(&format!(" AND t.txn_date >= ?{}", args.len()));
    }
    if !to.is_empty() {
        args.push(rusqlite::types::Value::Text(to.to_string()));
        sql.push_str(&format!(" AND t.txn_date <= ?{}", args.len()));
    }
    sql.push_str(" ORDER BY t.txn_date DESC, t.created_at DESC, t.rowid DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_txn)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn all_transactions(conn: &Connection, from: &str, to: &str) -> AppResult<Vec<CoworkerTransaction>> {
    let mut sql = format!(
        "SELECT {TXN_COLUMNS} FROM coworker_transactions t
           JOIN coworkers c ON c.id = t.coworker_id WHERE 1 = 1"
    );
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if !from.is_empty() {
        args.push(rusqlite::types::Value::Text(from.to_string()));
        sql.push_str(&format!(" AND t.txn_date >= ?{}", args.len()));
    }
    if !to.is_empty() {
        args.push(rusqlite::types::Value::Text(to.to_string()));
        sql.push_str(&format!(" AND t.txn_date <= ?{}", args.len()));
    }
    sql.push_str(" ORDER BY t.txn_date DESC, t.created_at DESC, t.rowid DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_txn)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn totals(conn: &Connection) -> AppResult<CoworkerTotals> {
    let (receivable, payable, coworker_count, txn_count): (f64, f64, i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN current_balance < 0 THEN ABS(current_balance) ELSE 0 END), 0),
                COUNT(*),
                (SELECT COUNT(*) FROM coworker_transactions)
           FROM coworkers WHERE is_archived = 0",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    Ok(CoworkerTotals {
        receivable: money(receivable),
        payable: money(payable),
        net: money(receivable - payable),
        coworker_count,
        transaction_count: txn_count,
    })
}

// ================================================================= write ===

pub fn create(conn: &Connection, name: &str, phone: Option<&str>, notes: Option<&str>) -> AppResult<Coworker> {
    let name = validate_required(name, "Name")?;
    if find_by_name(conn, &name).is_some() {
        return Err(AppError::conflict(format!("'{name}' already exists in the coworker ledger.")));
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO coworkers (id, name, phone, current_balance, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5)",
        rusqlite::params![id, name, phone, notes, now()],
    )?;
    super::audit::write(conn, "CREATE", "COWORKER", Some(id.as_str()), &format!("Added coworker {name}"))?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, name: &str, phone: Option<&str>, notes: Option<&str>) -> AppResult<Coworker> {
    let existing = get(conn, id)?;
    let name = validate_required(name, "Name")?;
    if find_by_name(conn, &name).is_some_and(|c| c.id != existing.id) {
        return Err(AppError::conflict(format!("Another coworker is already named '{name}'.")));
    }
    conn.execute(
        "UPDATE coworkers SET name = ?2, phone = ?3, notes = ?4, updated_at = ?5 WHERE id = ?1",
        rusqlite::params![id, name, phone, notes, now()],
    )?;
    super::audit::write(conn, "UPDATE", "COWORKER", Some(id), &format!("Updated coworker {name}"))?;
    get(conn, id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> AppResult<Coworker> {
    get(conn, id)?;
    conn.execute(
        "UPDATE coworkers SET is_archived = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, archived as i64, now()],
    )?;
    get(conn, id)
}

/// Resolves (or lazily creates) a coworker by name.
fn ensure_by_name(conn: &Connection, name: &str, phone: Option<&str>) -> AppResult<Coworker> {
    if let Some(c) = find_by_name(conn, name) {
        return Ok(c);
    }
    create(conn, name, phone, None)
}

fn payment_type_for(kind: &str) -> &'static str {
    match kind {
        "LEND" => crate::models::PAY_COWORKER_LEND,
        "BORROW" => crate::models::PAY_COWORKER_BORROW,
        _ => crate::models::PAY_COWORKER_RECEIVE,
    }
}

/// Applies one ledger movement. `kind` is `LEND`, `BORROW` or `REPAYMENT`.
fn post(
    tx: &Transaction,
    coworker_id: &str,
    coworker_name: &str,
    kind: &str,
    amount: f64,
    method: &str,
    notes: Option<&str>,
    date: &str,
) -> AppResult<CoworkerTransaction> {
    let current: f64 = tx
        .query_row(
            "SELECT current_balance FROM coworkers WHERE id = ?1",
            [coworker_id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::not_found("Coworker not found."))?;

    let next = match kind {
        "LEND" => current + amount, // they owe us more
        "BORROW" => current - amount, // we owe them more
        // A repayment always settles part of what is outstanding and can never
        // exceed it, so the balance cannot flip to the other side by accident.
        "REPAYMENT" => {
            if amount > current.abs() + 0.005 {
                return Err(AppError::business(format!(
                    "Repayment of {} is more than the outstanding {} with {coworker_name}.",
                    crate::util::money(amount),
                    crate::util::money(current.abs())
                )));
            }
            let sign = if current >= 0.0 { 1.0 } else { -1.0 };
            money(current - sign * amount)
        }
        other => return Err(AppError::validation(format!("Unknown coworker entry type '{other}'."))),
    };

    tx.execute(
        "UPDATE coworkers SET current_balance = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![coworker_id, money(next), now()],
    )?;

    let txn_id = new_id();
    let number = crate::util::next_doc_number_tx(tx, "PAY", "payments", "payment_id")?;
    tx.execute(
        "INSERT INTO coworker_transactions
           (id, coworker_id, type, amount, balance_after, method, notes, txn_date, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![txn_id, coworker_id, kind, money(amount), money(next), method, notes, date, now()],
    )?;

    super::payments::insert_tx(
        tx,
        payment_type_for(kind),
        "coworker",
        Some(coworker_id),
        coworker_name,
        amount,
        method,
        Some(number.as_str()),
        notes,
        date,
    )?;

    let verb = match kind {
        "LEND" => "Lent",
        "BORROW" => "Borrowed",
        _ => "Received repayment from",
    };
    super::log(
        tx,
        "CREATE",
        "COWORKER_TRANSACTION",
        Some(coworker_id),
        &format!("{verb} {} {} {}", crate::util::money(amount), method, coworker_name),
    );

    Ok(CoworkerTransaction {
        id: txn_id,
        coworker_id: coworker_id.to_string(),
        coworker_name: coworker_name.to_string(),
        kind: kind.to_string(),
        amount: money(amount),
        balance_after: money(next),
        method: Some(method.to_string()),
        notes: notes.map(|s| s.to_string()),
        txn_date: date.to_string(),
        created_at: now(),
    })
}

/// Lend / borrow / repay - the three actions on the Coworker Ledger page.
pub fn record(conn: &mut Connection, input: &CoworkerInput) -> AppResult<CoworkerTransaction> {
    let amount = validate_positive(input.amount, "Amount")?;
    let kind = input.kind.trim().to_uppercase();
    if !matches!(kind.as_str(), "LEND" | "BORROW" | "REPAYMENT") {
        return Err(AppError::validation("Entry type must be Lend, Borrow or Repayment."));
    }
    let method = input.method.clone().unwrap_or_else(|| "Cash".into());
    let date = normalise_date(input.txn_date.as_deref().unwrap_or(""))?;

    let coworker = match input.coworker_id.as_ref().filter(|s| !s.is_empty()) {
        Some(id) => get(conn, id)?,
        None => {
            let name = validate_required(input.name.as_deref().unwrap_or(""), "Coworker name")?;
            if kind == "REPAYMENT" && find_by_name(conn, &name).is_none() {
                return Err(AppError::not_found(format!("'{name}' has no ledger to repay.")));
            }
            ensure_by_name(conn, &name, None)?
        }
    };

    if kind == "REPAYMENT" && coworker.current_balance.abs() < 0.005 {
        return Err(AppError::business(format!(
            "{} is already settled - there is nothing to repay.",
            coworker.name
        )));
    }

    let tx = conn.transaction()?;
    let txn = post(
        &tx,
        &coworker.id,
        &coworker.name,
        &kind,
        amount,
        &method,
        input.notes.as_deref(),
        &date,
    )?;
    tx.commit()?;

    Ok(txn)
}

/// Entry point used by the Payments page when the type is a coworker one.
pub fn record_tx_as_payment(
    conn: &mut Connection,
    kind: &str,
    name: &str,
    amount: f64,
    method: &str,
    date: &str,
    notes: Option<&str>,
) -> AppResult<CoworkerTransaction> {
    let coworker = ensure_by_name(conn, name, None)?;
    let tx = conn.transaction()?;
    let txn = post(&tx, &coworker.id, &coworker.name, kind, amount, method, notes, date)?;
    tx.commit()?;
    Ok(txn)
}