//! Payment ledger.
//!
//! A payment always has a direction:
//!
//! | type                  | person   | effect on balance        |
//! |-----------------------|----------|-------------------------|
//! | `RECEIVE_FROM_BUYER`  | buyer    | decreases what is owed  |
//! | `PAY_SELLER`          | seller   | decreases what we owe   |
//! | `COWORKER_LEND`       | coworker | increases what they owe |
//! | `COWORKER_RECEIVE`    | coworker | decreases what they owe|
//! | `COWORKER_BORROW`     | coworker | increases what we owe   |
//! | `COWORKER_REPAY`      | coworker | decreases what we owe   |

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::core::parties::PartyKind;
use crate::util::{money, new_id, normalise_date, now, validate_required};
use rusqlite::{Connection, Transaction};

pub fn map_payment(r: &rusqlite::Row<'_>) -> rusqlite::Result<Payment> {
    let voided_at: Option<String> = r.get(12)?;
    Ok(Payment {
        id: r.get(0)?,
        payment_id: r.get(1)?,
        payment_type: r.get(2)?,
        person_type: r.get(3)?,
        person_id: r.get(4)?,
        person_name: r.get(5)?,
        amount: r.get(6)?,
        payment_method: r.get(7)?,
        reference: r.get(8)?,
        notes: r.get(9)?,
        payment_date: r.get(10)?,
        voided_at: voided_at.clone(),
        void_reason: r.get(13)?,
        status: if voided_at.is_some() { "void".into() } else { "completed".into() },
        created_at: r.get(11)?,
    })
}

const COLUMNS: &str = "id, payment_id, payment_type, person_type, person_id, person_name, amount,
     payment_method, reference, notes, payment_date, created_at, voided_at, void_reason";

#[derive(Debug, Clone, Default)]
pub struct PaymentFilter {
    pub search: String,
    pub payment_type: Option<String>,
    pub person_type: Option<String>,
    pub person_id: Option<String>,
    pub method: Option<String>,
    /// `completed` | `void`
    pub status: Option<String>,
    pub from: String,
    pub to: String,
    pub limit: Option<i64>,
}

fn is_coworker(payment_type: &str) -> bool {
    matches!(
        payment_type,
        PAY_COWORKER_LEND | PAY_COWORKER_RECEIVE | PAY_COWORKER_BORROW | PAY_COWORKER_REPAY
    )
}

pub fn person_type_of(payment_type: &str) -> &'static str {
    if is_coworker(payment_type) {
        "coworker"
    } else if payment_type == PAY_PAY_SELLER {
        "seller"
    } else {
        "buyer"
    }
}

/// Signed effect on the party's outstanding balance.
fn balance_effect(payment_type: &str, amount: f64) -> f64 {
    match payment_type {
        // money in from a buyer, or paid out to a seller -> both reduce owing
        PAY_RECEIVE_BUYER | PAY_PAY_SELLER => -amount,
        // we hand cash to a coworker -> they owe us more
        PAY_COWORKER_LEND => amount,
        // they give cash back, or we borrow from them -> our owing falls
        PAY_COWORKER_RECEIVE | PAY_COWORKER_BORROW => -amount,
        // we settle what we owed them -> our owing falls
        PAY_COWORKER_REPAY => -amount,
        _ => 0.0,
    }
}

pub fn list(conn: &Connection, f: &PaymentFilter) -> AppResult<Vec<Payment>> {
    let mut where_parts: Vec<String> = Vec::new();
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    macro_rules! push {
        ($cond:expr, $val:expr) => {{
            args.push($val);
            where_parts.push($cond.replace('?', &format!("?{}", args.len())));
        }};
    }

    let q = f.search.trim();
    if !q.is_empty() {
        let like = format!("%{q}%");
        args.push(rusqlite::types::Value::Text(like.clone()));
        let n = args.len();
        where_parts.push(format!(
            "(UPPER(person_name) LIKE ?{n} OR UPPER(payment_id) LIKE ?{n} \
              OR UPPER(COALESCE(reference,'')) LIKE ?{n} OR UPPER(COALESCE(notes,'')) LIKE ?{n})"
        ));
    }
    if let Some(t) = f.payment_type.as_ref().filter(|s| !s.is_empty() && *s != "all") {
        push!("payment_type = ?", rusqlite::types::Value::Text(t.clone()));
    }
    if let Some(t) = f.person_type.as_ref().filter(|s| !s.is_empty() && *s != "all") {
        push!("person_type = ?", rusqlite::types::Value::Text(t.clone()));
    }
    if let Some(t) = f.person_id.as_ref().filter(|s| !s.is_empty()) {
        push!("person_id = ?", rusqlite::types::Value::Text(t.clone()));
    }
    if let Some(t) = f.method.as_ref().filter(|s| !s.is_empty() && *s != "all") {
        push!("payment_method = ?", rusqlite::types::Value::Text(t.clone()));
    }
    if let Some(s) = f.status.as_ref().filter(|s| !s.is_empty() && *s != "all") {
        if s == "void" {
            where_parts.push("voided_at IS NOT NULL".into());
        } else if s == "completed" {
            where_parts.push("voided_at IS NULL".into());
        }
    }
    if !f.from.is_empty() {
        push!("payment_date >= ?", rusqlite::types::Value::Text(f.from.clone()));
    }
    if !f.to.is_empty() {
        push!("payment_date <= ?", rusqlite::types::Value::Text(f.to.clone()));
    }

    let mut sql = format!("SELECT {COLUMNS} FROM payments");
    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }
    sql.push_str(" ORDER BY payment_date DESC, created_at DESC, rowid DESC");
    if let Some(l) = f.limit {
        sql.push_str(&format!(" LIMIT {l}"));
    }

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), map_payment)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Payment> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM payments WHERE id = ?1"),
        [id],
        map_payment,
    )
    .map_err(|_| AppError::not_found("Payment not found."))
}

