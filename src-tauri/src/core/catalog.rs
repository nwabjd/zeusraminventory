//! RAM catalogue: CRUD, filtering, fast search and reference/master data.

use crate::error::{AppError, AppResult};
use crate::models::{AdjustmentInput, NamedValue, RamItem, RamItemInput, RamSpeed};
use crate::util::{
    generate_sku, money, new_id, now, validate_non_negative, validate_quantity, validate_required,
};
use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection};

/// Built-in generations. The user can still add more through the `categories`
/// master table (Settings ▸ Categories); this list is the spec baseline.
const GENERATIONS: &[&str] = &["DDR3", "DDR4", "DDR5"];
/// Built-in categories. `known_label` also accepts rows added in Settings, e.g.
/// the seeded "Workstation" row, so tightening these never orphans existing data.
const CATEGORIES: &[&str] = &["PC", "Laptop", "Server"];

/// The ZEUS RAM speed matrix - the ONLY labels ZEUS offers, grouped by DDR
/// generation. DDR4 keeps the legacy 2400T / 2666V labels alongside the plain
/// JEDEC baseline, so existing items and the historical master rows never need
/// rewriting. `save_speed` rejects anything outside it and migration 005
/// un-archives / re-seeds every label, so no dropdown can ever grow beyond this.
/// This mirrors `RAM_SPEEDS_BY_GENERATION` in `src/lib/constants.ts` - keep
/// the two in sync.
pub const RAM_SPEEDS_BY_GENERATION: &[(&str, &[&str])] = &[
    ("DDR3", &["800", "1066", "1333", "1600", "1866", "2133"]),
    (
        "DDR4",
        &["1600", "1866", "2133", "2400", "2400T", "2666", "2666V", "2933", "3200"],
    ),
    (
        "DDR5",
        &["4800", "5200", "5600", "6000", "6400", "6800", "7200", "7600", "8000"],
    ),
];

/// The approved speed labels for one generation, or `None` for a generation the
/// matrix does not cover (legacy rows stay usable but are never offered).
fn speed_matrix_for(generation: &str) -> Option<&'static [&'static str]> {
    RAM_SPEEDS_BY_GENERATION
        .iter()
        .find(|(gen, _)| gen.eq_ignore_ascii_case(generation))
        .map(|(_, speeds)| *speeds)
}

/// Case-insensitive lookup of a speed in the approved list for a generation.
/// Returns the canonical label so stored values never drift in casing.
fn approved_speed_for(generation: &str, speed: &str) -> Option<&'static str> {
    speed_matrix_for(generation).and_then(|speeds| {
        speeds
            .iter()
            .find(|s| s.eq_ignore_ascii_case(speed))
            .copied()
    })
}

// ================================================================= filter ===

#[derive(Debug, Clone, Default)]
pub struct RamFilter {
    pub search: String,
    pub generation: Option<String>,
    pub category: Option<String>,
    pub capacity: Option<String>,
    pub speed: Option<String>,
    pub manufacturer: Option<String>,
    pub condition: Option<String>,
    pub location: Option<String>,
    /// `all` | `in_stock` | `low` | `out`
    pub stock_status: String,
    pub include_archived: bool,
    pub sort: String,
    pub limit: Option<i64>,
}

impl RamFilter {
    fn any(s: &Option<String>) -> bool {
        s.as_ref().is_some_and(|v| !v.is_empty() && v != "all" && v != "ALL")
    }
}

// ================================================================== rows ===

fn status_of(qty: i64, minimum: i64) -> &'static str {
    if qty <= 0 {
        "out_of_stock"
    } else if qty <= minimum {
        "low_stock"
    } else {
        "in_stock"
    }
}

const RAM_COLUMNS: &str = "id, sku, generation, category, capacity, capacity_gb, speed, ram_type,
     manufacturer, model, part_number, condition, ecc, registered, rank, module_count,
     purchase_price, average_cost, selling_price, quantity, minimum_stock, location, notes,
     is_archived, created_at, updated_at";

