-- ZEUS RAM Inventory Management Database Schema
PRAGMA foreign_keys = ON;

-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

-- Settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME NOT NULL
);

-- RAM Speeds (configurable)
CREATE TABLE ram_speeds (
  id TEXT PRIMARY KEY,
  speed TEXT NOT NULL,
  generation TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

-- Categories
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  created_at DATETIME NOT NULL
);

-- Manufacturers
CREATE TABLE manufacturers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at DATETIME NOT NULL
);

-- Locations
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME NOT NULL
);

-- RAM Items
CREATE TABLE ram_items (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  generation TEXT NOT NULL, -- DDR4, DDR5
  category TEXT NOT NULL,    -- PC, Laptop, Server
  capacity TEXT NOT NULL,    -- 8 GB, 16 GB, etc.
  speed TEXT NOT NULL,
  ram_type TEXT,
  manufacturer TEXT,
  model TEXT,
  part_number TEXT,
  condition TEXT,
  ecc BOOLEAN DEFAULT 0,
  registered BOOLEAN DEFAULT 0,
  rank TEXT,
  module_count INTEGER DEFAULT 1,
  purchase_price REAL DEFAULT 0,
  average_cost REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  minimum_stock INTEGER DEFAULT 0,
  location TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE INDEX idx_ram_items_sku ON ram_items(sku);
CREATE INDEX idx_ram_items_generation ON ram_items(generation);
CREATE INDEX idx_ram_items_category ON ram_items(category);
CREATE INDEX idx_ram_items_capacity ON ram_items(capacity);
CREATE INDEX idx_ram_items_speed ON ram_items(speed);
CREATE INDEX idx_ram_items_quantity ON ram_items(quantity);

-- Buyers
CREATE TABLE buyers (
  id TEXT PRIMARY KEY,
  customer_id TEXT UNIQUE,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  trn_vat TEXT,
  notes TEXT,
  opening_balance REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  total_purchases REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  total_outstanding REAL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE INDEX idx_buyers_company ON buyers(company_name);
CREATE INDEX idx_buyers_phone ON buyers(phone);

-- Sellers
CREATE TABLE sellers (
  id TEXT PRIMARY KEY,
  supplier_id TEXT UNIQUE,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  trn_vat TEXT,
  notes TEXT,
  opening_balance REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  total_purchases REAL DEFAULT 0,
  total_paid REAL DEFAULT 0,
  total_outstanding REAL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE INDEX idx_sellers_company ON sellers(company_name);

-- Purchases
CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  purchase_number TEXT NOT NULL UNIQUE,
  seller_id TEXT,
  seller_name TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  remaining REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  notes TEXT,
  status TEXT DEFAULT 'completed',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE INDEX idx_purchases_number ON purchases(purchase_number);
CREATE INDEX idx_purchases_created ON purchases(created_at);

-- Purchase Items
CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  ram_item_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  generation TEXT NOT NULL,
  category TEXT NOT NULL,
  capacity TEXT NOT NULL,
  speed TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  cost_per_unit REAL NOT NULL,
  subtotal REAL NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (ram_item_id) REFERENCES ram_items(id)
);

-- Sales
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  sale_number TEXT NOT NULL UNIQUE,
  buyer_id TEXT,
  buyer_name TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  received REAL NOT NULL DEFAULT 0,
  remaining REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  total_cost REAL NOT NULL DEFAULT 0,
  gross_profit REAL NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT DEFAULT 'completed',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (buyer_id) REFERENCES buyers(id)
);

CREATE INDEX idx_sales_number ON sales(sale_number);
CREATE INDEX idx_sales_created ON sales(created_at);

-- Sale Items
CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  ram_item_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  generation TEXT NOT NULL,
  category TEXT NOT NULL,
  capacity TEXT NOT NULL,
  speed TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  selling_price REAL NOT NULL,
  cost_per_unit REAL NOT NULL,
  subtotal REAL NOT NULL,
  cost_total REAL NOT NULL,
  profit REAL NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (ram_item_id) REFERENCES ram_items(id)
);

-- Payments
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  payment_type TEXT NOT NULL, -- RECEIVED_FROM_BUYER, PAID_TO_SELLER, etc.
  person_type TEXT, -- buyer, seller, coworker
  person_id TEXT,
  person_name TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  reference TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE INDEX idx_payments_id ON payments(payment_id);
CREATE INDEX idx_payments_created ON payments(created_at);

-- Coworkers
CREATE TABLE coworkers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  current_balance REAL DEFAULT 0, -- positive if they owe us, negative if we owe them? 
  notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

-- Coworker Transactions
CREATE TABLE coworker_transactions (
  id TEXT PRIMARY KEY,
  coworker_id TEXT NOT NULL,
  type TEXT NOT NULL, -- LEND, BORROW, REPAYMENT
  amount REAL NOT NULL,
  notes TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (coworker_id) REFERENCES coworkers(id)
);

-- Stock Movements
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  ram_item_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity_change INTEGER NOT NULL, -- + or -
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  reference_number TEXT,
  user TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (ram_item_id) REFERENCES ram_items(id)
);

CREATE INDEX idx_stock_movements_sku ON stock_movements(sku);
CREATE INDEX idx_stock_movements_created ON stock_movements(created_at);

-- Inventory Adjustments
CREATE TABLE inventory_adjustments (
  id TEXT PRIMARY KEY,
  ram_item_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  adjustment_type TEXT NOT NULL, -- INCREASE, DECREASE
  quantity INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (ram_item_id) REFERENCES ram_items(id)
);

-- Audit Log
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  description TEXT,
  user TEXT,
  created_at DATETIME NOT NULL
);

CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_entity ON audit_log(entity);
CREATE INDEX idx_audit_action ON audit_log(action);

-- Insert default settings
INSERT INTO settings (key, value, updated_at) VALUES 
  ('business_name', 'ZEUS', (datetime('now'))),
  ('business_address', 'Sharjah, UAE', (datetime('now'))),
  ('currency', 'AED', (datetime('now'))),
  ('timezone', 'Asia/Dubai', (datetime('now'))),
  ('date_format', 'DD/MM/YYYY', (datetime('now')));

-- Insert default RAM speeds
INSERT INTO ram_speeds (id, speed, generation, category, description, created_at, updated_at) VALUES
  (lower(hex(randomblob(16))), '2400T', 'DDR4', 'PC', 'DDR4 PC 2400T', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '2666V', 'DDR4', 'PC', 'DDR4 PC 2666V', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '3200', 'DDR4', 'PC', 'DDR4 PC 3200', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '2666V', 'DDR4', 'Server', 'DDR4 Server 2666V', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '3200', 'DDR4', 'Server', 'DDR4 Server 3200', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '4800', 'DDR5', 'PC', 'DDR5 PC 4800', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '5600', 'DDR5', 'PC', 'DDR5 PC 5600', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '6000', 'DDR5', 'PC', 'DDR5 PC 6000', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '6400', 'DDR5', 'PC', 'DDR5 PC 6400', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '4800', 'DDR5', 'Server', 'DDR5 Server 4800', datetime('now'), datetime('now')),
  (lower(hex(randomblob(16))), '5600', 'DDR5', 'Server', 'DDR5 Server 5600', datetime('now'), datetime('now'));
