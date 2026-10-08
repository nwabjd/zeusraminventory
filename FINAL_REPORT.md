# FINAL REPORT — COMPLETE VARIANT MATRIX REBUILD (RAM speeds)

**Date:** 2026-10-06 · **Build:** `zeus-ram-inventory v1.0.0` (rel: `src-tauri\target\release\zeus-ram-inventory.exe`)
**Objective:** every applicable DDR3/DDR4/DDR5 speed is selectable and valid, capacity/manufacturer/form-factor independent of speed, one authoritative centralized speed matrix.

---

## 1. What changed

### Authoritative speed matrix (one source of truth)
- **`src-tauri/src/core/catalog.rs`** — `pub const RAM_SPEEDS_BY_GENERATION` (replaces `APPROVED_RAM_SPEEDS`), `GENERATIONS` now includes `"DDR3"`. This is the backend source of truth used by `validate_speed`, `save_speed`, `list_speeds` and the settings solver.
- **`src/lib/constants.ts`** — `RAM_SPEEDS_BY_GENERATION` (same matrix) + flattened `ALL_RAM_SPEEDS`; `GENERATIONS` from `["DDR4","DDR5"]` to `["DDR3","DDR4","DDR5"]`. Naming-convention aliases added (`RAM_GENERATIONS`, `RAM_CAPACITIES`, `RAM_FORM_FACTORS`, `RAM_ECC_TYPES`, `RAM_REGISTRATION_TYPES`, `RAM_MANUFACTURERS`). The old `APPROVED_SPEEDS` / `ALL_APPROVED_SPEEDS` exports were removed after rewiring their only consumers.
- **`src/lib/reference-data.ts`** — `speedsFor` / `speedOptionsFor` now derive purely from the matrix; `speedOptionsFor` no longer narrows by category (speed is gated by **generation only** — capacity, category, manufacturer and form factor never hide a valid speed).
- **`src/pages/Settings.tsx`** — imports `GENERATIONS` + `RAM_SPEEDS_BY_GENERATION` from constants (local 2-item list deleted), the Add/Edit speed dialog offers the per-generation matrix, DDR3 included in the settings groups, empty-state text and validation messages updated.

### Backend range widening
- **`src-tauri/src/util.rs`** — `capacity_to_gb` now handles `TB` (`"1 TB"` → 1024).

### Migration
- **`src-tauri/src/db.rs`** — `SCHEMA_VERSION` 4 → 5 with `apply_v5`:
  - **Un-archives** every archived `ram_speeds` row that is inside the expanded matrix (the DDR4 `2400`/`2933` rows archived by v4 are active again, plus any archived DDR3/DDR5 matrix row).
  - **Re-inserts** the 15 matrix rows missing from the seed (`INSERT OR IGNORE`): 6× DDR3 (PC), DDR4 `1600/1866/2133/2666` (PC), DDR5 `5200/6800/7200/7600/8000` (PC).
  - `001_init.sql` untouched (established pattern); case canonicalisation of `2400T`/`2666V` retained.

### Untouched
Payments, buyers/sellers/coworkers, purchases/sales/returns logic, reports, navigation, auth, other master data. Only RAM speed/capacity variant handling was rebuilt.

---

## 2. Old vs new speed options

| Generation | Before (approved) | After (matrix) |
|---|---|---|
| DDR3 | — (none) | `800, 1066, 1333, 1600, 1866, 2133` |
| DDR4 | `2400T, 2666V, 3200` (2400/2933 archived, unusable) | `1600, 1866, 2133, 2400, 2400T, 2666, 2666V, 2933, 3200` |
| DDR5 | `4800, 5600, 6000, 6400` | `4800, 5200, 5600, 6000, 6400, 6800, 7200, 7600, 8000` |

- Legacy `2400T`/`2666V` conventions are **not destroyed and not silently converted**; they remain stored verbatim for existing rows and stay independently selectable alongside the plain JEDEC values.
- Distinct labels offered across the app: **21** (1600/1866/2133 are shared by DDR3 and DDR4; per-generation counts are 6 / 9 / 9).

## 3. Capacity & manufacturer handling