pub fn map_ram(r: &rusqlite::Row<'_>) -> rusqlite::Result<RamItem> {
    let qty: i64 = r.get(19)?;
    let minimum: i64 = r.get(20)?;
    let average_cost: f64 = r.get(17)?;
    let selling_price: f64 = r.get(18)?;
    Ok(RamItem {
        id: r.get(0)?,
        sku: r.get(1)?,
        generation: r.get(2)?,
        category: r.get(3)?,
        capacity: r.get(4)?,
        capacity_gb: r.get(5)?,
        speed: r.get(6)?,
        ram_type: r.get(7)?,
        manufacturer: r.get(8)?,
        model: r.get(9)?,
        part_number: r.get(10)?,
        condition: r.get(11)?,
        ecc: r.get(12)?,
        registered: r.get(13)?,
        rank: r.get(14)?,
        module_count: r.get(15)?,
        purchase_price: r.get(16)?,
        average_cost,
        selling_price,
        quantity: qty,
        minimum_stock: minimum,
        location: r.get(21)?,
        notes: r.get(22)?,
        is_archived: r.get(23)?,
        stock_status: status_of(qty, minimum).to_string(),
        inventory_value: money(average_cost * qty as f64),
        retail_value: money(selling_price * qty as f64),
        created_at: r.get(24)?,
        updated_at: r.get(25)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<RamItem> {
    conn.query_row(
        &format!("SELECT {RAM_COLUMNS} FROM ram_items WHERE id = ?1"),
        [id],
        map_ram,
    )
    .map_err(|_| AppError::not_found(format!("RAM item {id} was not found.")))
}

pub fn get_by_sku(conn: &Connection, sku: &str) -> AppResult<RamItem> {
    conn.query_row(
        &format!("SELECT {RAM_COLUMNS} FROM ram_items WHERE sku = ?1"),
        [sku],
        map_ram,
    )
    .map_err(|_| AppError::not_found(format!("No RAM item with SKU {sku}.")))
}

// ================================================================== list ===

pub fn list(conn: &Connection, f: &RamFilter) -> AppResult<Vec<RamItem>> {
    let mut where_parts: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();

    macro_rules! push {
        ($cond:expr, $val:expr) => {{
            args.push($val);
            where_parts.push($cond.replace('?', &format!("?{}", args.len())));
        }};
    }

    if !f.include_archived {
        where_parts.push("is_archived = 0".into());
    }

    let search = f.search.trim();
    if !search.is_empty() {
        // Every whitespace-separated token must match somewhere, which makes
        // "DDR4 32 2666V server" behave the way a RAM trader expects.
        for token in search.split_whitespace().take(8) {
            let like = format!("%{token}%");
            args.push(Value::Text(like));
            let n = args.len();
            where_parts.push(format!(
                "(sku LIKE ?{n} OR generation LIKE ?{n} OR category LIKE ?{n} OR capacity LIKE ?{n} \
                  OR speed LIKE ?{n} OR manufacturer LIKE ?{n} OR model LIKE ?{n} \
                  OR part_number LIKE ?{n} OR location LIKE ?{n})"
            ));
        }
    }

    if RamFilter::any(&f.generation) {
        push!("generation = ?", Value::Text(f.generation.clone().unwrap()));
    }
    if RamFilter::any(&f.category) {
        push!("category = ?", Value::Text(f.category.clone().unwrap()));
    }
    if RamFilter::any(&f.speed) {
        push!("speed = ?", Value::Text(f.speed.clone().unwrap()));
    }
    if RamFilter::any(&f.manufacturer) {
        push!("manufacturer = ?", Value::Text(f.manufacturer.clone().unwrap()));
    }
    if RamFilter::any(&f.condition) {
        push!("condition = ?", Value::Text(f.condition.clone().unwrap()));
    }
    if RamFilter::any(&f.location) {
        push!("location = ?", Value::Text(f.location.clone().unwrap()));
    }
    if RamFilter::any(&f.capacity) {
        let cap = f.capacity.clone().unwrap();
        if let Some(min) = cap.strip_prefix(">=") {
            push!(
                "capacity_gb >= ?",
                Value::Integer(min.trim().parse::<i64>().unwrap_or(0))
            );
        } else {
            push!("capacity = ?", Value::Text(cap));
        }
    }

    match f.stock_status.as_str() {
        "in_stock" => where_parts.push("quantity > minimum_stock AND quantity > 0".into()),
        "low" => where_parts.push("quantity > 0 AND quantity <= minimum_stock".into()),
        "out" => where_parts.push("quantity <= 0".into()),
        _ => {}
    }

    let order = match f.sort.as_str() {
        "sku_desc" => "sku DESC",
        "qty_asc" => "quantity ASC, sku ASC",
        "qty_desc" => "quantity DESC, sku ASC",
        "value_desc" => "(quantity * average_cost) DESC, sku ASC",
        "capacity" => "capacity_gb DESC, speed DESC, sku ASC",
        "created" => "created_at DESC",
        _ => "sku ASC",
    };

    let mut sql = format!("SELECT {RAM_COLUMNS} FROM ram_items");
    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }
    sql.push_str(&format!(" ORDER BY {order}"));
    if let Some(limit) = f.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
    }

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), map_ram)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Type-ahead search used by the buy / sell / global-search pickers.
pub fn search(conn: &Connection, query: &str, in_stock_only: bool, limit: i64) -> AppResult<Vec<RamItem>> {
    let limit = limit.clamp(1, 200);
    let q = query.trim();
    if q.is_empty() {
        let sql = format!(
            "SELECT {RAM_COLUMNS} FROM ram_items
              WHERE is_archived = 0 {{stock}}
              ORDER BY sku ASC LIMIT {limit}"
        );
        let sql = sql.replace("{stock}", if in_stock_only { "AND quantity > 0" } else { "" });
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], map_ram)?;
        return Ok(rows.collect::<Result<Vec<_>, _>>()?);
    }

    // Rank exact SKU first, then prefix matches, then anything containing.
    let like = format!("%{q}%");
    let prefix = format!("{}%", q.to_uppercase());
    let stock = if in_stock_only { "AND quantity > 0" } else { "" };
    let sql = format!(
        "SELECT {RAM_COLUMNS} FROM ram_items
          WHERE is_archived = 0
            AND (UPPER(sku) LIKE ? OR UPPER(sku) LIKE ? OR generation LIKE ?
                 OR category LIKE ? OR capacity LIKE ? OR speed LIKE ?
                 OR manufacturer LIKE ? OR model LIKE ? OR part_number LIKE ?
                 OR location LIKE ?)
            {stock}
          ORDER BY CASE WHEN UPPER(sku) = ? THEN 0 WHEN UPPER(sku) LIKE ? THEN 1 ELSE 2 END,
                   quantity DESC, sku ASC
          LIMIT {limit}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params![
            like, prefix, like, like, like, like, like, like, like, like,
            q.to_uppercase(), prefix
        ],
        map_ram,
    )?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn low_stock(conn: &Connection, limit: i64) -> AppResult<Vec<RamItem>> {
    let mut stmt = conn.prepare(
        &format!(
            "SELECT {RAM_COLUMNS} FROM ram_items
              WHERE is_archived = 0 AND quantity <= minimum_stock
              ORDER BY (quantity - minimum_stock) ASC, sku ASC LIMIT {limit}"
        ),
    )?;
    let rows = stmt.query_map([], map_ram)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ================================================================= write ===

/// True when `value` is a known generation/category — either one of the
/// built-in defaults or one the user added under Settings ▸ Reference Data.
/// Without the database check, anything added in Settings would be rejected
/// here and the master-data screen would be decorative.
fn known_label(conn: &Connection, kind: &str, defaults: &[&str], value: &str) -> bool {
    if defaults.contains(&value) {
        return true;
    }
    let found = conn
        .query_row(
            "SELECT 1 FROM categories WHERE type = ?1 AND UPPER(name) = UPPER(?2)",
            [kind, value],
            |_| Ok(()),
        )
        .is_ok();
    found
}

/// Strict capacity parser for item writes: `"32"`, `"32 GB"`, `"32gb"` and
/// `"1 TB"` are accepted; free text, ranges and junk are rejected. The
/// supported range is 1-1024 GB (1 GB .. 1 TB).
fn parse_capacity_gb(capacity: &str) -> AppResult<i64> {
    let trimmed = capacity.trim();
    let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return Err(AppError::validation(
            "Capacity must be a number followed by GB or TB, for example 16 GB.".to_string(),
        ));
    }
    let rest = trimmed[digits.len()..].trim();
    let multiplier: i64 = if rest.is_empty() {
        1
    } else if rest.eq_ignore_ascii_case("GB") {
        1
    } else if rest.eq_ignore_ascii_case("TB") {
        1024
    } else {
        return Err(AppError::validation(
            "Capacity must be a number followed by GB or TB, for example 16 GB.".to_string(),
        ));
    };
    let value = digits
        .parse::<i64>()
        .map_err(|_| AppError::validation("Capacity is not a valid number."))?;
    Ok(value * multiplier)
}

