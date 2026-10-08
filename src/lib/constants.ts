/* ===========================================================================
   Static master data used to build form controls.
   ---------------------------------------------------------------------------
   The RAM speed matrix (`RAM_SPEEDS_BY_GENERATION`) is the ONE authoritative
   speed configuration: Settings manages categories/descriptions for those
   labels but cannot invent new speed values, and the backend enforces the same
   matrix (`catalog::RAM_SPEEDS_BY_GENERATION`).
   =========================================================================== */

import type { Generation } from "./types";

export const GENERATIONS: Generation[] = ["DDR3", "DDR4", "DDR5"];

/** Alias kept for the naming convention; same values as `GENERATIONS`. */
export const RAM_GENERATIONS: Generation[] = GENERATIONS;

/** Required categories; Settings can add more through master data. */
export const CATEGORIES = ["PC", "Laptop", "Server"];

export const RAM_TYPES = ["DIMM", "SODIMM", "RDIMM", "LRDIMM", "UDIMM"];

/** Form-factor aliases; ECC / Registered stay separate boolean fields. */
export const RAM_FORM_FACTORS: string[] = RAM_TYPES;

/** ECC semantics offered by the item form's checkbox. */
export const RAM_ECC_TYPES = ["Non-ECC", "ECC"];

/** Registered / buffered semantics offered by the item form's checkbox. */
export const RAM_REGISTRATION_TYPES = ["Unbuffered", "Registered"];

/** Validated conditions seen on item forms; the backend enforces these five. */
export const CONDITIONS = ["New", "Refurbished", "Used", "Pulled", "Mixed"];

export const RANKS = ["1Rx4", "1Rx8", "2Rx4", "2Rx8", "2Rx16", "4Rx4"];

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Cheque", "Card", "Credit"];

export const CITIES = [
  "Dubai",
  "Sharjah",
  "Abu Dhabi",
  "Ajman",
  "Umm Al Quwain",
  "Ras Al Khaimah",
  "Fujairah",
  "Al Ain",
];

export const ADJUSTMENT_REASONS = [
  "Stock count correction",
  "Damaged",
  "Returned to supplier",
  "Sample / demo unit",
  "Found in store",
  "Lost",
  "Internal use",
];

/** The ZEUS RAM speed matrix - the single authoritative speed configuration.
    DDR4 carries the legacy 2400T / 2666V labels alongside the plain JEDEC
    baseline so existing data and conventions stay intact. The backend enforces
    the same matrix (`catalog::RAM_SPEEDS_BY_GENERATION`) and migration 005
    un-archives / re-seeds every label, so no dropdown can grow beyond this and
    no approved label can ever go missing. Keep the two lists in sync. */
export const RAM_SPEEDS_BY_GENERATION: Record<Generation, string[]> = {
  DDR3: ["800", "1066", "1333", "1600", "1866", "2133"],
  DDR4: ["1600", "1866", "2133", "2400", "2400T", "2666", "2666V", "2933", "3200"],
  DDR5: ["4800", "5200", "5600", "6000", "6400", "6800", "7200", "7600", "8000"],
};

/** Every label the matrix knows, flattened - used by "any generation" filters. */
export const ALL_RAM_SPEEDS: string[] = [
  ...RAM_SPEEDS_BY_GENERATION.DDR3,
  ...RAM_SPEEDS_BY_GENERATION.DDR4,
  ...RAM_SPEEDS_BY_GENERATION.DDR5,
];

/**
 * Factory RAM speeds - the rows migration 001/004/005 guarantee for a brand-new
 * database (the legacy 2400T / 2666V / 3200 rows plus the expanded DDR3/DDR4/
 * DDR5 matrix). Unused by the app itself (the database is the source of truth);
 * kept as a documentation-grade mirror of the seed.
 */
