//! Backup and restore.
//!
//! `backup_now` uses SQLite's `VACUUM INTO`, which produces a consistent,
//! defragmented single-file copy without stopping the app. `restore` validates
//! the candidate file before swapping it in, so a corrupt archive can never
//! replace a working database.

use crate::error::{AppError, AppResult};
use crate::models::{BackupEntry, BackupInfo};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// `zeus-2026-10-05-143107.db`
pub fn file_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d-%H%M%S").to_string()
}

/// `zeus-2026-10-05-143107-482.db` - millisecond precision so two backups taken
/// in the same second still get distinct names.
fn file_stamp_ms() -> String {
    chrono::Local::now().format("%Y-%m-%d-%H%M%S%.3f").to_string()
}

/// Picks a free backup filename, adding a counter if two backups land inside
/// the same millisecond.
fn unique_backup_path(dir: &Path) -> PathBuf {
    let stamp = file_stamp_ms();
    let mut candidate = dir.join(format!("zeus-{stamp}.db"));
    let mut n = 2;
    while candidate.exists() && n < 1000 {
        candidate = dir.join(format!("zeus-{stamp}-{n}.db"));
        n += 1;
    }
    candidate
}

pub fn default_backup_dir(database_path: &Path) -> PathBuf {
    database_path
        .parent()
        .map(|p| p.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"))
}

pub fn info(conn: &Connection, database_path: &Path) -> AppResult<BackupInfo> {
    let configured = super::settings::get(conn, "backup_dir")?;
    let backup_dir = if configured.trim().is_empty() {
        default_backup_dir(database_path)
    } else {
        PathBuf::from(configured)
    };

    let size = fs::metadata(database_path).map(|m| m.len() as i64).unwrap_or(0);

    Ok(BackupInfo {
        database_path: database_path.display().to_string(),
        backup_dir: backup_dir.display().to_string(),
        last_backup: super::settings::get(conn, "last_backup")?,
        last_backup_path: super::settings::get(conn, "last_backup_path")?,
        auto_backup: super::settings::get_bool(conn, "auto_backup", true),
        backup_interval_hours: super::settings::get_int(conn, "backup_interval_hours", 24),
        database_size_bytes: size,
        available: true,
    })
}

pub fn list_backups(backup_dir: &Path) -> AppResult<Vec<BackupEntry>> {
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for dir in fs::read_dir(backup_dir)? {
        let path = dir?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("db") {
            continue;
        }
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, d.subsec_nanos())
                    .map(|dt| dt.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M:%S").to_string())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        entries.push(BackupEntry {
            file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            path: path.display().to_string(),
            size_bytes: meta.len() as i64,
            created_at: modified,
        });
    }
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

/// Writes a consistent snapshot. Fails loudly rather than silently.
pub fn create(conn: &Connection, backup_dir: &Path) -> AppResult<BackupInfo> {
    fs::create_dir_all(backup_dir).map_err(|e| {
        AppError::internal(format!(
            "Cannot create the backup folder '{}': {e}",
            backup_dir.display()
        ))
    })?;

    let file = unique_backup_path(backup_dir);
    let sql = format!("VACUUM INTO '{}'", file.display().to_string().replace('\'', "''"));

    if let Err(e) = conn.execute_batch(&sql) {
        let _ = fs::remove_file(&file);
        return Err(AppError::internal(format!("Backup failed: {e}")));
    }

    // Verify the copy is a readable database before declaring success.
    verify(&file)?;

    super::settings::set_internal(conn, "last_backup", &now_string())?;
    super::settings::set_internal(conn, "last_backup_path", &file.display().to_string())?;
    super::audit::write(
        conn,
        "BACKUP",
        "DATABASE",
        None,
        &format!("Backup created at {}", file.display()),
    )?;

    info(conn, database_path_of(conn)?)
}