/// A RAM speed must exist in the RAM speed master list *for the item's
/// generation*. Generations with no configured speeds (e.g. a legacy HBM2 row)
/// are not gated so pre-existing stock stays usable. Archived rows (migration
/// 004) count as not configured - stale labels can never be attached to a new
/// or updated item.
fn validate_speed(conn: &Connection, generation: &str, speed: &str) -> AppResult<()> {
    let configured: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ram_speeds
          WHERE UPPER(generation) = UPPER(?1) AND archived_at IS NULL",
        [generation],
        |r| r.get(0),
    )?;
    if configured == 0 {
        return Ok(());
    }
    let in_master = conn
        .query_row(
            "SELECT 1 FROM ram_speeds
              WHERE UPPER(generation) = UPPER(?1) AND UPPER(speed) = UPPER(?2)
                AND archived_at IS NULL
              LIMIT 1",
            rusqlite::params![generation, speed],
            |_| Ok(()),
        )
        .is_ok();
    if !in_master {
        return Err(AppError::validation(format!(
            "Speed '{speed}' is not in the approved RAM speed master list for {generation}. \
             Allowed values: {}.",
            speed_matrix_for(generation)
                .map(|speeds| speeds.join(", "))
                .unwrap_or_else(|| "none".to_string())
        )));
    }
    Ok(())
}

/// Conditions are validated against the built-in list (`New`, `Refurbished`,
/// `Used`, `Pulled`, `Mixed` - see `settings::CONDITIONS`) and canonicalised to
/// the exact spelling. Blank means "not specified" and stores NULL.
fn canonical_condition(input: &RamItemInput) -> AppResult<Option<String>> {
    let raw = input.condition.as_deref().map(str::trim).unwrap_or("");
    if raw.is_empty() {
        return Ok(None);
    }
    match super::settings::CONDITIONS
        .iter()
        .find(|c| c.eq_ignore_ascii_case(raw))
    {
        Some(canonical) => Ok(Some((*canonical).to_string())),
        None => Err(AppError::validation(format!(
            "Condition must be one of: {}.",
            super::settings::CONDITIONS.join(", ")
        ))),
    }
}

fn validate(
    conn: &Connection,
    input: &RamItemInput,
) -> AppResult<(String, String, i64, f64, f64, f64, i64, i64, Option<String>)> {
    let generation = validate_required(&input.generation, "Generation")?.to_uppercase();
    if !known_label(conn, "generation", GENERATIONS, &generation) {
        return Err(AppError::validation(format!(
            "Generation must be one of: {}.",
            GENERATIONS.join(", ")
        )));
    }
    let category = validate_required(&input.category, "Category")?;
    if !known_label(conn, "category", CATEGORIES, &category) {
        return Err(AppError::validation(format!(
            "Category must be one of: {}.",
            CATEGORIES.join(", ")
        )));
    }
    let capacity = validate_required(&input.capacity, "Capacity")?;
    let capacity_gb = parse_capacity_gb(&capacity)?;
    if !(1..=1024).contains(&capacity_gb) {
        return Err(AppError::validation(format!(
            "Capacity must be between 1 GB and 1024 GB (1, 2, 4, 8, 16, 32, 64, 128, 256, 512 or 1024), got {capacity_gb} GB."
        )));
    }
    let speed = validate_required(&input.speed, "Speed")?;
    validate_speed(conn, &generation, &speed)?;
    let condition = canonical_condition(input)?;
    let purchase_price = validate_non_negative(input.purchase_price, "Purchase price")?;
    let selling_price = validate_non_negative(input.selling_price, "Selling price")?;
    let opening_quantity = validate_quantity(input.opening_quantity, "Opening quantity", true)?;
    let minimum_stock = validate_quantity(input.minimum_stock, "Minimum stock", true)?;

    Ok((
        generation,
        category,
        capacity_gb,
        purchase_price,
        selling_price,
        0.0, // average_cost placeholder, replaced by caller
        opening_quantity,
        minimum_stock,
        condition,
    ))
}

pub fn create(conn: &mut Connection, input: &RamItemInput) -> AppResult<RamItem> {
    let (generation, category, capacity_gb, purchase_price, selling_price, _, opening_qty, minimum_stock, condition) =
        validate(conn, input)?;

    let sku = match input.sku.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(s) => s.trim().to_uppercase(),
        None => generate_sku(conn, &generation, &category, &input.capacity, &input.speed)?,
    };

    if conn
        .query_row("SELECT 1 FROM ram_items WHERE sku = ?1", [&sku], |_| Ok(()))
        .is_ok()
    {
        return Err(AppError::conflict(format!("SKU {sku} already exists.")));
    }

    let id = new_id();
    let ts = now();
    let module_count = if input.module_count < 1 { 1 } else { input.module_count };
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO ram_items
           (id, sku, generation, category, capacity, capacity_gb, speed, ram_type, manufacturer,
            model, part_number, condition, ecc, registered, rank, module_count, purchase_price,
            average_cost, selling_price, quantity, minimum_stock, location, notes,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                 ?18, ?19, 0, ?20, ?21, ?22, ?23, ?23)",
        rusqlite::params![
            id,
            sku,
            generation,
            category,
            input.capacity.trim(),
            capacity_gb,
            input.speed.trim(),
            input.ram_type,
            input.manufacturer,
            input.model,
            input.part_number,
            condition,
            input.ecc as i64,
            input.registered as i64,
            input.rank,
            module_count,
            purchase_price,
            purchase_price,
            selling_price,
            minimum_stock,
            input.location,
            input.notes,
            ts
        ],
    )?;

    if opening_qty > 0 {
        super::stock::adjust(
            &tx,
            &id,
            "INCREASE",
            opening_qty,
            "Opening stock",
            Some("Opening balance when the item was created"),
        )?;
    }

    super::log(
        &tx,
        "CREATE",
        "RAM_ITEM",
        Some(id.as_str()),
        &format!("Created RAM item {sku}"),
    );

    tx.commit()?;
    get(conn, &id)
}

