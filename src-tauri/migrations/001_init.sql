-- ===========================================================================
-- ZEUS - RAM Inventory Management
-- Migration 001: baseline relational schema
-- ===========================================================================
-- Conventions
--   * Every timestamp is a local ISO string: 'YYYY-MM-DD HH:MM:SS'
--   * Money is REAL, always non-negative. Signed balances carry direction.
--   * Quantity is INTEGER and can never be negative (enforced by CHECK).
--   * Soft deletes via status='void' on documents, is_archived on catalogue.
-- ===========================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ------------------------------------------------------------ ram_speeds
-- Master list of valid DDR speeds. Managed from Settings.
CREATE TABLE IF NOT EXISTS ram_speeds (
  id           TEXT PRIMARY KEY,
  speed        TEXT NOT NULL,
  generation   TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (speed, generation, category)
);
CREATE INDEX IF NOT EXISTS idx_ram_speeds_gen ON ram_speeds (generation, category);

-- ------------------------------------------------------------ categories
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'category', -- generation | category
  created_at  TEXT NOT NULL
);

-- --------------------------------------------------------- manufacturers
CREATE TABLE IF NOT EXISTS manufacturers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- ------------------------------------------------------------- locations
CREATE TABLE IF NOT EXISTS locations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  created_at   TEXT NOT NULL
);