- Backend capacity range widened **4–256 GB → 1 GB–1 TB (1024 GB)**; `parse_capacity_gb` accepts `"8"`, `"8 GB"`, `"512 GB"`, `"1 TB"` (case-insensitive, TB × 1024).
- `CAPACITIES` extended rather than replaced: `1 GB, 2 GB, 4 GB, 8 GB, 16 GB, 32 GB, 64 GB, 128 GB, 256 GB, 512 GB, 1 TB`.
- **Capacity never filters speed** (unit test `ddr4_capacity_does_not_restrict_speed` — every DDR4 speed valid at 8/16/32 GB).
- **Manufacturer never filters speed** (unit test `manufacturer_does_not_restrict_speed` — 2933 valid across Samsung/Micron/SK hynix/Kingston/ADATA).
- **Category no longer filters speed** (`speedOptionsFor` is generation-only), so e.g. `DDR4 + Laptop + 2400` and `DDR3 + Server + 1333` are selectable.
- RAM type/ECC/Registered remain separate fields (`Module type` select; `ECC`/`Registered/buffered` checkboxes).

## 4. Dropdown fix & tab behaviour

- Selected values **stay visibly in their fields** after selection (live-verified: `8 GB` + `2400` held in the New RAM item dialog).
- **No auto tab changes / no self-clearing select.** The only clearance is intentional: switching **generation** clears a speed that the new generation genuinely cannot hold (e.g. `5200` → DDR4 clears; `1600` shared by DDR3+DDR4 **does not** clear). Category/capacity/manufacturer changes never clear speed.
- Editing an existing item **pre-fills the current speed** (verified: edit dialog opened with `2400` already selected).

## 5. Persistence

- Create `DDR4 / PC / 8 GB / 2400` → row appears in Inventory (`DDR4 PC 8 GB 2400`), edit to `2933` → row shows `DDR4 PC 8 GB 2933`, navigate away and back → still `2933`. Backend `audit_log` shows `UPDATE RAM_ITEM Z-D4-PC-8-2400-0001`.
- Create `DDR3 / PC / 8 GB / 1600` → row appears (`DDR3 PC 8 GB 1600`).
- Settings Add-speed and Remove-speed flows both work (add `DDR3 800 Workstation`, remove it; the author's first removal pass hit the wrong duplicate-label chip and deleted the seeded `800 PC` row — it was re-added via the same UI and the DB returned to the intended 30-row baseline).
- Import/export paths were not modified; they serialize the stored `speed` string, so matrix labels survive round-trips.

---

## 6. Tests run and results (all real, against real UI + real DB)

| Check | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | ✅ clean |
| `vite build` + CSS guard `scripts/check-css.mjs` | ✅ built; CSS OK |
| `cargo test --features=custom-protocol` (21 unit + 48 integration) | ✅ all pass |
| `tauri build -- --features=custom-protocol` | ✅ binary + MSI + NSIS |
| **Production DB migration v4→v5** | ✅ `user_version 5`, 30 speed rows, **0 archived**, 0 items preserved |
| Live CDP **matrix verify** (9 checks) | ✅ 9/9 — Settings chips per gen; Add-speed dialog options 6/9/9; New RAM item dialog 6/9/9 with generation-clear logic; Buy quick-item dialog 6/9/9; Speed filters on Inventory, Purchases, Sales, Reports (21 all / 6 DDR3 / 9 DDR4 / 9 DDR5); navigation stability |
| Live CDP **CRUD verify** | ✅ speed add/remove; create DDR4 2400; edit→2933 (prefilled); persistence after nav; create DDR3 1600; archive both (ReasonDialog; DB `is_archived=1`, archived SKUs hidden from working catalogue as designed) |
| Final DB state | ✅ **0 SKUs**, 30 speed rows (DDR3 6 / DDR4 12 / DDR5 12), 0 archived, no orphaned child rows, audit log back to pre-test state |

## 7. Limitations / notes

- `DDR4` deliberately offers both plain JEDEC labels and the legacy `2400T`/`2666V` labels; there is **no automatic mapping** between them (a 2400T row stays 2400T). That keeps existing data and label conventions intact at the cost of two “equivalent” labels.
- Speed options are generation-scoped for **all** categories (e.g. DDR4 2933 shows for PC/Workstation, not just Laptop) — an intentional trade-off to guarantee every speed is selectable regardless of category; capacity/manufacturer/form-factor independence is thereby preserved.
- `apply_v5` re-inserts only the documented seed rows; user-added matrix-label rows under other categories are left untouched (`INSERT OR IGNORE`) and remain active.
- Rows outside the matrix (from any historical build) stay archived — `validate_speed`/`save_speed`/`list_speeds` still reject them, while items already carrying those strings keep them on edit (the only case a non-matrix label appears, pinned to the editing item only).
- Production DB backup taken before migration: `%APPDATA%\com.zeus.raminventory\backups\pre-v5-20261006-181005\`.