pub fn count_for(conn: &Connection, payment_type: &str, person_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM payments
          WHERE payment_type = ?1 AND person_id = ?2 AND voided_at IS NULL",
        rusqlite::params![payment_type, person_id],
        |r| r.get(0),
    )?)
}

// ================================================================== write ===

/// Writes a payment row and applies its effect. Used inside a document
/// transaction.
pub fn insert_tx(
    tx: &Transaction,
    payment_type: &str,
    person_type: &str,
    person_id: Option<&str>,
    person_name: &str,
    amount: f64,
    method: &str,
    reference: Option<&str>,
    notes: Option<&str>,
    payment_date: &str,
) -> AppResult<String> {
    let id = new_id();
    let number = crate::util::next_doc_number_tx(tx, "PAY", "payments", "payment_id")?;
    tx.execute(
        "INSERT INTO payments
           (id, payment_id, payment_type, person_type, person_id, person_name, amount,
            payment_method, reference, notes, payment_date, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        rusqlite::params![
            id, number, payment_type, person_type, person_id, person_name,
            money(amount), method, reference, notes, payment_date, now()
        ],
    )?;
    Ok(id)
}

/// Standalone payment ("Receive Payment" / "Pay Seller" / coworker actions).
pub fn record(conn: &mut Connection, input: &PaymentInput) -> AppResult<Payment> {
    let amount = crate::util::validate_positive(input.amount, "Amount")?;
    let payment_type = input.payment_type.trim().to_uppercase();
    if balance_effect(&payment_type, 1.0) == 0.0 && !is_coworker(&payment_type) {
        return Err(AppError::validation(format!("Unknown payment type '{}'.", input.payment_type)));
    }

    let method = input.payment_method.clone().unwrap_or_else(|| "Cash".into());
    let date = normalise_date(input.payment_date.as_deref().unwrap_or(""))?;
    let person_type = person_type_of(&payment_type).to_string();

    // Coworker money movement has its own ledger; delegate it.
    if is_coworker(&payment_type) {
        let kind = match payment_type.as_str() {
            PAY_COWORKER_LEND => "LEND",
            PAY_COWORKER_BORROW => "BORROW",
            _ => "REPAYMENT",
        };
        let name = validate_required(
            input.person_name.as_deref().unwrap_or(""),
            "Coworker name",
        )?;
        return super::coworkers::record_tx_as_payment(conn, kind, &name, amount, &method, &date, input.notes.as_deref())
            .and_then(|_| {
                // Return the payment row that was just created.
                let p = conn
                    .query_row(
                        &format!("SELECT {COLUMNS} FROM payments ORDER BY rowid DESC LIMIT 1"),
                        [],
                        map_payment,
                    )?;
                Ok(p)
            });
    }

    let kind = if person_type == "seller" { PartyKind::Seller } else { PartyKind::Buyer };

    let (person_id, person_name) = resolve_party(conn, kind, input, &payment_type)?;
    let party = super::parties::get(conn, kind, &person_id)?;

    let effect = balance_effect(&payment_type, amount);
    let resulting = money(party.current_balance + effect);

    if !input.allow_overpayment && effect < 0.0 && resulting < -0.005 {
        return Err(AppError::business(format!(
            "Payment of {} exceeds the outstanding balance of {} for {}.",
            crate::util::money(amount),
            crate::util::money(party.current_balance),
            party.company_name
        )));
    }

    let tx = conn.transaction()?;

    let payment_id = insert_tx(
        &tx,
        &payment_type,
        &person_type,
        Some(person_id.as_str()),
        &person_name,
        amount,
        &method,
        input.reference.as_deref(),
        input.notes.as_deref(),
        &date,
    )?;

    super::parties::apply_balance_tx(
        &tx,
        kind,
        &person_id,
        effect,
        0.0,
        if person_type == "seller" || person_type == "buyer" { amount } else { 0.0 },
    )?;

    super::log(
        &tx,
        "CREATE",
        "PAYMENT",
        Some(payment_id.as_str()),
        &format!("{payment_type} {} to {}", crate::util::money(amount), person_name),
    );

    tx.commit()?;
    get(conn, &payment_id)
}

fn resolve_party(
    conn: &Connection,
    kind: PartyKind,
    input: &PaymentInput,
    _payment_type: &str,
) -> AppResult<(String, String)> {
    if let Some(id) = input.person_id.as_ref().filter(|s| !s.is_empty()) {
        let party = super::parties::get(conn, kind, id)?;
        return Ok((party.id, party.company_name));
    }
    let name = validate_required(input.person_name.as_deref().unwrap_or(""), "Person")?;
    let existing = super::parties::find_by_name(conn, kind, &name)
        .ok_or_else(|| AppError::not_found(format!("No {} named '{}'.", kind.label().to_lowercase(), name)))?;
    Ok((existing.id, existing.company_name))
}

/// Reverses a standalone payment and restores the previous balance.
///
/// Payments generated by a purchase or sale cannot be reversed on their own -
/// void the document instead - because the document still reports the amount.
pub fn reverse(conn: &Connection, id: &str, reason: &str) -> AppResult<Payment> {
    let payment = get(conn, id)?;
    if payment.status == "void" {
        return Err(AppError::business("This payment has already been reversed."));
    }
    if let Some(reference) = payment.reference.as_deref() {
        if reference.starts_with("PUR-") || reference.starts_with("SAL-") {
            return Err(AppError::business(format!(
                "This payment was generated by {reference}. Void that document instead."
            )));
        }
    }

    let kind = match payment.person_type.as_str() {
        "seller" => PartyKind::Seller,
        "buyer" => PartyKind::Buyer,
        other => return Err(AppError::business(format!("Cannot reverse a {other} payment here."))),
    };

    conn.execute(
        "UPDATE payments SET voided_at = ?2, void_reason = ?3, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, now(), reason],
    )?;

    let effect = balance_effect(&payment.payment_type, -payment.amount);
    super::parties::apply_balance(conn, kind, &payment.person_name_id(), effect, 0.0, -payment.amount)?;

    super::audit::write(
        conn,
        "REVERSE",
        "PAYMENT",
        Some(id),
        &format!("Reversed {} - {reason}", payment.payment_id),
    )?;

    get(conn, id)
}

impl Payment {
    fn person_name_id(&self) -> String {
        self.person_id.clone().unwrap_or_default()
    }
}

// ============================================================== summaries ===

/// Totals used by the payments page header and the payment report.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentTotals {
    pub received: f64,
    pub paid: f64,
    pub net: f64,
    pub count: i64,
}