-- ------------------------------------------------------------ ram_items
CREATE TABLE IF NOT EXISTS ram_items (
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
CREATE INDEX IF NOT EXISTS idx_ram_items_sku        ON ram_items (sku);
CREATE INDEX IF NOT EXISTS idx_ram_items_generation ON ram_items (generation);
CREATE INDEX IF NOT EXISTS idx_ram_items_category   ON ram_items (category);
CREATE INDEX IF NOT EXISTS idx_ram_items_capacity   ON ram_items (capacity_gb);
CREATE INDEX IF NOT EXISTS idx_ram_items_speed      ON ram_items (speed);
CREATE INDEX IF NOT EXISTS idx_ram_items_qty        ON ram_items (quantity);
CREATE INDEX IF NOT EXISTS idx_ram_items_mfg        ON ram_items (manufacturer);
CREATE INDEX IF NOT EXISTS idx_ram_items_archived   ON ram_items (is_archived);

-- ---------------------------------------------------------------- buyers
CREATE TABLE IF NOT EXISTS buyers (
  id                TEXT PRIMARY KEY,
  customer_id       TEXT UNIQUE,
  company_name      TEXT NOT NULL,
  contact_person    TEXT,
  phone             TEXT,
  whatsapp          TEXT,
  email             TEXT,
  address           TEXT,
  city              TEXT,
  trn_vat           TEXT,
  notes             TEXT,
  opening_balance   REAL NOT NULL DEFAULT 0,
  current_balance   REAL NOT NULL DEFAULT 0, -- >0 they owe us
  total_purchases   REAL NOT NULL DEFAULT 0,
  total_paid        REAL NOT NULL DEFAULT 0,
  total_outstanding REAL NOT NULL DEFAULT 0,
  is_archived       INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buyers_company ON buyers (company_name);
CREATE INDEX IF NOT EXISTS idx_buyers_phone   ON buyers (phone);

-- --------------------------------------------------------------- sellers
CREATE TABLE IF NOT EXISTS sellers (
  id                TEXT PRIMARY KEY,
  supplier_id       TEXT UNIQUE,
  company_name      TEXT NOT NULL,
  contact_person    TEXT,
  phone             TEXT,
  whatsapp          TEXT,
  email             TEXT,
  address           TEXT,
  city              TEXT,
  trn_vat           TEXT,
  notes             TEXT,
  opening_balance   REAL NOT NULL DEFAULT 0,
  current_balance   REAL NOT NULL DEFAULT 0, -- >0 we owe them
  total_purchases   REAL NOT NULL DEFAULT 0,
  total_paid        REAL NOT NULL DEFAULT 0,
  total_outstanding REAL NOT NULL DEFAULT 0,
  is_archived       INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sellers_company ON sellers (company_name);
CREATE INDEX IF NOT EXISTS idx_sellers_phone   ON sellers (phone);

-- ------------------------------------------------------------- purchases
CREATE TABLE IF NOT EXISTS purchases (
  id              TEXT PRIMARY KEY,
  purchase_number TEXT NOT NULL UNIQUE,
  seller_id       TEXT REFERENCES sellers (id) ON DELETE SET NULL,
  seller_name     TEXT NOT NULL,
  purchase_date   TEXT NOT NULL,
  subtotal        REAL NOT NULL DEFAULT 0,
  discount        REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total           REAL NOT NULL DEFAULT 0,
  paid            REAL NOT NULL DEFAULT 0,
  remaining       REAL NOT NULL DEFAULT 0,
  payment_method  TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'void')),
  voided_at       TEXT,
  void_reason     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_number ON purchases (purchase_number);
CREATE INDEX IF NOT EXISTS idx_purchases_date   ON purchases (purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_seller ON purchases (seller_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases (status);

-- --------------------------------------------------------- purchase_items
CREATE TABLE IF NOT EXISTS purchase_items (
  id             TEXT PRIMARY KEY,
  purchase_id    TEXT NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  ram_item_id    TEXT NOT NULL REFERENCES ram_items (id) ON DELETE RESTRICT,
  sku            TEXT NOT NULL,
  generation     TEXT NOT NULL,
  category       TEXT NOT NULL,
  capacity       TEXT NOT NULL,
  speed          TEXT NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  cost_per_unit  REAL NOT NULL CHECK (cost_per_unit >= 0),
  subtotal       REAL NOT NULL CHECK (subtotal >= 0),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_doc ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_ram ON purchase_items (ram_item_id);

-- ----------------------------------------------------------------- sales
CREATE TABLE IF NOT EXISTS sales (
  id            TEXT PRIMARY KEY,
  sale_number   TEXT NOT NULL UNIQUE,
  buyer_id      TEXT REFERENCES buyers (id) ON DELETE SET NULL,
  buyer_name    TEXT NOT NULL,
  sale_date     TEXT NOT NULL,
  subtotal      REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total         REAL NOT NULL DEFAULT 0,
  received      REAL NOT NULL DEFAULT 0,
  remaining     REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  total_cost    REAL NOT NULL DEFAULT 0,
  gross_profit  REAL NOT NULL DEFAULT 0,
  profit_margin REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'void')),
  voided_at     TEXT,
  void_reason   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_number ON sales (sale_number);
CREATE INDEX IF NOT EXISTS idx_sales_date   ON sales (sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_buyer  ON sales (buyer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales (status);

-- ----------------------------------------------------------- sale_items
CREATE TABLE IF NOT EXISTS sale_items (
  id             TEXT PRIMARY KEY,
  sale_id        TEXT NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  ram_item_id    TEXT NOT NULL REFERENCES ram_items (id) ON DELETE RESTRICT,
  sku            TEXT NOT NULL,
  generation     TEXT NOT NULL,
  category       TEXT NOT NULL,
  capacity       TEXT NOT NULL,
  speed          TEXT NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  selling_price  REAL NOT NULL CHECK (selling_price >= 0),
  cost_per_unit  REAL NOT NULL CHECK (cost_per_unit >= 0),
  subtotal       REAL NOT NULL CHECK (subtotal >= 0),
  cost_total     REAL NOT NULL CHECK (cost_total >= 0),
  profit         REAL NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_doc ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_ram ON sale_items (ram_item_id);

-- --------------------------------------------------------------- returns
CREATE TABLE IF NOT EXISTS returns (
  id             TEXT PRIMARY KEY,
  return_number  TEXT NOT NULL UNIQUE,
  return_type    TEXT NOT NULL CHECK (return_type IN ('SALE_RETURN', 'PURCHASE_RETURN')),
  reference_id   TEXT,
  reference_number TEXT,
  party_type     TEXT NOT NULL CHECK (party_type IN ('buyer', 'seller')),
  party_id       TEXT,
  party_name     TEXT NOT NULL,
  return_date    TEXT NOT NULL,
  total          REAL NOT NULL DEFAULT 0,
  refund         REAL NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_returns_type ON returns (return_type);
CREATE INDEX IF NOT EXISTS idx_returns_date ON returns (return_date);

CREATE TABLE IF NOT EXISTS return_items (
  id            TEXT PRIMARY KEY,
  return_id     TEXT NOT NULL REFERENCES returns (id) ON DELETE CASCADE,
  ram_item_id   TEXT NOT NULL REFERENCES ram_items (id) ON DELETE RESTRICT,
  sku           TEXT NOT NULL,
  generation    TEXT NOT NULL,
  category      TEXT NOT NULL,
  capacity      TEXT NOT NULL,
  speed         TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  unit_price    REAL NOT NULL CHECK (unit_price >= 0),
  unit_cost     REAL NOT NULL CHECK (unit_cost >= 0),
  subtotal      REAL NOT NULL CHECK (subtotal >= 0),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_return_items_doc ON return_items (return_id);

-- -------------------------------------------------------------- payments
CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  payment_id     TEXT NOT NULL UNIQUE,
  payment_type   TEXT NOT NULL,
  person_type    TEXT NOT NULL CHECK (person_type IN ('buyer', 'seller', 'coworker')),
  person_id      TEXT,
  person_name    TEXT NOT NULL,
  amount         REAL NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  reference      TEXT,
  notes          TEXT,
  payment_date   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_ref   ON payments (payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_date  ON payments (payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_type  ON payments (payment_type);
CREATE INDEX IF NOT EXISTS idx_payments_person ON payments (person_type, person_id);

-- ------------------------------------------------------------- coworkers
CREATE TABLE IF NOT EXISTS coworkers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  phone           TEXT,
  current_balance REAL NOT NULL DEFAULT 0, -- >0 they owe us, <0 we owe them
  notes           TEXT,
  is_archived     INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- ------------------------------------------------- coworker_transactions
CREATE TABLE IF NOT EXISTS coworker_transactions (
  id            TEXT PRIMARY KEY,
  coworker_id   TEXT NOT NULL REFERENCES coworkers (id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('LEND', 'BORROW', 'REPAYMENT')),
  amount        REAL NOT NULL CHECK (amount > 0),
  balance_after REAL NOT NULL,
  method        TEXT NOT NULL DEFAULT 'Cash',
  notes         TEXT,
  txn_date      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coworker_txn ON coworker_transactions (coworker_id, txn_date);

-- -------------------------------------------------------- stock_movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id              TEXT PRIMARY KEY,
  ram_item_id     TEXT NOT NULL REFERENCES ram_items (id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  quantity_change INTEGER NOT NULL,
  previous_stock  INTEGER NOT NULL,
  new_stock       INTEGER NOT NULL,
  movement_type   TEXT NOT NULL CHECK (movement_type IN
                    ('PURCHASE', 'SALE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
                     'SALE_RETURN', 'PURCHASE_RETURN', 'INITIAL')),
  reference_type  TEXT,
  reference_id    TEXT,
  reference_number TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_sku     ON stock_movements (sku);
CREATE INDEX IF NOT EXISTS idx_stock_mov_created ON stock_movements (created_at);
CREATE INDEX IF NOT EXISTS idx_stock_mov_item    ON stock_movements (ram_item_id);

-- --------------------------------------------------- inventory_adjustments
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id              TEXT PRIMARY KEY,
  ram_item_id     TEXT NOT NULL REFERENCES ram_items (id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('INCREASE', 'DECREASE')),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  previous_stock  INTEGER NOT NULL,
  new_stock       INTEGER NOT NULL,
  reason          TEXT NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_adj_item ON inventory_adjustments (ram_item_id);

-- -------------------------------------------------------------- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  description TEXT,
  user        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log (entity);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log (action);

-- ============================================================ seed data ==
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('business_name',    'ZEUS',                    datetime('now')),
  ('business_tagline', 'RAM INVENTORY MANAGEMENT', datetime('now')),
  ('business_address', '',                         datetime('now')),
  ('business_phone',   '',                         datetime('now')),
  ('business_email',   '',                         datetime('now')),
  ('business_trn',     '',                         datetime('now')),
  ('currency',         'AED',                     datetime('now')),
  ('timezone',         'Asia/Dubai',              datetime('now')),
  ('date_format',      'DD/MM/YYYY',              datetime('now')),
  ('low_stock_default','5',                        datetime('now')),
  ('theme',            'light',                   datetime('now')),
  ('density',          'comfortable',             datetime('now')),
  ('auto_backup',      '1',                       datetime('now')),
  ('backup_interval_hours', '24',                 datetime('now')),
  ('backup_dir',       '',                         datetime('now')),
  ('last_backup',      '',                         datetime('now')),
  ('last_backup_path', '',                         datetime('now'));

INSERT OR IGNORE INTO categories (id, name, type, created_at) VALUES
  (lower(hex(randomblob(16))), 'DDR4', 'generation', datetime('now')),
  (lower(hex(randomblob(16))), 'DDR5', 'generation', datetime('now')),
  (lower(hex(randomblob(16))), 'PC',        'category', datetime('now')),
  (lower(hex(randomblob(16))), 'Laptop',    'category', datetime('now')),
  (lower(hex(randomblob(16))), 'Server',    'category', datetime('now')),
  (lower(hex(randomblob(16))), 'Workstation','category',datetime('now'));

INSERT OR IGNORE INTO manufacturers (id, name, created_at) VALUES
  (lower(hex(randomblob(16))), 'Samsung', datetime('now')),
  (lower(hex(randomblob(16))), 'Hynix',   datetime('now')),
  (lower(hex(randomblob(16))), 'Kingston',datetime('now')),
  (lower(hex(randomblob(16))), 'Crucial', datetime('now')),
  (lower(hex(randomblob(16))), 'Corsair', datetime('now')),
  (lower(hex(randomblob(16))), 'Micron',  datetime('now')),
  (lower(hex(randomblob(16))), 'ADATA',   datetime('now')),
  (lower(hex(randomblob(16))), 'TeamGroup', datetime('now'));

INSERT OR IGNORE INTO locations (id, name, description, created_at) VALUES
  (lower(hex(randomblob(16))), 'Main Warehouse', 'Primary storage', datetime('now')),
  (lower(hex(randomblob(16))), 'Shop Floor',     'Ready for sale',  datetime('now'));

INSERT OR IGNORE INTO ram_speeds (id, speed, generation, category, description, created_at, updated_at) VALUES
  (lower(hex(randomblob(16))), '2400T', 'DDR4', 'PC',        'DDR4 PC 2400T',        datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '2666V', 'DDR4', 'PC',        'DDR4 PC 2666V',        datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '3200',  'DDR4', 'PC',        'DDR4 PC 3200',         datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '2933',  'DDR4', 'Laptop',    'DDR4 SODIMM 2933',     datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '3200',  'DDR4', 'Laptop',    'DDR4 SODIMM 3200',     datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '2400',  'DDR4', 'Server',    'DDR4 RDIMM 2400',      datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '2666V', 'DDR4', 'Server',    'DDR4 RDIMM 2666V',     datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '3200',  'DDR4', 'Server',    'DDR4 RDIMM 3200',      datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '4800',  'DDR5', 'PC',        'DDR5 PC 4800',         datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '5600',  'DDR5', 'PC',        'DDR5 PC 5600',         datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '6000',  'DDR5', 'PC',        'DDR5 PC 6000',         datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '6400',  'DDR5', 'PC',        'DDR5 PC 6400',         datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '5600',  'DDR5', 'Laptop',    'DDR5 SODIMM 5600',     datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '4800',  'DDR5', 'Server',    'DDR5 RDIMM 4800',      datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '5600',  'DDR5', 'Server',    'DDR5 RDIMM 5600',      datetime('now'), datetime('now'));