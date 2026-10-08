//! Application settings (key/value) exposed as a typed map.

use crate::error::{AppError, AppResult};
use crate::util::now;
use rusqlite::Connection;
use std::collections::BTreeMap;

const DEFAULTS: &[(&str, &str)] = &[
    ("business_name", "ZEUS"),
    ("business_tagline", "RAM INVENTORY MANAGEMENT"),
    ("business_address", ""),
    ("business_phone", ""),
    ("business_email", ""),
    ("business_trn", ""),
    ("currency", "AED"),
    ("timezone", "Asia/Dubai"),
    ("date_format", "DD/MM/YYYY"),
    ("low_stock_default", "5"),
    ("theme", "light"),
    ("density", "comfortable"),
    ("auto_backup", "1"),
    ("backup_interval_hours", "24"),
    ("backup_dir", ""),
    ("last_backup", ""),
    ("last_backup_path", ""),
];

/// Settings the Settings screen is allowed to write. Anything else (such as
/// `last_backup`, which the backup routine owns) is rejected so the UI cannot
/// corrupt internal state.
const WRITABLE: &[&str] = &[
    "business_name",
    "business_tagline",
    "business_address",
    "business_phone",
    "business_email",
    "business_trn",
    "currency",
    "timezone",
    "date_format",
    "low_stock_default",
    "theme",
    "density",
    "auto_backup",
    "backup_interval_hours",
    "backup_dir",
];

pub fn all(conn: &Connection) -> AppResult<BTreeMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let mut map: BTreeMap<String, String> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<_, _>>()?;

    // Guarantee every key exists even on a stripped-down database.
    for (k, v) in DEFAULTS {
        map.entry((*k).to_string()).or_insert_with(|| (*v).to_string());
    }
    Ok(map)
}

pub fn get(conn: &Connection, key: &str) -> AppResult<String> {
    let v: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .ok();
    Ok(v.unwrap_or_else(|| {
        DEFAULTS
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| (*v).to_string())
            .unwrap_or_default()
    }))
}

pub fn get_int(conn: &Connection, key: &str, fallback: i64) -> i64 {
    get(conn, key).ok().and_then(|v| v.parse().ok()).unwrap_or(fallback)
}

pub fn get_bool(conn: &Connection, key: &str, fallback: bool) -> bool {
    match get(conn, key) {
        Ok(v) if v == "1" || v.eq_ignore_ascii_case("true") => true,
        Ok(v) if v == "0" || v.eq_ignore_ascii_case("false") => false,
        _ => fallback,
    }
}

/// Writes user-editable settings. Internal keys are set with
/// [`set_internal`] instead.
pub fn save(conn: &Connection, values: &BTreeMap<String, String>) -> AppResult<usize> {
    let mut count = 0;
    for (key, value) in values {
        if !WRITABLE.contains(&key.as_str()) {
            return Err(AppError::validation(format!("'{key}' cannot be changed from Settings.")));
        }
        if key == "currency" && value.trim().is_empty() {
            return Err(AppError::validation("Currency is required."));
        }
        if key == "low_stock_default" && value.parse::<i64>().is_err() {
            return Err(AppError::validation("Default low-stock level must be a number."));
        }
        if key == "backup_interval_hours" && value.parse::<i64>().is_err() {
            return Err(AppError::validation("Backup interval must be a number of hours."));
        }
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            rusqlite::params![key, value.trim(), now()],
        )?;
        count += 1;
    }
    super::audit::write(conn, "UPDATE", "SETTINGS", None, &format!("Updated {count} setting(s)"))?;
    Ok(count)
}

/// Used by the backup subsystem for keys the UI must not touch.
pub fn set_internal(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value, now()],
    )?;
    Ok(())
}

pub const CURRENCIES: &[&str] = &["AED", "USD", "EUR", "GBP", "SAR", "QAR", "OMR", "KWD", "BHD", "INR", "PKR"];
pub const TIMEZONES: &[&str] = &[
    "Asia/Dubai", "Asia/Riyadh", "Asia/Karachi", "Asia/Kolkata", "Europe/London",
    "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC",
];
pub const DATE_FORMATS: &[&str] = &["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
pub const PAYMENT_METHODS: &[&str] = &["Cash", "Bank Transfer", "Card", "Cheque", "Other"];
pub const CONDITIONS: &[&str] = &["New", "Refurbished", "Used", "Pulled", "Mixed"];