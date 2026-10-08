//! Audit trail helpers.

use crate::error::AppResult;
use crate::models::AuditEntry;
use rusqlite::Connection;

/// Convenience wrapper used by non-transactional callers.
pub fn write(conn: &Connection, action: &str, entity: &str, entity_id: Option<&str>, description: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO audit_log (id, action, entity, entity_id, description, user, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'ZEUS', ?6)",
        rusqlite::params![crate::util::new_id(), action, entity, entity_id, description, crate::util::now()],
    )?;
    Ok(())
}

pub fn list(conn: &Connection, limit: i64, entity: Option<&str>) -> AppResult<Vec<AuditEntry>> {
    let mut sql = String::from(
        "SELECT id, action, entity, entity_id, description, created_at
         FROM audit_log",
    );
    if entity.is_some_and(|e| !e.is_empty()) {
        sql.push_str(" WHERE entity = ?1");
    }
    sql.push_str(" ORDER BY created_at DESC, rowid DESC LIMIT ?2");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params![entity.unwrap_or(""), limit], |r| {
        Ok(AuditEntry {
            id: r.get(0)?,
            action: r.get(1)?,
            entity: r.get(2)?,
            entity_id: r.get(3)?,
            description: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}