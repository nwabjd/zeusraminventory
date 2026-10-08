//! SQLite connection handling, pragmas and schema migration.

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// The application's shared database handle.
///
/// A single connection behind a mutex is deliberate: ZEUS is a single-user
/// desktop tool, and serialising access removes every `SQLITE_BUSY` risk while
/// letting each command open a real write transaction.
pub type Db = Mutex<Connection>;

pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::internal(format!("Cannot create data folder: {e}")))?;
        }
    }

    let conn = Connection::open(path)
        .map_err(|e| AppError::internal(format!("Cannot open database: {e}")))?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

/// In-memory database used by the test-suite.
pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()
        .map_err(|e| AppError::internal(format!("Cannot open in-memory database: {e}")))?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| AppError::internal(format!("Cannot configure database: {e}")))?;
    Ok(())
}

/// Current schema version. Bump and add a block in `apply_upgrade` when the
/// shape of the data changes.
const SCHEMA_VERSION: i64 = 6;

pub fn migrate(conn: &Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if current < 1 {
        conn.execute_batch(include_str!("../migrations/001_init.sql"))
            .map_err(|e| AppError::internal(format!("Migration 001 failed: {e}")))?;
    }

    if current < 2 {
        apply_upgrade(conn)?;
    }

    if current < 3 {
        apply_v3(conn)?;
    }

    if current < 4 {
        apply_v4(conn)?;
    }

    if current < 5 {
        apply_v5(conn)?;
    }

    if current < 6 {
        apply_v6(conn)?;
    }

    conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))
        .map_err(|e| AppError::internal(format!("Cannot stamp schema version: {e}")))?;
    Ok(())
}

/// Migration 002 - additive only, so it is safe on databases created by the
/// first ZEUS build. Every `ALTER` is guarded because SQLite has no
/// `ADD COLUMN IF NOT EXISTS`.
fn apply_upgrade(conn: &Connection) -> AppResult<()> {
    add_column(conn, "purchases", "purchase_date", "TEXT")?;
    add_column(conn, "sales", "sale_date", "TEXT")?;
    add_column(conn, "sales", "profit_margin", "REAL NOT NULL DEFAULT 0")?;
    add_column(conn, "payments", "payment_date", "TEXT")?;
    add_column(conn, "payments", "voided_at", "TEXT")?;
    add_column(conn, "payments", "void_reason", "TEXT")?;
    add_column(conn, "coworker_transactions", "txn_date", "TEXT")?;
    add_column(conn, "coworkers", "phone", "TEXT")?;
    add_column(conn, "ram_items", "capacity_gb", "INTEGER NOT NULL DEFAULT 0")?;
    add_column(conn, "ram_items", "is_archived", "INTEGER NOT NULL DEFAULT 0")?;
    add_column(conn, "buyers", "is_archived", "INTEGER NOT NULL DEFAULT 0")?;
    add_column(conn, "sellers", "is_archived", "INTEGER NOT NULL DEFAULT 0")?;

    // Back-fill the new date columns from the legacy created_at value.
    conn.execute_batch(
        "UPDATE purchases SET purchase_date = substr(created_at, 1, 10)
           WHERE purchase_date IS NULL OR purchase_date = '';
         UPDATE sales SET sale_date = substr(created_at, 1, 10)
           WHERE sale_date IS NULL OR sale_date = '';
         UPDATE payments SET payment_date = substr(created_at, 1, 10)
           WHERE payment_date IS NULL OR payment_date = '';
         UPDATE coworker_transactions SET txn_date = substr(created_at, 1, 10)
           WHERE txn_date IS NULL OR txn_date = '';
         UPDATE ram_items SET capacity_gb = CAST(REPLACE(REPLACE(capacity, 'GB', ''), ' ', '') AS INTEGER)
           WHERE capacity_gb = 0;",
    )
    .map_err(|e| AppError::internal(format!("Migration 002 back-fill failed: {e}")))?;

    Ok(())
}

