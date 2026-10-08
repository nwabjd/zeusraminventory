//! Small shared helpers: timestamps, identifiers and document numbering.

use crate::error::{AppError, AppResult};
use chrono::{Datelike, Local, NaiveDate};
use rusqlite::Connection;

/// `'2026-10-05 14:31:07'` - the format every ZEUS timestamp column uses.
pub fn now() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// `'2026-10-05'`
pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// Month prefix used to decide when the daily document sequence restarts.
pub fn yyyymmdd() -> String {
    Local::now().format("%Y%m%d").to_string()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// A stable, human-readable short code, e.g. `PUR-0007`.
pub fn short_code() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..7].to_uppercase()
}

/// Accepts `2026-10-05`, `05/10/2026`, `2026/10/05` and normalises to ISO.
/// Empty input falls back to today so callers never have to branch.
pub fn normalise_date(input: &str) -> AppResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(today());
    }

    let iso_like = trimmed
        .replace('/', "-")
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();

    let candidates = [
        iso_like.clone(),
        trimmed.split_whitespace().next().unwrap_or("").to_string(),
    ];

    for c in candidates.iter() {
        if let Ok(d) = NaiveDate::parse_from_str(c, "%Y-%m-%d") {
            return Ok(d.format("%Y-%m-%d").to_string());
        }
        if let Ok(d) = NaiveDate::parse_from_str(c, "%d-%m-%Y") {
            return Ok(d.format("%Y-%m-%d").to_string());
        }
        if let Ok(d) = NaiveDate::parse_from_str(c, "%m-%d-%Y") {
            return Ok(d.format("%Y-%m-%d").to_string());
        }
    }

    Err(AppError::validation(format!(
        "'{trimmed}' is not a valid date. Use DD/MM/YYYY or YYYY-MM-DD."
    )))
}

/// True when `date_str` falls inside the inclusive `[from, to]` window.
pub fn within_range(date_str: &str, from: &str, to: &str) -> bool {
    if !from.is_empty() && date_str < from {
        return false;
    }
    if !to.is_empty() && date_str > to {
        return false;
    }
    true
}

/// Generates the next `PREFIX-YYYYMMDD-NNNN` document number.
///
/// `table` / `column` are internal compile-time literals (never user input);
/// they are matched against this allow-list anyway before interpolation.
pub fn next_doc_number(conn: &Connection, prefix: &str, table: &str, column: &str) -> AppResult<String> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {column} FROM {table} WHERE {column} LIKE ? ORDER BY {column} DESC LIMIT 1"
    ))?;
    let last: Option<String> = stmt
        .query_row([format!("{prefix}-{}-%", yyyymmdd())], |r| r.get::<_, String>(0))
        .ok();
    Ok(format_next(prefix, &last))
}

/// Transaction-scoped twin of [`next_doc_number`].
///
/// Called after the row itself is inserted, so it sees the document that is
/// being written and therefore never repeats a number inside one transaction.
pub fn next_doc_number_tx(
    tx: &rusqlite::Transaction,
    prefix: &str,
    table: &str,
    column: &str,
) -> AppResult<String> {
    const ALLOWED: &[(&str, &str)] = &[
        ("purchases", "purchase_number"),
        ("sales", "sale_number"),
        ("payments", "payment_id"),
        ("returns", "return_number"),
    ];
    if !ALLOWED.contains(&(table, column)) {
        return Err(AppError::internal("next_doc_number_tx: table not allowed"));
    }
    let mut stmt = tx.prepare(&format!(
        "SELECT {column} FROM {table} WHERE {column} LIKE ? ORDER BY {column} DESC LIMIT 1"
    ))?;
    let last: Option<String> = stmt
        .query_row([format!("{prefix}-{}-%", yyyymmdd())], |r| r.get::<_, String>(0))
        .ok();
    Ok(format_next(prefix, &last))
}

fn format_next(prefix: &str, last: &Option<String>) -> String {
    let stem = format!("{prefix}-{}-", yyyymmdd());
    let next_seq = last
        .as_ref()
        .and_then(|v| v.rsplit('-').next())
        .and_then(|s| s.parse::<u32>().ok())
        .map(|n| n + 1)
        .unwrap_or(1);
    format!("{stem}{next_seq:04}")
}

/// Builds a unique SKU such as `Z-D4-SRV-32-2666V-0007`.
pub fn generate_sku(
    conn: &Connection,
    generation: &str,
    category: &str,
    capacity: &str,
    speed: &str,
) -> AppResult<String> {
    let gen = format!("D{}", generation.chars().filter(|c| c.is_ascii_digit()).collect::<String>());
    let cat: String = category
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(3)
        .collect::<String>()
        .to_uppercase();
    let cap = capacity
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>();
    // Speed keeps its letters: DDR4-2666 and DDR4-2666V are different modules,
    // so a digits-only SKU would make them collide.
    let spd: String = speed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase();

    let base = format!("Z-{gen}-{cat}-{cap}-{spd}");
    let mut n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ram_items WHERE sku LIKE ?",
        [format!("{base}-%")],
        |r| r.get(0),
    )?;
    n += 1;

    let mut candidate = format!("{base}-{n:04}");
    while conn
        .query_row("SELECT 1 FROM ram_items WHERE sku = ?", [&candidate], |_| Ok(()))
        .is_ok()
    {
        n += 1;
        candidate = format!("{base}-{n:04}");
    }
    Ok(candidate)
}

/// `'32 GB'` -> `32`, `'1 TB'` -> `1024`. Used for sorting and capacity-range
/// filters (kept in sync with `catalog::parse_capacity_gb`).
pub fn capacity_to_gb(capacity: &str) -> i64 {
    let trimmed = capacity.trim();
    let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
    let value = digits.parse::<i64>().unwrap_or(0);
    let rest = trimmed[digits.len()..].trim();
    if rest.eq_ignore_ascii_case("TB") {
        value * 1024
    } else {
        value
    }
}

/// Leading numeric part of a speed label: `'2666V'` -> `2666`.
pub fn speed_to_number(speed: &str) -> i64 {
    speed
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse::<i64>()
        .unwrap_or(0)
}

pub fn today_year() -> i32 {
    Local::now().year()
}

/// Money rounding used consistently so stored and displayed values match.
pub fn money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub fn validate_non_negative(value: f64, label: &str) -> AppResult<f64> {
    if !value.is_finite() {
        return Err(AppError::validation(format!("{label} must be a valid number.")));
    }
    if value < 0.0 {
        return Err(AppError::validation(format!("{label} cannot be negative.")));
    }
    Ok(money(value))
}

pub fn validate_positive(value: f64, label: &str) -> AppResult<f64> {
    let v = validate_non_negative(value, label)?;
    if v <= 0.0 {
        return Err(AppError::validation(format!("{label} must be greater than zero.")));
    }
    Ok(v)
}

pub fn validate_required(value: &str, label: &str) -> AppResult<String> {
    let t = value.trim();
    if t.is_empty() {
        return Err(AppError::validation(format!("{label} is required.")));
    }
    Ok(t.to_string())
}

pub fn validate_quantity(value: i64, label: &str, allow_zero: bool) -> AppResult<i64> {
    if value < 0 || (!allow_zero && value == 0) {
        return Err(AppError::validation(format!(
            "{label} must be {}.",
            if allow_zero { "zero or greater" } else { "greater than zero" }
        )));
    }
    Ok(value)
}