/// Replaces the live database with `source`.
///
/// The caller must hold the connection lock; this closes and reopens the
/// database in place.
pub fn restore(conn: &mut Connection, source: &Path) -> AppResult<BackupInfo> {
    if !source.exists() {
        return Err(AppError::not_found(format!(
            "Backup file '{}' does not exist.",
            source.display()
        )));
    }
    verify(source)?;

    let live = database_path_of(conn)?.to_path_buf();

    // Keep the replaced file alongside as a safety net.
    let safety = live.with_extension(format!("replaced-{}", file_stamp()));
    if live.exists() {
        let _ = fs::remove_file(&safety);
        fs::copy(&live, &safety).map_err(|e| {
            AppError::internal(format!("Cannot safeguard the current database: {e}"))
        })?;
    }

    // Flush the write-ahead log into the main file and then release our handle
    // on it. Overwriting the file while a connection still has it open in WAL
    // mode leaves the new content pointing at the *old* WAL, which SQLite
    // reports as "database disk image is malformed".
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| AppError::internal(format!("Cannot flush the database before restoring: {e}")))?;
    {
        // Assigning a throwaway connection drops the old one, closing the file.
        let placeholder = Connection::open_in_memory()
            .map_err(|e| AppError::internal(format!("Cannot release the database handle: {e}")))?;
        *conn = placeholder;
    }

    // Replace the WAL sidecars so no stale pages come back.
    for suffix in ["-wal", "-shm"] {
        let side = live.with_file_name(format!(
            "{}{}",
            live.file_name().unwrap_or_default().to_string_lossy(),
            suffix
        ));
        let _ = fs::remove_file(side);
    }

    fs::copy(source, &live)
        .map_err(|e| AppError::internal(format!("Cannot restore the backup: {e}")))?;

    let reopened = crate::db::open(&live)?;
    *conn = reopened;

    super::settings::set_internal(conn, "last_backup_path", &source.display().to_string())?;
    super::audit::write(
        conn,
        "RESTORE",
        "DATABASE",
        None,
        &format!("Restored from {}", source.display()),
    )?;

    info(conn, &live)
}

/// Confirms the file really is a ZEUS database.
pub fn verify(path: &Path) -> AppResult<()> {
    let conn = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| AppError::internal(format!("'{}' is not a readable database: {e}", path.display())))?;

    let user_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if user_version == 0 {
        return Err(AppError::internal(format!(
            "'{}' is not a ZEUS backup.",
            path.display()
        )));
    }
    // A ZEUS database must at least know these tables.
    for table in ["ram_items", "buyers", "sellers", "sales", "purchases", "settings"] {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(AppError::internal(format!(
                "'{}' is missing the '{table}' table and cannot be restored.",
                path.display()
            )));
        }
    }
    Ok(())
}

/// True when the automatic-backup interval has elapsed.
pub fn is_due(conn: &Connection) -> AppResult<bool> {
    if !super::settings::get_bool(conn, "auto_backup", true) {
        return Ok(false);
    }
    let hours = super::settings::get_int(conn, "backup_interval_hours", 24).max(1);
    let last = super::settings::get(conn, "last_backup")?;
    if last.trim().is_empty() {
        return Ok(true);
    }
    match chrono::NaiveDateTime::parse_from_str(&last, "%Y-%m-%d %H:%M:%S") {
        Ok(then) => {
            let age = chrono::Local::now().naive_local()
                - then.and_utc().naive_utc();
            Ok(age.num_hours() >= hours)
        }
        Err(_) => Ok(true),
    }
}

pub fn run_if_due(conn: &Connection) -> AppResult<Option<String>> {
    if !is_due(conn)? {
        return Ok(None);
    }
    let dir = configured_dir(conn)?;
    match create(conn, &dir) {
        Ok(i) => Ok(Some(i.last_backup_path)),
        Err(e) => Err(e),
    }
}

pub fn configured_dir(conn: &Connection) -> AppResult<PathBuf> {
    let configured = super::settings::get(conn, "backup_dir")?;
    if configured.trim().is_empty() {
        Ok(default_backup_dir(database_path_of(conn)?))
    } else {
        Ok(PathBuf::from(configured))
    }
}

/// The live database file path, stored on the connection by `db::open`.
pub fn database_path_of(conn: &Connection) -> AppResult<&Path> {
    conn.path()
        .map(Path::new)
        .ok_or_else(|| AppError::internal("This database has no file path."))
}

fn now_string() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}