/// Migration 003 - drop the hard-coded `generation` / `category`
/// CHECK constraints on `ram_items`.
///
/// SQLite cannot ALTER a constraint, so the table is rebuilt. The
/// application layer validates both columns against the built-in
/// constants UNION the master-data tables (see `catalog`), which is
/// where every other ZEUS validation lives - the schema-level lists
/// only ever blocked user-defined categories and generations from
/// reaching an item.
///
/// `PRAGMA foreign_keys` is a no-op inside a transaction, so it is
/// toggled around the rebuild. With it off, `ALTER TABLE ... RENAME`
/// leaves the child tables (purchase_items, sale_items, ...) pointing
/// at the `ram_items` name, which the rebuilt table keeps.
fn apply_v3(conn: &Connection) -> AppResult<()> {
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(|e| AppError::internal(format!("Migration 003 failed: {e}")))?;

    let rebuild = conn.execute_batch(
        "BEGIN;
         CREATE TABLE ram_items_v3 (
           id               TEXT PRIMARY KEY,
           sku              TEXT NOT NULL UNIQUE,
           generation       TEXT NOT NULL,
           category         TEXT NOT NULL,
           capacity         TEXT NOT NULL,
           capacity_gb      INTEGER NOT NULL DEFAULT 0,
           speed            TEXT NOT NULL,
           ram_type         TEXT,
           manufacturer     TEXT,
           model            TEXT,
           part_number      TEXT,
           condition        TEXT,
           ecc              INTEGER NOT NULL DEFAULT 0 CHECK (ecc IN (0, 1)),
           registered       INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0, 1)),
           rank             TEXT,
           module_count     INTEGER NOT NULL DEFAULT 1,
           purchase_price   REAL NOT NULL DEFAULT 0,
           average_cost     REAL NOT NULL DEFAULT 0,
           selling_price    REAL NOT NULL DEFAULT 0,
           quantity         INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
           minimum_stock    INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
           location         TEXT,
           notes            TEXT,
           is_archived      INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
           created_at       TEXT NOT NULL,
           updated_at       TEXT NOT NULL
         );
         INSERT INTO ram_items_v3
           (id, sku, generation, category, capacity, capacity_gb, speed, ram_type,
            manufacturer, model, part_number, condition, ecc, registered, rank,
            module_count, purchase_price, average_cost, selling_price, quantity,
            minimum_stock, location, notes, is_archived, created_at, updated_at)
           SELECT id, sku, generation, category, capacity, capacity_gb, speed, ram_type,
                  manufacturer, model, part_number, condition, ecc, registered, rank,
                  module_count, purchase_price, average_cost, selling_price, quantity,
                  minimum_stock, location, notes, is_archived, created_at, updated_at
           FROM ram_items;
         DROP TABLE ram_items;
         ALTER TABLE ram_items_v3 RENAME TO ram_items;
         CREATE INDEX IF NOT EXISTS idx_ram_items_sku        ON ram_items (sku);
         CREATE INDEX IF NOT EXISTS idx_ram_items_generation ON ram_items (generation);
         CREATE INDEX IF NOT EXISTS idx_ram_items_category   ON ram_items (category);
         CREATE INDEX IF NOT EXISTS idx_ram_items_capacity   ON ram_items (capacity_gb);
         CREATE INDEX IF NOT EXISTS idx_ram_items_speed      ON ram_items (speed);
         CREATE INDEX IF NOT EXISTS idx_ram_items_qty        ON ram_items (quantity);
         CREATE INDEX IF NOT EXISTS idx_ram_items_mfg        ON ram_items (manufacturer);
         CREATE INDEX IF NOT EXISTS idx_ram_items_archived   ON ram_items (is_archived);
         COMMIT;",
    );

    // Unwind a half-finished rebuild before re-enabling foreign keys.
    // A no-op if the batch already committed.
    let _ = conn.execute_batch("ROLLBACK;");
    let restore = conn.execute_batch("PRAGMA foreign_keys = ON;");

    rebuild.map_err(|e| AppError::internal(format!("Migration 003 failed: {e}")))?;
    restore.map_err(|e| AppError::internal(format!("Migration 003 failed: {e}")))?;
    Ok(())
}