pub fn update(conn: &mut Connection, id: &str, input: &RamItemInput) -> AppResult<RamItem> {
    let existing = get(conn, id)?;
    let (generation, category, capacity_gb, purchase_price, selling_price, _, _, minimum_stock, condition) =
        validate(conn, input)?;

    let sku = match input.sku.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(s) => s.trim().to_uppercase(),
        None => existing.sku.clone(),
    };
    if sku != existing.sku
        && conn
            .query_row("SELECT 1 FROM ram_items WHERE sku = ?1", [&sku], |_| Ok(()))
            .is_ok()
    {
        return Err(AppError::conflict(format!("SKU {sku} already exists.")));
    }

    let ts = now();
    conn.execute(
        "UPDATE ram_items SET
            sku = ?2, generation = ?3, category = ?4, capacity = ?5, capacity_gb = ?6,
            speed = ?7, ram_type = ?8, manufacturer = ?9, model = ?10, part_number = ?11,
            condition = ?12, ecc = ?13, registered = ?14, rank = ?15, module_count = ?16,
            purchase_price = ?17, selling_price = ?18, minimum_stock = ?19, location = ?20,
            notes = ?21, updated_at = ?22
          WHERE id = ?1",
        rusqlite::params![
            id,
            sku,
            generation,
            category,
            input.capacity.trim(),
            capacity_gb,
            input.speed.trim(),
            input.ram_type,
            input.manufacturer,
            input.model,
            input.part_number,
            condition,
            input.ecc as i64,
            input.registered as i64,
            input.rank,
            if input.module_count < 1 { 1 } else { input.module_count },
            purchase_price,
            selling_price,
            minimum_stock,
            input.location,
            input.notes,
            ts
        ],
    )?;

    super::audit::write(conn, "UPDATE", "RAM_ITEM", Some(id), &format!("Updated RAM item {sku}"))?;
    get(conn, id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> AppResult<RamItem> {
    get(conn, id)?;
    conn.execute(
        "UPDATE ram_items SET is_archived = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, archived as i64, now()],
    )?;
    super::audit::write(
        conn,
        if archived { "ARCHIVE" } else { "RESTORE" },
        "RAM_ITEM",
        Some(id),
        if archived { "Archived RAM item" } else { "Restored RAM item" },
    )?;
    get(conn, id)
}

pub fn adjust_stock(conn: &mut Connection, input: &AdjustmentInput) -> AppResult<AdjustmentOutcome> {
    let reason = validate_required(&input.reason, "Reason")?;
    if input.adjustment_type != "INCREASE" && input.adjustment_type != "DECREASE" {
        return Err(AppError::validation("Adjustment type must be Increase or Decrease."));
    }

    let tx = conn.transaction()?;
    let adj = super::stock::adjust(
        &tx,
        &input.ram_item_id,
        &input.adjustment_type,
        input.quantity,
        &reason,
        input.notes.as_deref(),
    )?;
    super::log(
        &tx,
        "ADJUST",
        "RAM_ITEM",
        Some(&input.ram_item_id),
        &format!(
            "{} {} units ({reason})",
            if input.adjustment_type == "DECREASE" { "Removed" } else { "Added" },
            adj.quantity
        ),
    );
    tx.commit()?;

    Ok(AdjustmentOutcome {
        item: get(conn, &input.ram_item_id)?,
        adjustment: adj,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdjustmentOutcome {
    pub item: RamItem,
    pub adjustment: crate::models::InventoryAdjustment,
}

// =========================================================== master data ===

pub fn list_speeds(conn: &Connection, generation: Option<&str>) -> AppResult<Vec<RamSpeed>> {
    let mut sql = String::from(
        "SELECT id, speed, generation, category, description FROM ram_speeds \
         WHERE archived_at IS NULL",
    );
    let mut args: Vec<Value> = Vec::new();
    if generation.is_some_and(|g| !g.is_empty() && g != "all") {
        args.push(Value::Text(generation.unwrap().to_string()));
        sql.push_str(&format!(" AND generation = ?{}", args.len()));
    }
    sql.push_str(" ORDER BY generation, category, speed");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), |r| {
        Ok(RamSpeed {
            id: r.get(0)?,
            speed: r.get(1)?,
            generation: r.get(2)?,
            category: r.get(3)?,
            description: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_speed(
    conn: &Connection,
    id: Option<&str>,
    speed: &str,
    generation: &str,
    category: &str,
    description: Option<&str>,
) -> AppResult<RamSpeed> {
    let speed = validate_required(speed, "Speed")?;
    let generation = validate_required(generation, "Generation")?.to_uppercase();
    let category = validate_required(category, "Category")?;

    // The ZEUS speed matrix is closed: only its labels can be stored, in their
    // exact spelling. Anything else is a validation error - this is also what
    // keeps a Settings screen with a free-text field honest.
    let canonical = approved_speed_for(&generation, &speed).ok_or_else(|| {
        let allowed = speed_matrix_for(&generation)
            .map(|speeds| speeds.join(", "))
            .unwrap_or_else(|| "no speeds are approved for this generation".to_string());
        AppError::validation(format!(
            "Speed '{speed}' is not in the approved ZEUS RAM speed matrix for {generation}. \
             Allowed values: {allowed}."
        ))
    })?;

    match id.filter(|i| !i.is_empty()) {
        Some(i) => {
            conn.execute(
                "UPDATE ram_speeds SET speed = ?2, generation = ?3, category = ?4,
                        description = ?5, updated_at = ?6
                  WHERE id = ?1",
                rusqlite::params![i, canonical, generation, category, description, now()],
            )?;
            let row = conn.query_row(
                "SELECT id, speed, generation, category, description FROM ram_speeds WHERE id = ?1",
                [i],
                |r| {
                    Ok(RamSpeed {
                        id: r.get(0)?,
                        speed: r.get(1)?,
                        generation: r.get(2)?,
                        category: r.get(3)?,
                        description: r.get(4)?,
                    })
                },
            )?;
            Ok(row)
        }
        None => {
            let new_id = new_id();
            conn.execute(
                "INSERT INTO ram_speeds (id, speed, generation, category, description, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                rusqlite::params![new_id, canonical, generation, category, description, now()],
            )
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(_, Some(m)) if m.contains("UNIQUE") => {
                    AppError::conflict(format!("{canonical} already exists for {generation} {category}."))
                }
                other => AppError::from(other),
            })?;
            Ok(RamSpeed {
                id: new_id,
                speed: canonical.to_string(),
                generation,
                category,
                description: description.map(|s| s.to_string()),
            })
        }
    }
}

pub fn delete_speed(conn: &Connection, id: &str) -> AppResult<()> {
    let in_use: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ram_items WHERE speed = (
             SELECT speed FROM ram_speeds WHERE id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if in_use > 0 {
        return Err(AppError::business(format!(
            "This speed is used by {in_use} catalogue item(s) and cannot be removed."
        )));
    }
    let n = conn.execute("DELETE FROM ram_speeds WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::not_found("Speed not found."));
    }
    Ok(())
}

/// `kind` is one of `generation`, `category`, `manufacturer`, `location`.
/// Re-reads a master-data row so callers get the stored `created_at` back
/// after an update, instead of a value assembled by hand.
fn reload_named(conn: &Connection, kind: &str, id: &str) -> NamedValue {
    list_named(conn, kind)
        .ok()
        .and_then(|rows| rows.into_iter().find(|c| c.id == id))
        .unwrap_or_else(|| NamedValue {
            id: id.to_string(),
            name: String::new(),
            kind: kind.to_string(),
            description: None,
            created_at: now(),
        })
}

/** Master-data lists exposed through `list_named_values` /
    `save_named_value` / `delete_named_value`.

    The wire format accepts both spellings - `categories` and `category`,
    `manufacturers` and `manufacturer`, ... - so no caller has to guess
    which form the backend expects. */
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MasterKind {
    Category,
    Generation,
    Manufacturer,
    Location,
    Condition,
}

impl MasterKind {
    fn parse(kind: &str) -> Option<Self> {
        match kind.trim().to_ascii_lowercase().as_str() {
            "category" | "categories" => Some(Self::Category),
            "generation" | "generations" => Some(Self::Generation),
            "manufacturer" | "manufacturers" => Some(Self::Manufacturer),
            "location" | "locations" => Some(Self::Location),
            "condition" | "conditions" => Some(Self::Condition),
            _ => None,
        }
    }

    /// Canonical single-word kind - the value stored in `categories.type`
    /// and echoed back in `NamedValue.kind`.
    fn as_str(self) -> &'static str {
        match self {
            Self::Category => "category",
            Self::Generation => "generation",
            Self::Manufacturer => "manufacturer",
            Self::Location => "location",
            Self::Condition => "condition",
        }
    }

    /// Column on `ram_items` that holds this master value.
    fn item_column(self) -> &'static str {
        match self {
            Self::Category => "category",
            Self::Generation => "generation",
            Self::Manufacturer => "manufacturer",
            Self::Location => "location",
            Self::Condition => "condition",
        }
    }
}

pub fn list_named(conn: &Connection, kind: &str) -> AppResult<Vec<NamedValue>> {
    let master = MasterKind::parse(kind)
        .ok_or_else(|| AppError::internal(format!("Unknown master list '{kind}'.")))?;
    match master {
        MasterKind::Manufacturer => {
            let mut stmt =
                conn.prepare("SELECT id, name, created_at FROM manufacturers ORDER BY name")?;
            let rows = stmt.query_map([], |r| {
                Ok(NamedValue {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: "manufacturer".into(),
                    description: None,
                    created_at: r.get::<_, String>(2)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
        MasterKind::Location => {
            let mut stmt = conn.prepare(
                "SELECT id, name, description, created_at FROM locations ORDER BY name",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(NamedValue {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: "location".into(),
                    description: r.get(2)?,
                    created_at: r.get::<_, String>(3)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
        MasterKind::Category | MasterKind::Generation => {
            let mut stmt = conn.prepare(
                "SELECT id, name, type, created_at FROM categories WHERE type = ?1 ORDER BY name",
            )?;
            let rows = stmt.query_map([master.as_str()], |r| {
                Ok(NamedValue {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    description: None,
                    created_at: r.get::<_, String>(3)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        }
        // Conditions are a built-in list (see `settings::CONDITIONS`) that is
        // validated on every item write; they are deliberately not editable.
        MasterKind::Condition => Ok(super::settings::CONDITIONS
            .iter()
            .map(|name| NamedValue {
                id: format!("builtin-condition-{name}"),
                name: name.to_string(),
                kind: "condition".into(),
                description: Some("Built-in condition list".into()),
                created_at: String::new(),
            })
            .collect()),
    }
}

/// A master value's name must be unique within its list.
/// The comparison is case-blind so "PC" and "pc" cannot both
/// sneak in, and `ignore_id` lets a row keep its own name while
/// its description is edited.
fn ensure_name_free(
    conn: &Connection,
    table: &str,
    name: &str,
    ignore_id: Option<&str>,
) -> AppResult<()> {
    let (sql, values): (String, Vec<String>) = match ignore_id.filter(|i| !i.is_empty()) {
        Some(i) => (
            format!("SELECT COUNT(*) FROM {table} WHERE lower(name) = lower(?1) AND id <> ?2"),
            vec![name.to_string(), i.to_string()],
        ),
        None => (
            format!("SELECT COUNT(*) FROM {table} WHERE lower(name) = lower(?1)"),
            vec![name.to_string()],
        ),
    };
    let count: i64 = conn
        .query_row(&sql, params_from_iter(values.iter().cloned()), |r| r.get(0))?;
    if count > 0 {
        return Err(AppError::business(format!("'{name}' already exists in this list.")));
    }
    Ok(())
}

pub fn save_named(
    conn: &Connection,
    kind: &str,
    id: Option<&str>,
    name: &str,
    description: Option<&str>,
) -> AppResult<NamedValue> {
    let name = validate_required(name, "Name")?;
    let master = MasterKind::parse(kind)
        .ok_or_else(|| AppError::internal(format!("Unknown master list '{kind}'.")))?;

    match master {
        // Built-in list - nothing to persist.
        MasterKind::Condition => Err(AppError::business(
            "Conditions are a built-in list and cannot be edited.".to_string(),
        )),
        MasterKind::Category | MasterKind::Generation => {
            ensure_name_free(conn, "categories", &name, id)?;
            let kind_str = master.as_str();
            let new_id = new_id();
            match id.filter(|i| !i.is_empty()) {
                Some(i) => {
                    conn.execute(
                        "UPDATE categories SET name = ?2 WHERE id = ?1",
                        rusqlite::params![i, name],
                    )?;
                    super::audit::write(conn, "UPDATE", "REFERENCE", Some(i), &format!("Renamed {kind_str} to {name}"))?;
                    Ok(reload_named(conn, kind_str, i))
                }
                None => {
                    conn.execute(
                        "INSERT INTO categories (id, name, type, created_at) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![new_id, name, kind_str, now()],
                    )?;
                    super::audit::write(conn, "CREATE", "REFERENCE", Some(new_id.as_str()), &format!("Added {kind_str} {name}"))?;
                    Ok(reload_named(conn, kind_str, &new_id))
                }
            }
        }
        MasterKind::Manufacturer => {
            ensure_name_free(conn, "manufacturers", &name, id)?;
            match id.filter(|i| !i.is_empty()) {
                Some(i) => {
                    conn.execute(
                        "UPDATE manufacturers SET name = ?2 WHERE id = ?1",
                        rusqlite::params![i, name],
                    )?;
                    Ok(reload_named(conn, "manufacturer", i))
                }
                None => {
                    let new_id = new_id();
                    conn.execute(
                        "INSERT INTO manufacturers (id, name, created_at) VALUES (?1, ?2, ?3)",
                        rusqlite::params![new_id, name, now()],
                    )?;
                    Ok(reload_named(conn, "manufacturer", &new_id))
                }
            }
        }
        MasterKind::Location => {
            ensure_name_free(conn, "locations", &name, id)?;
            match id.filter(|i| !i.is_empty()) {
                Some(i) => {
                    conn.execute(
                        "UPDATE locations SET name = ?2, description = ?3 WHERE id = ?1",
                        rusqlite::params![i, name, description],
                    )?;
                    Ok(reload_named(conn, "location", i))
                }
                None => {
                    let new_id = new_id();
                    conn.execute(
                        "INSERT INTO locations (id, name, description, created_at) VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![new_id, name, description, now()],
                    )?;
                    Ok(reload_named(conn, "location", &new_id))
                }
            }
        }
    }
}

pub fn delete_named(conn: &Connection, kind: &str, id: &str) -> AppResult<()> {
    let master = MasterKind::parse(kind)
        .ok_or_else(|| AppError::internal(format!("Unknown master list '{kind}'.")))?;

    // Built-in list - nothing to remove.
    if matches!(master, MasterKind::Condition) {
        return Err(AppError::business(
            "Conditions are a built-in list and cannot be edited.".to_string(),
        ));
    }

    let (table, item_column) = match master {
        MasterKind::Category | MasterKind::Generation => ("categories", master.item_column()),
        MasterKind::Manufacturer => ("manufacturers", master.item_column()),
        MasterKind::Location => ("locations", master.item_column()),
        MasterKind::Condition => unreachable!("condition handled above"),
    };

    let label: String = conn
        .query_row(
            &format!("SELECT name FROM {table} WHERE id = ?1"),
            [id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::not_found("Entry not found."))?;

    // The live catalogue is the only consumer of master data; historical
    // purchase/sale documents keep their own snapshot of the value.
    let in_use: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM ram_items WHERE {item_column} = ?1"),
        [&label],
        |r| r.get(0),
    )?;
    if in_use > 0 {
        return Err(AppError::business(format!(
            "'{label}' is used by {in_use} catalogue item(s) and cannot be removed."
        )));
    }

    conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])?;
    Ok(())
}

/// Distinct values currently present in the catalogue, used to populate the
/// inventory filter dropdowns.
pub fn facets(conn: &Connection) -> AppResult<Vec<(String, Vec<String>)>> {
    let facets = [
        ("generation", "SELECT DISTINCT generation FROM ram_items WHERE generation <> '' ORDER BY generation"),
        ("category", "SELECT DISTINCT category FROM ram_items WHERE category <> '' ORDER BY category"),
        ("capacity", "SELECT DISTINCT capacity FROM ram_items WHERE capacity <> '' ORDER BY capacity_gb"),
        ("speed", "SELECT DISTINCT speed FROM ram_items WHERE speed <> '' ORDER BY speed"),
        ("manufacturer", "SELECT DISTINCT manufacturer FROM ram_items WHERE manufacturer IS NOT NULL AND manufacturer <> '' ORDER BY manufacturer"),
        ("location", "SELECT DISTINCT location FROM ram_items WHERE location IS NOT NULL AND location <> '' ORDER BY location"),
        ("condition", "SELECT DISTINCT condition FROM ram_items WHERE condition IS NOT NULL AND condition <> '' ORDER BY condition"),
    ];

    let mut out = Vec::new();
    for (key, sql) in facets {
        let mut stmt = conn.prepare(sql)?;
        let values: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        out.push((key.to_string(), values));
    }
    Ok(out)
}

// ====================================================== master-data tests ===
//
// Unit tests (not integration tests) so they run in the library test
// binary. Every case exercises the public master-data contract that the
// Settings screens and every selector in the app rely on.

#[cfg(test)]
mod master_data_tests {
    use super::*;
    use crate::db;
    use crate::models::RamItemInput;

    fn mem() -> Connection {
        db::open_in_memory().expect("in-memory database should open and migrate")
    }

    fn ram_input(sku: Option<&str>) -> RamItemInput {
        RamItemInput {
            sku: sku.map(str::to_string),
            generation: "DDR4".into(),
            category: "Server".into(),
            capacity: "32 GB".into(),
            speed: "2666V".into(),
            manufacturer: Some("Samsung".into()),
            ..Default::default()
        }
    }

    #[test]
    fn master_lists_accept_plural_kinds_and_return_seed_data() {
        let conn = mem();

        let categories = list_named(&conn, "categories").unwrap();
        assert!(
            categories.iter().any(|c| c.name == "Server"),
            "seeded categories missing, got {categories:?}"
        );
        assert!(
            categories.iter().all(|c| c.kind == "category"),
            "kind should echo back as 'category'"
        );

        let manufacturers = list_named(&conn, "manufacturers").unwrap();
        assert!(
            manufacturers.iter().any(|m| m.name == "Samsung"),
            "seeded manufacturers missing, got {manufacturers:?}"
        );

        let locations = list_named(&conn, "locations").unwrap();
        assert!(
            locations.iter().any(|l| l.name == "Main Warehouse"),
            "seeded locations missing, got {locations:?}"
        );

        // The singular spellings keep working too.
        assert!(!list_named(&conn, "category").unwrap().is_empty());
        assert!(!list_named(&conn, "manufacturer").unwrap().is_empty());
        assert!(!list_named(&conn, "location").unwrap().is_empty());
    }

    #[test]
    fn conditions_come_from_the_built_in_list() {
        let conn = mem();
        let conditions = list_named(&conn, "conditions").unwrap();
        assert!(
            conditions.iter().any(|c| c.name == "New"),
            "built-in conditions missing, got {conditions:?}"
        );
        assert!(
            conditions.iter().any(|c| c.name == "Refurbished"),
            "built-in conditions missing, got {conditions:?}"
        );
    }

    #[test]
    fn unknown_master_list_is_an_error() {
        let conn = mem();
        assert!(list_named(&conn, "cities").is_err());
        assert!(list_named(&conn, "ram_types").is_err());
    }

    #[test]
    fn a_user_defined_category_can_be_saved_and_used_on_an_item() {
        let mut conn = mem();

        let created = save_named(&conn, "categories", None, "Gaming", None)
            .expect("category should be saved");
        assert_eq!(created.name, "Gaming");
        assert_eq!(created.kind, "category");

        let listed = list_named(&conn, "categories").unwrap();
        assert!(listed.iter().any(|c| c.name == "Gaming"));

        // The whole point of user-defined categories: they must be
        // assignable to a catalogue item.
        let mut input = ram_input(Some("Z-D4-GAM-16-3200-0001"));
        input.category = "Gaming".into();
        let item = create(&mut conn, &input)
            .expect("a user-defined category must be usable on an item");
        assert_eq!(item.category, "Gaming");
    }

    #[test]
    fn duplicate_master_names_are_rejected() {
        let conn = mem();
        let err = save_named(&conn, "manufacturers", None, "Samsung", None)
            .unwrap_err();
        assert!(matches!(err, AppError::Business(_)), "got {err:?}");

        // Case-blind: "SAMSUNG" is the same manufacturer.
        let err = save_named(&conn, "manufacturers", None, "SAMSUNG", None)
            .unwrap_err();
        assert!(matches!(err, AppError::Business(_)), "got {err:?}");
    }

    #[test]
    fn renaming_a_master_value_updates_the_list() {
        let conn = mem();
        let created = save_named(&conn, "manufacturers", None, "Patriot", None)
            .unwrap();

        let renamed = save_named(
            &conn,
            "manufacturers",
            Some(&created.id),
            "Patriot Memory",
            None,
        )
        .unwrap();
        assert_eq!(renamed.name, "Patriot Memory");

        let listed = list_named(&conn, "manufacturers").unwrap();
        assert!(listed.iter().any(|m| m.name == "Patriot Memory"));
        assert!(!listed.iter().any(|m| m.name == "Patriot"));
    }

    #[test]
    fn deleting_a_master_value_in_use_is_refused() {
        let mut conn = mem();
        create(&mut conn, &ram_input(None)).unwrap(); // uses manufacturer "Samsung"

        let samsung = list_named(&conn, "manufacturers")
            .unwrap()
            .into_iter()
            .find(|m| m.name == "Samsung")
            .expect("seeded Samsung manufacturer");

        let err = delete_named(&conn, "manufacturers", &samsung.id).unwrap_err();
        assert!(matches!(err, AppError::Business(_)), "got {err:?}");
    }

    #[test]
    fn deleting_an_unused_master_value_removes_it() {
        let conn = mem();
        let created = save_named(&conn, "locations", None, "Test Shelf", None)
            .unwrap();

        delete_named(&conn, "locations", &created.id)
            .expect("unused location should be deleted");

        let listed = list_named(&conn, "locations").unwrap();
        assert!(!listed.iter().any(|l| l.name == "Test Shelf"));
    }

    #[test]
    fn built_in_conditions_cannot_be_edited_or_deleted() {
        let conn = mem();
        let conditions = list_named(&conn, "conditions").unwrap();
        let new_condition = conditions
            .iter()
            .find(|c| c.name == "New")
            .expect("built-in New condition");

        let save = save_named(&conn, "conditions", None, "Mint", None).unwrap_err();
        assert!(matches!(save, AppError::Business(_)), "got {save:?}");

        let delete = delete_named(&conn, "conditions", &new_condition.id).unwrap_err();
        assert!(matches!(delete, AppError::Business(_)), "got {delete:?}");
    }

    // ============================================ item-write validation ===
    // The backend must enforce the RAM attribute contract on every create and
    // update: generation/category from the known lists, capacity 4-256 GB,
    // speed from the RAM speed master list for the item's generation, and a
    // condition from the built-in condition list.

    #[test]
    fn writes_reject_unknown_and_accept_known_conditions() {
        let mut conn = mem();

        let mut mint = ram_input(None);
        mint.condition = Some("Mint".into());
        let err = create(&mut conn, &mint).unwrap_err();
        assert!(err.to_string().contains("Condition"), "got {err:?}");

        let mut blank = ram_input(None);
        blank.condition = None;
        blank.sku = Some("Z-BLANK-COND".into());
        let item = create(&mut conn, &blank).unwrap();
        assert_eq!(item.condition, None, "blank condition stores NULL");

        let mut lower = ram_input(None);
        lower.condition = Some("new".into());
        lower.sku = Some("Z-LOWER-COND".into());
        let item = create(&mut conn, &lower).unwrap();
        assert_eq!(
            item.condition.as_deref(),
            Some("New"),
            "condition is canonicalised when saved"
        );
    }

    #[test]
    fn writes_reject_capacity_outside_the_supported_range() {
        let mut conn = mem();

        for bad in ["0 GB", "1.5 GB", "lots", "16.5 GB", "2 TB", "2048 GB", "0 TB", "-4 GB"] {
            let mut input = ram_input(None);
            input.capacity = bad.into();
            assert!(create(&mut conn, &input).is_err(), "capacity {bad} accepted");
        }

        // The full supported range - 1 GB up to 1 TB - is accepted.
        for (label, gb) in [("1 GB", 1), ("2 GB", 2), ("16 GB", 16), ("512 GB", 512), ("1 TB", 1024)] {
            let mut ok = ram_input(None);
            ok.capacity = label.into();
            ok.sku = Some(format!("Z-CAP-{gb}"));
            let item = create(&mut conn, &ok).unwrap();
            assert_eq!(item.capacity_gb, gb, "{label} should parse to {gb} GB");
        }
    }

    #[test]
    fn writes_reject_speeds_missing_from_the_generation_master_list() {
        let mut conn = mem();

        // "9000" is not a configured DDR4 speed.
        let mut fast = ram_input(None);
        fast.speed = "9000".into();
        let err = create(&mut conn, &fast).unwrap_err();
        assert!(err.to_string().contains("RAM speed master list"), "got {err:?}");

        // "3200" is a DDR4 speed only - never valid for a DDR5 item.
        let mut d5 = ram_input(None);
        d5.generation = "DDR5".into();
        d5.speed = "3200".into();
        let err = create(&mut conn, &d5).unwrap_err();
        assert!(err.to_string().contains("RAM speed master list"), "got {err:?}");

        // "5600" is a DDR5 speed only - never valid for a DDR3 item.
        let mut d3 = ram_input(None);
        d3.generation = "DDR3".into();
        d3.category = "PC".into();
        d3.speed = "5600".into();
        let err = create(&mut conn, &d3).unwrap_err();
        assert!(err.to_string().contains("RAM speed master list"), "got {err:?}");
    }

    #[test]
    fn writes_reject_speeds_outside_the_approved_master_list() {
        let mut conn = mem();

        // A label that exists for another generation is still a hard error for
        // this one: 5200 / 5600 are DDR5-only, 3200 is DDR4-only, and value
        // invented out of thin air never validates.
        for (generation, bad) in [
            ("DDR3", "3200"),
            ("DDR3", "9000"),
            ("DDR4", "5200"),
            ("DDR4", "9999"),
            ("DDR5", "2400"),
            ("DDR5", "9000"),
        ] {
            let mut input = ram_input(None);
            input.generation = generation.into();
            input.category = "PC".into();
            input.speed = bad.into();
            input.sku = Some(format!("Z-BAD-{generation}-{bad}"));
            let err = create(&mut conn, &input).unwrap_err();
            assert!(
                err.to_string().contains("RAM speed master list"),
                "{bad}/{generation} accepted: {err:?}"
            );
        }
    }

    #[test]
    fn writes_accept_every_approved_speed() {
        let mut conn = mem();

        for &(generation, speeds) in RAM_SPEEDS_BY_GENERATION {
            for &speed in speeds {
                let mut input = ram_input(None);
                input.generation = generation.into();
                input.category = "PC".into();
                input.speed = speed.into();
                input.sku = Some(format!("Z-OK-{generation}-{speed}"));
                create(&mut conn, &input)
                    .unwrap_or_else(|e| panic!("{speed} ({generation}) rejected: {e:?}"));
            }
        }
    }

    #[test]
    fn ddr4_capacity_does_not_restrict_speed() {
        let mut conn = mem();

        // Every DDR4 speed must be selectable at every supported capacity.
        for capacity in ["8 GB", "16 GB", "32 GB"] {
            for &speed in &["2400", "2666", "2933", "3200"] {
                let mut input = ram_input(None);
                input.capacity = capacity.into();
                input.speed = speed.into();
                input.category = "PC".into();
                input.sku = Some(format!("Z-{speed}-{capacity}"));
                create(&mut conn, &input)
                    .unwrap_or_else(|e| panic!("{capacity} + {speed} rejected: {e:?}"));
            }
        }
    }

    #[test]
    fn manufacturer_does_not_restrict_speed() {
        let mut conn = mem();

        // The same speed must be creatable under any supported manufacturer.
        for manufacturer in ["Samsung", "Micron", "SK hynix", "Kingston", "ADATA"] {
            let mut input = ram_input(None);
            input.manufacturer = Some(manufacturer.into());
            input.speed = "2933".into();
            input.category = "Laptop".into();
            input.sku = Some(format!("Z-MFG-{}-2933", manufacturer.replace(' ', "")));
            create(&mut conn, &input)
                .unwrap_or_else(|e| panic!("{manufacturer} + 2933 rejected: {e:?}"));
        }
    }

    #[test]
    fn full_ddr4_variant_combination_is_accepted() {
        let mut conn = mem();

        // DDR4 UDIMM Non-ECC Unbuffered Samsung 8 GB 2400 - every field is
        // independently selectable; nothing here hides the speed choice.
        let combos = [
            ("Z-UDIMM-8-2400", "UDIMM", "Samsung", "8 GB", "2400", 0),
            ("Z-RDIMM-32-3200", "RDIMM", "Samsung", "32 GB", "3200", 1), // ECC registered
        ];
        for (sku, ram_type, manufacturer, capacity, speed, ecc) in combos {
            let mut input = ram_input(None);
            input.sku = Some(sku.into());
            input.ram_type = Some(ram_type.into());
            input.manufacturer = Some(manufacturer.into());
            input.capacity = capacity.into();
            input.speed = speed.into();
            input.ecc = ecc == 1;
            input.registered = ecc == 1;
            let item = create(&mut conn, &input).unwrap_or_else(|e| panic!("{sku} rejected: {e:?}"));
            assert_eq!(item.speed, speed);
            assert_eq!(item.capacity_gb, capacity.split_whitespace().next().unwrap().parse::<i64>().unwrap());
        }
    }

    #[test]
    fn ddr3_items_are_supported() {
        let mut conn = mem();

        for &speed in &["800", "1066", "1333", "1600", "1866", "2133"] {
            let mut input = ram_input(None);
            input.generation = "DDR3".into();
            input.category = "PC".into();
            input.capacity = "8 GB".into();
            input.speed = speed.into();
            input.sku = Some(format!("Z-D3-{speed}"));
            let item = create(&mut conn, &input)
                .unwrap_or_else(|e| panic!("DDR3 {speed} rejected: {e:?}"));
            assert_eq!(item.speed, speed);
            assert!(item.sku.starts_with("Z-D3-"), "DDR3 SKU stem {}, got {}", "Z-D3", item.sku);
        }
    }

    #[test]
    fn list_speeds_exposes_the_full_matrix_with_no_archived_rows() {
        let conn = mem();

        // Migration 004 archived DDR4 2933 (Laptop) and 2400 (Server); migration
        // 005 un-archives both because they are approved again, and re-inserts
        // every matrix label (15 new rows), so no row is archived any more.
        let stored: i64 = conn
            .query_row("SELECT COUNT(*) FROM ram_speeds", [], |r| r.get(0))
            .unwrap();
        let archived: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ram_speeds WHERE archived_at IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!((stored, archived), (30, 0), "every matrix row restored, nothing archived");

        let rows = list_speeds(&conn, None).unwrap();
        let labels: std::collections::HashSet<&str> =
            rows.iter().map(|s| s.speed.as_str()).collect();
        // 21 distinct labels: 1600 / 1866 / 2133 service both DDR3 and DDR4.
        assert_eq!(labels.len(), 21, "full matrix served, got {labels:?}");
        for label in [
            // DDR3 (1600/1866/2133 shared with DDR4)
            "800", "1066", "1333", "1600", "1866", "2133",
            // DDR4 - legacy 2400T/2666V kept alongside the plain JEDEC values
            "2400", "2400T", "2666", "2666V", "2933", "3200",
            // DDR5
            "4800", "5200", "5600", "6000", "6400", "6800", "7200", "7600", "8000",
        ] {
            assert!(labels.contains(label), "{label} missing from the master matrix");
        }

        // Generation-scoped reads match the matrix exactly.
        for &(generation, expected) in RAM_SPEEDS_BY_GENERATION {
            let gen_rows: Vec<RamSpeed> = list_speeds(&conn, Some(generation)).unwrap();
            assert!(
                gen_rows.iter().all(|s| s.generation == generation),
                "{generation} leaked rows: {gen_rows:?}"
            );
            let offered: std::collections::HashSet<&str> =
                gen_rows.iter().map(|s| s.speed.as_str()).collect();
            assert!(
                expected.iter().all(|s| offered.contains(*s))
                    && offered.len() == expected.len(),
                "{generation} offered {offered:?}, expected {expected:?}"
            );
        }
    }

    #[test]
    fn save_speed_rejects_values_outside_the_approved_master_list() {
        let conn = mem();

        for (generation, speed) in [
            ("DDR3", "3200"),
            ("DDR3", "9000"),
            ("DDR4", "5200"),
            ("DDR4", "9999"),
            ("DDR5", "2400"),
            ("DDR5", "9000"),
        ] {
            let err = save_speed(&conn, None, speed, generation, "PC", None).unwrap_err();
            assert!(
                err.to_string().contains("not in the approved ZEUS RAM speed matrix"),
                "{speed}/{generation} accepted: {err:?}"
            );
        }

        // Every matrix label saves, and case-variants are canonicalised.
        let mut n = 0;
        for &(generation, speeds) in RAM_SPEEDS_BY_GENERATION {
            for &speed in speeds {
                let category = format!("Test {n}");
                let row = save_speed(&conn, None, speed, generation, &category, None).unwrap();
                assert_eq!(row.speed, speed, "approved label stored verbatim");
                n += 1;
            }
        }
        let canon_t = save_speed(&conn, None, "2400t", "DDR4", "Canonical 2400t", None).unwrap();
        assert_eq!(canon_t.speed, "2400T", "speed labels are canonicalised on save");
        let canon_v = save_speed(&conn, None, "2666v", "DDR4", "Canonical 2666v", None).unwrap();
        assert_eq!(canon_v.speed, "2666V", "speed labels are canonicalised on save");
        let canon_3 = save_speed(&conn, None, "2133", "DDR3", "Canonical 2133", None).unwrap();
        assert_eq!(canon_3.speed, "2133", "plain labels are stored verbatim");
    }

    #[test]
    fn generations_without_configured_speeds_are_not_gated() {
        let mut conn = mem();

        // The master data lookup accepts generations added to the categories
        // table; no speeds are configured for them, so any speed is allowed
        // (keeps legacy stock usable without a fake master entry).
        save_named(&conn, "generations", None, "HBM2", None).unwrap();
        let mut input = ram_input(None);
        input.generation = "HBM2".into();
        input.speed = "9999".into();
        input.sku = Some("Z-HBM2-1".into());
        create(&mut conn, &input).expect("generation without speeds should not be gated");
    }
}