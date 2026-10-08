//! Core business logic. Every function here takes a `&Connection`, is free of
//! Tauri types, and is directly unit-testable.

pub mod audit;
pub mod backup;
pub mod catalog;
pub mod cloud_sync;
pub mod coworkers;
pub mod dashboard;
pub mod demo;
pub mod parties;
pub mod payments;
pub mod purchases;
pub mod reports;
pub mod returns;
pub mod sales;
pub mod search;
pub mod settings;
pub mod stock;

use rusqlite::Transaction;

use crate::util::now;

/// Writes an immutable audit-trail row. Never fails the caller's transaction.
///
/// `description` is an ordinary `&str` because nearly every call site builds one
/// with `format!`; an empty string is stored as SQL NULL so the column keeps its
/// "absent" meaning.
pub fn log(
    tx: &Transaction,
    action: &str,
    entity: &str,
    entity_id: Option<&str>,
    description: &str,
) {
    let description = if description.is_empty() {
        rusqlite::types::Value::Null
    } else {
        rusqlite::types::Value::Text(description.to_string())
    };

    let _ = tx.execute(
        "INSERT INTO audit_log (id, action, entity, entity_id, description, user, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'ZEUS', ?6)",
        rusqlite::params![
            crate::util::new_id(),
            action,
            entity,
            entity_id,
            description,
            now()
        ],
    );
}