/// Migration 004 - pin the RAM speed master list to the seven approved ZEUS
/// labels (DDR4 2400T / 2666V / 3200, DDR5 4800 / 5600 / 6000 / 6400).
///
/// Historically seeded or user-added speeds outside that list (e.g. 2933,
/// 2400 or any 52xx) are *archived*, not deleted: `archived_at` marks the row,
/// every read (`list_speeds`, `validate_speed`) filters it out so the value can
/// never reappear in a dropdown, and item/document rows that already carry the
/// string keep it untouched. The approved labels are re-inserted if a user ever
/// deleted one, and any case-variant of an approved label is canonicalised so
/// the stored spelling is always exact.
fn apply_v4(conn: &Connection) -> AppResult<()> {
    add_column(conn, "ram_speeds", "archived_at", "TEXT")?;

    conn.execute_batch(
        "-- archive every non-approved speed row, preserving it for history
         UPDATE ram_speeds SET archived_at = datetime('now')
           WHERE archived_at IS NULL
             AND (UPPER(generation) NOT IN ('DDR4', 'DDR5')
                  OR (UPPER(generation) = 'DDR4' AND UPPER(speed) NOT IN ('2400T', '2666V', '3200'))
                  OR (UPPER(generation) = 'DDR5' AND UPPER(speed) NOT IN ('4800', '5600', '6000', '6400')));

         -- guarantee the seven approved labels exist
         INSERT OR IGNORE INTO ram_speeds
           (id, speed, generation, category, description, created_at, updated_at) VALUES
         (lower(hex(randomblob(16))), '2400T', 'DDR4', 'PC',        'DDR4 PC 2400T',    datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '2666V', 'DDR4', 'PC',        'DDR4 PC 2666V',    datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '2666V', 'DDR4', 'Server',    'DDR4 RDIMM 2666V', datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '3200',  'DDR4', 'PC',        'DDR4 PC 3200',     datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '3200',  'DDR4', 'Laptop',    'DDR4 SODIMM 3200', datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '3200',  'DDR4', 'Server',    'DDR4 RDIMM 3200',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '4800',  'DDR5', 'PC',        'DDR5 PC 4800',     datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '4800',  'DDR5', 'Server',    'DDR5 RDIMM 4800',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '5600',  'DDR5', 'PC',        'DDR5 PC 5600',     datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '5600',  'DDR5', 'Laptop',    'DDR5 SODIMM 5600', datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '5600',  'DDR5', 'Server',    'DDR5 RDIMM 5600',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '6000',  'DDR5', 'PC',        'DDR5 PC 6000',     datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '6400',  'DDR5', 'PC',        'DDR5 PC 6400',     datetime('now'), datetime('now'));

         -- canonicalise case-variants of an approved label (2666v -> 2666V),
         -- skipping rows whose canonical twin already occupies the same slot
         UPDATE ram_speeds SET speed = '2400T', updated_at = datetime('now')
           WHERE archived_at IS NULL AND UPPER(generation) = 'DDR4' AND UPPER(speed) = '2400T' AND speed <> '2400T'
             AND NOT EXISTS (SELECT 1 FROM ram_speeds c WHERE c.archived_at IS NULL AND c.generation = ram_speeds.generation AND c.category = ram_speeds.category AND c.speed = '2400T');
         UPDATE ram_speeds SET speed = '2666V', updated_at = datetime('now')
           WHERE archived_at IS NULL AND UPPER(generation) = 'DDR4' AND UPPER(speed) = '2666V' AND speed <> '2666V'
             AND NOT EXISTS (SELECT 1 FROM ram_speeds c WHERE c.archived_at IS NULL AND c.generation = ram_speeds.generation AND c.category = ram_speeds.category AND c.speed = '2666V');
         UPDATE ram_speeds SET speed = '3200', updated_at = datetime('now')
           WHERE archived_at IS NULL AND UPPER(generation) = 'DDR4' AND UPPER(speed) = '3200' AND speed <> '3200'
             AND NOT EXISTS (SELECT 1 FROM ram_speeds c WHERE c.archived_at IS NULL AND c.generation = ram_speeds.generation AND c.category = ram_speeds.category AND c.speed = '3200');
         UPDATE ram_speeds SET speed = '4800', updated_at = datetime('now')
           WHERE archived_at IS NULL AND UPPER(generation) = 'DDR5' AND UPPER(speed) = '4800' AND speed <> '4800'
             AND NOT EXISTS (SELECT 1 FROM ram_speeds c WHERE c.archived_at IS NULL AND c.generation = ram_speeds.generation AND c.category = ram_speeds.category AND c.speed = '4800');
         UPDATE ram_speeds SET speed = '5600', updated_at = datetime('now')
           WHERE archived_at IS NULL AND UPPER(generation) = 'DDR5' AND UPPER(speed) = '5600' AND speed <> '5600'
             AND NOT EXISTS (SELECT 1 FROM ram_speeds c WHERE c.archived_at IS NULL AND c.generation = ram_speeds.generation AND c.category = ram_speeds.category AND c.speed = '5600');
         UPDATE ram_speeds SET speed = '6000', updated_at = datetime('now')
           WHERE archived_at IS NULL AND UPPER(generation) = 'DDR5' AND UPPER(speed) = '6000' AND speed <> '6000'
             AND NOT EXISTS (SELECT 1 FROM ram_speeds c WHERE c.archived_at IS NULL AND c.generation = ram_speeds.generation AND c.category = ram_speeds.category AND c.speed = '6000');
         UPDATE ram_speeds SET speed = '6400', updated_at = datetime('now')
           WHERE archived_at IS NULL AND UPPER(generation) = 'DDR5' AND UPPER(speed) = '6400' AND speed <> '6400'
             AND NOT EXISTS (SELECT 1 FROM ram_speeds c WHERE c.archived_at IS NULL AND c.generation = ram_speeds.generation AND c.category = ram_speeds.category AND c.speed = '6400');",
    )
    .map_err(|e| AppError::internal(format!("Migration 004 failed: {e}")))?;

    Ok(())
}

