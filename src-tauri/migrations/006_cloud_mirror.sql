-- ===========================================================================
-- ZEUS local cache - cloud mirror (schema version 6)
-- ---------------------------------------------------------------------------
-- The Supabase database is the AUTHORITY for finalized business data. These
-- tables are the desktop's cache of that data. They are display/read caches
-- only: nothing in the local engine (`recompute`, reports, dashboard) reads
-- them, so they can never corrupt quantity/cost derivations on this device.
--
-- Inventory quantities are mirrored into the existing `ram_items` table by
-- SKU (the authoritative cloud row wins), which is what every existing page
-- reads. Document history renders from the tables below.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS cloud_sync_state (
  key       TEXT PRIMARY KEY,
  watermark TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------------------------ sales --
CREATE TABLE IF NOT EXISTS cloud_sales (
  id                  TEXT PRIMARY KEY,
  approval_id         TEXT UNIQUE,
  sale_number         TEXT NOT NULL,
  buyer_name          TEXT NOT NULL,
  sale_date           TEXT NOT NULL,
  subtotal            REAL NOT NULL DEFAULT 0,
  discount            REAL NOT NULL DEFAULT 0,
  total               REAL NOT NULL DEFAULT 0,
  received            REAL NOT NULL DEFAULT 0,
  remaining           REAL NOT NULL DEFAULT 0,
  payment_method      TEXT,
  total_cost          REAL NOT NULL DEFAULT 0,
  gross_profit        REAL NOT NULL DEFAULT 0,
  profit_margin       REAL NOT NULL DEFAULT 0,
  notes               TEXT,
  requested_by        TEXT,
  requested_by_email  TEXT NOT NULL DEFAULT '',
  decided_by_email    TEXT,
  decided_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_sales_created ON cloud_sales (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_sales_number ON cloud_sales (sale_number);
CREATE INDEX IF NOT EXISTS idx_cloud_sales_approval ON cloud_sales (approval_id);

CREATE TABLE IF NOT EXISTS cloud_sale_items (
  id            TEXT PRIMARY KEY,
  cloud_sale_id TEXT NOT NULL REFERENCES cloud_sales (id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,
  generation    TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  capacity      TEXT NOT NULL DEFAULT '',
  speed         TEXT NOT NULL DEFAULT '',
  quantity      INTEGER NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  cost_per_unit REAL NOT NULL DEFAULT 0,
  subtotal      REAL NOT NULL DEFAULT 0,
  cost_total    REAL NOT NULL DEFAULT 0,
  profit        REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cloud_sale_items_sale ON cloud_sale_items (cloud_sale_id);

-- -------------------------------------------------------------- purchases --
CREATE TABLE IF NOT EXISTS cloud_purchases (
  id                  TEXT PRIMARY KEY,
  approval_id         TEXT UNIQUE,
  purchase_number     TEXT NOT NULL,
  seller_name         TEXT NOT NULL,
  purchase_date       TEXT NOT NULL,
  subtotal            REAL NOT NULL DEFAULT 0,
  discount            REAL NOT NULL DEFAULT 0,
  total               REAL NOT NULL DEFAULT 0,
  paid                REAL NOT NULL DEFAULT 0,
  remaining           REAL NOT NULL DEFAULT 0,
  payment_method      TEXT,
  notes               TEXT,
  requested_by        TEXT,
  requested_by_email  TEXT NOT NULL DEFAULT '',
  decided_by_email    TEXT,
  decided_at          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_purchases_created ON cloud_purchases (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_purchases_number ON cloud_purchases (purchase_number);
CREATE INDEX IF NOT EXISTS idx_cloud_purchases_approval ON cloud_purchases (approval_id);

CREATE TABLE IF NOT EXISTS cloud_purchase_items (
  id                TEXT PRIMARY KEY,
  cloud_purchase_id TEXT NOT NULL REFERENCES cloud_purchases (id) ON DELETE CASCADE,
  sku               TEXT NOT NULL,
  generation        TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT '',
  capacity          TEXT NOT NULL DEFAULT '',
  speed             TEXT NOT NULL DEFAULT '',
  quantity          INTEGER NOT NULL DEFAULT 0,
  cost_per_unit     REAL NOT NULL DEFAULT 0,
  subtotal          REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cloud_purchase_items_purchase ON cloud_purchase_items (cloud_purchase_id);

-- -------------------------------------------------------------- approvals --
CREATE TABLE IF NOT EXISTS cloud_approvals (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL,
  transaction_number    TEXT NOT NULL,
  payload               TEXT NOT NULL DEFAULT '{}',
  total_amount          REAL NOT NULL DEFAULT 0,
  item_count            INTEGER NOT NULL DEFAULT 0,
  unit_count            INTEGER NOT NULL DEFAULT 0,
  party_name            TEXT NOT NULL DEFAULT '',
  requested_by          TEXT,
  requested_by_email    TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'pending_approval',
  lock_owner            TEXT,
  locked_at             TEXT,
  decided_by            TEXT,
  decided_by_email      TEXT,
  decided_at            TEXT,
  rejection_reason      TEXT,
  final_document_number TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_approvals_status ON cloud_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_approvals_created ON cloud_approvals (created_at DESC);

-- ------------------------------------------------------------------ audit --
CREATE TABLE IF NOT EXISTS cloud_audit (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  actor_email TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT,
  metadata   TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_audit_created ON cloud_audit (created_at DESC);