pub fn totals(conn: &Connection, f: &PaymentFilter) -> AppResult<(PaymentTotals, Vec<Slice>)> {
    let mut where_parts: Vec<String> = vec!["voided_at IS NULL".into()];
    let mut args: Vec<rusqlite::types::Value> = Vec::new();

    if !f.from.is_empty() {
        args.push(rusqlite::types::Value::Text(f.from.clone()));
        where_parts.push(format!("payment_date >= ?{}", args.len()));
    }
    if !f.to.is_empty() {
        args.push(rusqlite::types::Value::Text(f.to.clone()));
        where_parts.push(format!("payment_date <= ?{}", args.len()));
    }
    if let Some(t) = f.payment_type.as_ref().filter(|s| !s.is_empty() && *s != "all") {
        args.push(rusqlite::types::Value::Text(t.clone()));
        where_parts.push(format!("payment_type = ?{}", args.len()));
    }
    if let Some(t) = f.person_id.as_ref().filter(|s| !s.is_empty()) {
        args.push(rusqlite::types::Value::Text(t.clone()));
        where_parts.push(format!("person_id = ?{}", args.len()));
    }

    let clause = where_parts.join(" AND ");
    let (received, paid, count): (f64, f64, i64) = conn.query_row(
        &format!(
            "SELECT COALESCE(SUM(CASE WHEN payment_type = 'RECEIVE_FROM_BUYER' THEN amount ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN payment_type = 'PAY_SELLER' THEN amount ELSE 0 END), 0),
                    COUNT(*)
               FROM payments WHERE {clause}"
        ),
        rusqlite::params_from_iter(args.iter()),
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let mut stmt = conn.prepare(&format!(
        "SELECT payment_method, SUM(amount) FROM payments WHERE {clause} GROUP BY payment_method ORDER BY 2 DESC"
    ))?;
    let by_method: Vec<Slice> = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |r| {
            Ok(Slice {
                label: r.get::<_, String>(0)?,
                value: money(r.get::<_, f64>(1)?),
                count: 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok((
        PaymentTotals {
            received: money(received),
            paid: money(paid),
            net: money(received - paid),
            count,
        },
        by_method,
    ))
}