/// Migration 005 - expand the RAM speed matrix to the full DDR3/DDR4/DDR5
/// JEDEC baseline (`catalog::RAM_SPEEDS_BY_GENERATION`).
///
/// 004 pinned the master list to a seven-value subset and archived everything
/// else. This migration reverses that for every label the expanded matrix now
/// approves: DDR4 2400 & 2933 are un-archived, any archived DDR3/DDR5 row that
/// is part of the matrix is restored, and every matrix label is re-inserted
/// (INSERT OR IGNORE) so the master data can never shrink through user
/// deletion. Rows for values still outside the matrix stay archived, and item /
/// document rows that already carry a label keep their stored string untouched.
fn apply_v5(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "-- revive rows archived in 004 that belong to the expanded matrix
         UPDATE ram_speeds SET archived_at = NULL
           WHERE archived_at IS NOT NULL
             AND ((UPPER(generation) = 'DDR3' AND UPPER(speed) IN ('800','1066','1333','1600','1866','2133'))
               OR (UPPER(generation) = 'DDR4' AND UPPER(speed) IN ('1600','1866','2133','2400','2400T','2666','2666V','2933','3200'))
               OR (UPPER(generation) = 'DDR5' AND UPPER(speed) IN ('4800','5200','5600','6000','6400','6800','7200','7600','8000')));

         -- guarantee every matrix label exists (existing rows, incl. legacy
         -- 2400T/2666V/3200 and the restored 2400/2933, are left untouched)
         INSERT OR IGNORE INTO ram_speeds
           (id, speed, generation, category, description, created_at, updated_at) VALUES
         -- DDR3
         (lower(hex(randomblob(16))), '800',   'DDR3', 'PC', 'DDR3 PC 800',   datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '1066',  'DDR3', 'PC', 'DDR3 PC 1066',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '1333',  'DDR3', 'PC', 'DDR3 PC 1333',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '1600',  'DDR3', 'PC', 'DDR3 PC 1600',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '1866',  'DDR3', 'PC', 'DDR3 PC 1866',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '2133',  'DDR3', 'PC', 'DDR3 PC 2133',  datetime('now'), datetime('now')),
         -- DDR4 - plain JEDEC values next to the legacy 2400T/2666V labels
         (lower(hex(randomblob(16))), '1600',  'DDR4', 'PC', 'DDR4 PC 1600',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '1866',  'DDR4', 'PC', 'DDR4 PC 1866',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '2133',  'DDR4', 'PC', 'DDR4 PC 2133',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '2666',  'DDR4', 'PC', 'DDR4 PC 2666',  datetime('now'), datetime('now')),
         -- DDR5 - the rest of the DDR5 baseline
         (lower(hex(randomblob(16))), '5200',  'DDR5', 'PC', 'DDR5 PC 5200',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '6800',  'DDR5', 'PC', 'DDR5 PC 6800',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '7200',  'DDR5', 'PC', 'DDR5 PC 7200',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '7600',  'DDR5', 'PC', 'DDR5 PC 7600',  datetime('now'), datetime('now')),
         (lower(hex(randomblob(16))), '8000',  'DDR5', 'PC', 'DDR5 PC 8000',  datetime('now'), datetime('now'));",
    )
    .map_err(|e| AppError::internal(format!("Migration 005 failed: {e}")))?;

    Ok(())
}