export const DEFAULT_SPEEDS: {
  speed: string;
  generation: Generation;
  category: string;
  description: string;
}[] = [
  // DDR3
  { speed: "800", generation: "DDR3", category: "PC", description: "DDR3 PC 800" },
  { speed: "1066", generation: "DDR3", category: "PC", description: "DDR3 PC 1066" },
  { speed: "1333", generation: "DDR3", category: "PC", description: "DDR3 PC 1333" },
  { speed: "1600", generation: "DDR3", category: "PC", description: "DDR3 PC 1600" },
  { speed: "1866", generation: "DDR3", category: "PC", description: "DDR3 PC 1866" },
  { speed: "2133", generation: "DDR3", category: "PC", description: "DDR3 PC 2133" },
  // DDR4 - seed rows
  { speed: "2400T", generation: "DDR4", category: "PC", description: "DDR4 PC 2400T" },
  { speed: "2666V", generation: "DDR4", category: "PC", description: "DDR4 PC 2666V" },
  { speed: "2666V", generation: "DDR4", category: "Server", description: "DDR4 RDIMM 2666V" },
  { speed: "3200", generation: "DDR4", category: "PC", description: "DDR4 PC 3200" },
  { speed: "3200", generation: "DDR4", category: "Laptop", description: "DDR4 SODIMM 3200" },
  { speed: "3200", generation: "DDR4", category: "Server", description: "DDR4 RDIMM 3200" },
  { speed: "2933", generation: "DDR4", category: "Laptop", description: "DDR4 SODIMM 2933" },
  { speed: "2400", generation: "DDR4", category: "Server", description: "DDR4 RDIMM 2400" },
  // DDR4 - expanded matrix
  { speed: "1600", generation: "DDR4", category: "PC", description: "DDR4 PC 1600" },
  { speed: "1866", generation: "DDR4", category: "PC", description: "DDR4 PC 1866" },
  { speed: "2133", generation: "DDR4", category: "PC", description: "DDR4 PC 2133" },
  { speed: "2666", generation: "DDR4", category: "PC", description: "DDR4 PC 2666" },
  // DDR5 - seed rows
  { speed: "4800", generation: "DDR5", category: "PC", description: "DDR5 PC 4800" },
  { speed: "4800", generation: "DDR5", category: "Server", description: "DDR5 RDIMM 4800" },
  { speed: "5600", generation: "DDR5", category: "PC", description: "DDR5 PC 5600" },
  { speed: "5600", generation: "DDR5", category: "Laptop", description: "DDR5 SODIMM 5600" },
  { speed: "5600", generation: "DDR5", category: "Server", description: "DDR5 RDIMM 5600" },
  { speed: "6000", generation: "DDR5", category: "PC", description: "DDR5 PC 6000" },
  { speed: "6400", generation: "DDR5", category: "PC", description: "DDR5 PC 6400" },
  // DDR5 - expanded matrix
  { speed: "5200", generation: "DDR5", category: "PC", description: "DDR5 PC 5200" },
  { speed: "6800", generation: "DDR5", category: "PC", description: "DDR5 PC 6800" },
  { speed: "7200", generation: "DDR5", category: "PC", description: "DDR5 PC 7200" },
  { speed: "7600", generation: "DDR5", category: "PC", description: "DDR5 PC 7600" },
  { speed: "8000", generation: "DDR5", category: "PC", description: "DDR5 PC 8000" },
];

export const DEFAULT_MANUFACTURERS = [
  "Samsung",
  "Hynix",
  "Kingston",
  "Crucial",
  "Corsair",
  "Micron",
  "ADATA",
  "TeamGroup",
  "G.Skill",
  "Transcend",
];

export const DEFAULT_LOCATIONS = ["Main Warehouse", "Shop Floor"];

/** Manufacturer baseline; Settings and used values extend it at runtime. */
export const RAM_MANUFACTURERS: string[] = DEFAULT_MANUFACTURERS;

/** Sort keys understood by `catalog::list` - do not rename without changing Rust. */
export const INVENTORY_SORTS = [
  { value: "sku_asc", label: "SKU (A-Z)" },
  { value: "sku_desc", label: "SKU (Z-A)" },
  { value: "qty_desc", label: "Stock (high to low)" },
  { value: "qty_asc", label: "Stock (low to high)" },
  { value: "value_desc", label: "Stock value (high to low)" },
  { value: "capacity", label: "Capacity (high to low)" },
  { value: "created", label: "Recently added" },
];

/** `catalog::list` stock-status filter keys. */
export const STOCK_STATUS_FILTERS = [
  { value: "in_stock", label: "In stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
];

export const PAYMENT_TYPES = [
  { value: "RECEIVE_FROM_BUYER", label: "Receive payment from buyer" },
  { value: "PAY_SELLER", label: "Pay seller" },
  { value: "COWORKER_LEND", label: "Lend to coworker" },
  { value: "COWORKER_BORROW", label: "Borrow from coworker" },
  { value: "COWORKER_RECEIVE", label: "Coworker repayment received" },
  { value: "COWORKER_REPAY", label: "Repay coworker" },
];

/** Supported capacities - the backend accepts 1 GB .. 1024 GB (1 TB). */
export const CAPACITIES = ["1 GB", "2 GB", "4 GB", "8 GB", "16 GB", "32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"];

/** Alias kept for the naming convention; same values as `CAPACITIES`. */
export const RAM_CAPACITIES: string[] = CAPACITIES;