/// Migration 006 - the cloud mirror: a local *cache* of the authoritative
/// cloud ledger.
///
/// When the cloud layer is configured the Supabase database owns finalized
/// sales, purchases, inventory quantities and the audit trail. This migration
/// adds the tables ZEUS uses to cache that data on the device (see
/// `core::cloud_sync`):
///
///   * cloud_sync_state - one watermark per synced dataset, so incremental
///     pulls can resume where they stopped (conflict handling is "cloud wins":
///     local rows are replaced by the newer cloud row, never the reverse).
///   * cloud_sales / cloud_sale_items - finalized sales (CLDSLS-* documents).
///   * cloud_purchases / cloud_purchase_items - finalized purchases (CLDPUR-*).
///   * cloud_approvals - the device's visible approval requests (RLS still
///     limits what any device may pull, so this is already scoped).
///   * cloud_audit - the cloud audit trail (admin devices only).
///
/// These are display caches, deliberately NOT the engine tables (`sales`,
/// `purchases`, `inventory_adjustments`, ...). `core::stock::recompute` replays
/// the local engine ledger, so blending or duplicating rows here would corrupt
/// quantity/cost derivations on this device. Instead quantities arrive through
/// the ram_items mirror (the cloud row is authoritative and overwrites the
/// local figure), and documents render from these tables.
fn apply_v6(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(include_str!("../migrations/006_cloud_mirror.sql"))
        .map_err(|e| AppError::internal(format!("Migration 006 failed: {e}")))?;
    Ok(())
}

fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> AppResult<()> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| AppError::internal(format!("Cannot inspect {table}: {e}")))?;
    let existing: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| AppError::internal(format!("Cannot inspect {table}: {e}")))?
        .filter_map(|r| r.ok())
        .collect();

    if existing.iter().any(|c| c.eq_ignore_ascii_case(column)) {
        return Ok(());
    }

    let alter = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
    conn.execute_batch(&alter)
        .map_err(|e| AppError::internal(format!("Cannot add {table}.{column}: {e}")))?;
    Ok(())
}