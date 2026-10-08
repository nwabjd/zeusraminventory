//! Tauri command surface.
//!
//! Every command is a two-line adapter: it locks the shared connection and
//! forwards to the matching `core` function. All validation and business rules
//! live in `core`, which keeps them unit-testable without a window.

use crate::core::catalog::RamFilter;
use crate::core;
use crate::db::Db;
use crate::error::AppResult;
use crate::models::*;
use crate::core::parties::PartyKind;
use crate::util::money;
use rusqlite::Connection;

/// Locks the shared connection. A poisoned mutex means a previous command
/// panicked; the database file itself is still intact so we recover rather than
/// refusing to start.
fn with<T>(db: &Db, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
    let guard = match db.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    f(&guard)
}

/// Same, but the closure needs `&mut Connection` (writes / transactions).
fn with_mut<T>(db: &Db, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
    let mut guard = match db.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    f(&mut guard)
}

macro_rules! query {
    ($(#[$meta:meta])* $name:ident -> $ret:ty = $body:expr) => {
        $(#[$meta])*
        #[tauri::command]
        pub fn $name(db: tauri::State<'_, Db>) -> AppResult<$ret> {
            with(&db, $body)
        }
    };
}

macro_rules! query_arg {
    ($(#[$meta:meta])* $name:ident ( $($arg:ident : $ty:ty),* $(,)? ) -> $ret:ty = $body:expr) => {
        $(#[$meta])*
        #[tauri::command]
        pub fn $name(db: tauri::State<'_, Db>, $($arg: $ty),*) -> AppResult<$ret> {
            with(&db, $body)
        }
    };
}

macro_rules! mutate {
    ($(#[$meta:meta])* $name:ident ( $($arg:ident : $ty:ty),* $(,)? ) -> $ret:ty = $body:expr) => {
        $(#[$meta])*
        #[tauri::command]
        pub fn $name(db: tauri::State<'_, Db>, $($arg: $ty),*) -> AppResult<$ret> {
            with_mut(&db, $body)
        }
    };
}

// ============================================================== app info ===

/// Opens (or creates) the database, runs migrations and starts the
/// application. Called once during startup.
#[tauri::command]
pub fn bootstrap(app: tauri::AppHandle, db: tauri::State<'_, Db>) -> AppResult<StartupInfo> {
    let guard = match db.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };

    let path = core::backup::database_path_of(&guard)?.to_path_buf();
    let database_path = path.display().to_string();

    let settings = core::settings::all(&guard)?;
    let backup = core::backup::info(&guard, &path)?;
    let db_size = backup.database_size_bytes;

    // Best-effort automatic backup; a failure is surfaced in the UI banner but
    // never blocks startup.
    let auto_backup = core::backup::run_if_due(&guard)
        .ok()
        .flatten()
        .unwrap_or_default();

    let _ = app;
    Ok(StartupInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        database_path,
        database_size_bytes: db_size,
        settings: settings.into_iter().collect(),
        backup,
        auto_backup,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub version: String,
    pub database_path: String,
    pub database_size_bytes: i64,
    pub settings: std::collections::BTreeMap<String, String>,
    pub backup: BackupInfo,
    pub auto_backup: String,
}

query!(
    /// Health probe used by the frontend to confirm the bridge is live.
    ping -> String = |_c| Ok("online".to_string())
);

query!(
    app_settings -> std::collections::BTreeMap<String, String> = core::settings::all
);

mutate!(
    save_settings(values: std::collections::BTreeMap<String, String>) -> usize =
        |c| core::settings::save(c, &values)
);

// ============================================================= dashboard ===

query!(
    dashboard_stats -> DashboardStats = core::dashboard::stats
);

// ============================================================= inventory ===

fn build_filter(
    search: String,
    generation: Option<String>,
    category: Option<String>,
    capacity: Option<String>,
    speed: Option<String>,
    manufacturer: Option<String>,
    condition: Option<String>,
    location: Option<String>,
    stock_status: String,
    include_archived: bool,
    sort: String,
    limit: Option<i64>,
) -> RamFilter {
    RamFilter {
        search,
        generation,
        category,
        capacity,
        speed,
        manufacturer,
        condition,
        location,
        stock_status,
        include_archived,
        sort,
        limit,
    }
}

query_arg!(
    list_ram_items(
        search: String,
        generation: Option<String>,
        category: Option<String>,
        capacity: Option<String>,
        speed: Option<String>,
        manufacturer: Option<String>,
        condition: Option<String>,
        location: Option<String>,
        stock_status: String,
        include_archived: bool,
        sort: String,
        limit: Option<i64>,
    ) -> Vec<RamItem> = |c| core::catalog::list(
        c,
        &build_filter(search, generation, category, capacity, speed, manufacturer, condition, location, stock_status, include_archived, sort, limit)
    )
);

query_arg!(
    get_ram_item(id: String) -> RamItem = |c| core::catalog::get(c, &id)
);

query_arg!(
    search_ram_items(query: String, in_stock_only: bool, limit: i64) -> Vec<RamItem> =
        |c| core::catalog::search(c, &query, in_stock_only, limit)
);

query_arg!(
    low_stock_items(limit: i64) -> Vec<RamItem> = |c| core::catalog::low_stock(c, limit)
);

query!(
    ram_facets -> Vec<(String, Vec<String>)> = core::catalog::facets
);

mutate!(
    create_ram_item(input: RamItemInput) -> RamItem = |c| core::catalog::create(c, &input)
);

mutate!(
    update_ram_item(id: String, input: RamItemInput) -> RamItem =
        |c| core::catalog::update(c, &id, &input)
);

mutate!(
    set_ram_archived(id: String, archived: bool) -> RamItem =
        |c| core::catalog::set_archived(c, &id, archived)
);

mutate!(
    adjust_stock(input: AdjustmentInput) -> crate::core::catalog::AdjustmentOutcome =
        |c| core::catalog::adjust_stock(c, &input)
);

query_arg!(
    item_movements(ram_item_id: String) -> Vec<StockMovement> =
        |c| core::stock::movements_for(c, &ram_item_id)
);

query_arg!(
    item_adjustments(ram_item_id: String) -> Vec<InventoryAdjustment> =
        |c| core::stock::adjustments_for(c, &ram_item_id)
);

query_arg!(
    item_purchases(ram_item_id: String) -> Vec<Purchase> = |c| {
        let ids: Vec<String> = c.prepare(
            "SELECT purchase_id FROM purchase_items WHERE ram_item_id = ?1 GROUP BY purchase_id"
        )?.query_map([&ram_item_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let mut out = Vec::new();
        for id in ids {
            if let Ok(p) = core::purchases::get(c, &id) { out.push(p); }
        }
        out.sort_by(|a, b| b.purchase_date.cmp(&a.purchase_date));
        Ok(out)
    }
);

query_arg!(
    item_sales(ram_item_id: String) -> Vec<Sale> = |c| {
        let ids: Vec<String> = c.prepare(
            "SELECT sale_id FROM sale_items WHERE ram_item_id = ?1 GROUP BY sale_id"
        )?.query_map([&ram_item_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let mut out = Vec::new();
        for id in ids {
            if let Ok(s) = core::sales::get(c, &id) { out.push(s); }
        }
        out.sort_by(|a, b| b.sale_date.cmp(&a.sale_date));
        Ok(out)
    }
);

// ========================================================= master / refs ===

query_arg!(
    list_speeds(generation: Option<String>) -> Vec<RamSpeed> =
        |c| core::catalog::list_speeds(c, generation.as_deref())
);

mutate!(
    save_speed(id: Option<String>, speed: String, generation: String, category: String, description: Option<String>) -> RamSpeed =
        |c| core::catalog::save_speed(c, id.as_deref(), &speed, &generation, &category, description.as_deref())
);

mutate!(
    delete_speed(id: String) -> () = |c| core::catalog::delete_speed(c, &id)
);

query_arg!(
    list_named_values(kind: String) -> Vec<NamedValue> = |c| core::catalog::list_named(c, &kind)
);

mutate!(
    save_named_value(kind: String, id: Option<String>, name: String, description: Option<String>) -> NamedValue =
        |c| core::catalog::save_named(c, &kind, id.as_deref(), &name, description.as_deref())
);

mutate!(
    delete_named_value(kind: String, id: String) -> () =
        |c| core::catalog::delete_named(c, &kind, &id)
);

// ================================================================= buyers ===

query_arg!(
    list_buyers(search: String, include_archived: bool) -> Vec<Party> =
        |c| core::parties::list(c, PartyKind::Buyer, &search, include_archived)
);

query_arg!(
    get_buyer(id: String) -> Party = |c| core::parties::get(c, PartyKind::Buyer, &id)
);

query_arg!(
    search_buyers(query: String, limit: i64) -> Vec<Party> =
        |c| core::parties::search(c, PartyKind::Buyer, &query, limit)
);

mutate!(
    create_buyer(input: PartyInput) -> Party =
        |c| core::parties::create(c, PartyKind::Buyer, &input)
);

mutate!(
    update_buyer(id: String, input: PartyInput) -> Party =
        |c| core::parties::update(c, PartyKind::Buyer, &id, &input)
);

mutate!(
    set_buyer_archived(id: String, archived: bool) -> Party =
        |c| core::parties::set_archived(c, PartyKind::Buyer, &id, archived)
);

mutate!(
    delete_buyer(id: String) -> () = |c| core::parties::delete(c, PartyKind::Buyer, &id)
);

query_arg!(
    buyer_statement(id: String, from: String, to: String) -> Statement =
        |c| core::parties::statement(c, PartyKind::Buyer, &id, &from, &to)
);

// ================================================================ sellers ===

query_arg!(
    list_sellers(search: String, include_archived: bool) -> Vec<Party> =
        |c| core::parties::list(c, PartyKind::Seller, &search, include_archived)
);

query_arg!(
    get_seller(id: String) -> Party = |c| core::parties::get(c, PartyKind::Seller, &id)
);

query_arg!(
    search_sellers(query: String, limit: i64) -> Vec<Party> =
        |c| core::parties::search(c, PartyKind::Seller, &query, limit)
);

mutate!(
    create_seller(input: PartyInput) -> Party =
        |c| core::parties::create(c, PartyKind::Seller, &input)
);

mutate!(
    update_seller(id: String, input: PartyInput) -> Party =
        |c| core::parties::update(c, PartyKind::Seller, &id, &input)
);

mutate!(
    set_seller_archived(id: String, archived: bool) -> Party =
        |c| core::parties::set_archived(c, PartyKind::Seller, &id, archived)
);

mutate!(
    delete_seller(id: String) -> () = |c| core::parties::delete(c, PartyKind::Seller, &id)
);

query_arg!(
    seller_statement(id: String, from: String, to: String) -> Statement =
        |c| core::parties::statement(c, PartyKind::Seller, &id, &from, &to)
);

// ============================================================== purchases ===

query_arg!(
    list_purchases(search: String, seller_id: Option<String>, status: Option<String>, method: Option<String>, from: String, to: String, generation: Option<String>, category: Option<String>, capacity: Option<String>, speed: Option<String>, manufacturer: Option<String>, location: Option<String>, limit: Option<i64>) -> Vec<Purchase> =
        |c| core::purchases::list(c, &core::purchases::DocFilter {
            search, seller_id, status, method, from, to, generation, category, capacity, speed, manufacturer, location, limit
        })
);

query_arg!(
    get_purchase(id: String) -> Purchase = |c| core::purchases::get(c, &id)
);

query_arg!(
    get_purchase_by_number(number: String) -> Purchase = |c| core::purchases::get_by_number(c, &number)
);

mutate!(
    create_purchase(input: PurchaseInput) -> Purchase = |c| core::purchases::create(c, &input)
);

mutate!(
    void_purchase(id: String, reason: String) -> Purchase = |c| core::purchases::void(c, &id, &reason)
);

mutate!(
    pay_purchase(id: String, amount: f64, method: String, notes: Option<String>, date: String) -> Purchase =
        |c| core::purchases::pay(c, &id, amount, &method, notes.as_deref(), &date)
);

// ================================================================== sales ===

query_arg!(
    list_sales(search: String, buyer_id: Option<String>, status: Option<String>, method: Option<String>, from: String, to: String, generation: Option<String>, category: Option<String>, capacity: Option<String>, speed: Option<String>, manufacturer: Option<String>, location: Option<String>, limit: Option<i64>) -> Vec<Sale> =
        |c| core::sales::list(c, &core::sales::DocFilter {
            search, buyer_id, status, method, from, to, generation, category, capacity, speed, manufacturer, location, limit
        })
);

query_arg!(
    get_sale(id: String) -> Sale = |c| core::sales::get(c, &id)
);

query_arg!(
    get_sale_by_number(number: String) -> Sale = |c| core::sales::get_by_number(c, &number)
);

mutate!(
    create_sale(input: SaleInput) -> Sale = |c| core::sales::create(c, &input)
);

mutate!(
    void_sale(id: String, reason: String) -> Sale = |c| core::sales::void(c, &id, &reason)
);

mutate!(
    receive_sale(id: String, amount: f64, method: String, notes: Option<String>, date: String) -> Sale =
        |c| core::sales::receive(c, &id, amount, &method, notes.as_deref(), &date)
);

// ============================================================ cloud mirror ===
// Local cache of the authoritative cloud ledger. The Supabase database owns
// finalized documents and quantities; these commands only write/read the
// desktop mirror (`core::cloud_sync`).

query!(
    sync_get_watermarks -> Vec<core::cloud_sync::SyncWatermark> =
        |c| core::cloud_sync::get_watermarks(c)
);

mutate!(
    sync_apply(snapshot: core::cloud_sync::CloudSyncSnapshot) -> core::cloud_sync::SyncApplyResult =
        |c| core::cloud_sync::apply(c, &snapshot)
);

mutate!(
    sync_clear() -> () = |c| core::cloud_sync::clear(c)
);

query_arg!(
    list_cloud_sales(search: String, buyer_id: Option<String>, status: Option<String>, method: Option<String>, from: String, to: String, generation: Option<String>, category: Option<String>, capacity: Option<String>, speed: Option<String>, manufacturer: Option<String>, location: Option<String>, limit: Option<i64>) -> Vec<Sale> =
        |c| {
            let _ = (&buyer_id, &manufacturer, &location); // kept for API parity only
            core::cloud_sync::list_cloud_sales(c, &core::cloud_sync::CloudDocFilter {
                search, status, method, from, to, generation, category, capacity, speed, limit
            })
        }
);

query_arg!(
    get_cloud_sale(id: String) -> Sale = |c| core::cloud_sync::get_cloud_sale(c, &id)
);

query_arg!(
    list_cloud_purchases(search: String, seller_id: Option<String>, status: Option<String>, method: Option<String>, from: String, to: String, generation: Option<String>, category: Option<String>, capacity: Option<String>, speed: Option<String>, manufacturer: Option<String>, location: Option<String>, limit: Option<i64>) -> Vec<Purchase> =
        |c| {
            let _ = (&seller_id, &manufacturer, &location); // kept for API parity only
            core::cloud_sync::list_cloud_purchases(c, &core::cloud_sync::CloudDocFilter {
                search, status, method, from, to, generation, category, capacity, speed, limit
            })
        }
);

query_arg!(
    get_cloud_purchase(id: String) -> Purchase = |c| core::cloud_sync::get_cloud_purchase(c, &id)
);

query_arg!(
    list_cloud_cached_approvals(status: Option<String>) -> Vec<core::cloud_sync::CachedApproval> =
        |c| core::cloud_sync::list_cloud_approvals(c, status)
);

query_arg!(
    list_cloud_cached_audit(limit: Option<i64>) -> Vec<core::cloud_sync::CachedAuditRow> =
        |c| core::cloud_sync::list_cloud_audit(c, limit)
);

// ================================================================ returns ===

query_arg!(
    list_returns(return_type: Option<String>, from: String, to: String) -> Vec<ReturnDoc> =
        |c| core::returns::list(c, return_type.as_deref(), &from, &to)
);

query_arg!(
    get_return(id: String) -> ReturnDoc = |c| core::returns::get(c, &id)
);

mutate!(
    create_return(input: ReturnInput) -> ReturnDoc = |c| core::returns::create(c, &input)
);

query_arg!(
    returned_quantity(ram_item_id: String, reference_id: String) -> i64 =
        |c| core::returns::returned_quantity(c, &ram_item_id, &reference_id)
);

// =============================================================== payments ===

query_arg!(
    list_payments(search: String, payment_type: Option<String>, person_type: Option<String>, person_id: Option<String>, method: Option<String>, status: Option<String>, from: String, to: String, limit: Option<i64>) -> Vec<Payment> =
        |c| core::payments::list(c, &core::payments::PaymentFilter {
            search, payment_type, person_type, person_id, method, status, from, to, limit
        })
);

query_arg!(
    payment_totals(from: String, to: String, payment_type: Option<String>, person_id: Option<String>) -> (f64, f64, f64, i64) = |c| {
        let (t, _) = core::payments::totals(c, &core::payments::PaymentFilter {
            from, to, payment_type, person_id, ..Default::default()
        })?;
        Ok((t.received, t.paid, t.net, t.count))
    }
);

mutate!(
    record_payment(input: PaymentInput) -> Payment = |c| core::payments::record(c, &input)
);

mutate!(
    reverse_payment(id: String, reason: String) -> Payment = |c| core::payments::reverse(c, &id, &reason)
);

// ============================================================= coworkers ===

query_arg!(
    list_coworkers(search: String, include_archived: bool) -> Vec<Coworker> =
        |c| core::coworkers::list(c, &search, include_archived)
);

query_arg!(
    get_coworker(id: String) -> Coworker = |c| core::coworkers::get(c, &id)
);

query!(
    coworker_totals -> CoworkerTotals = core::coworkers::totals
);

query_arg!(
    coworker_transactions(coworker_id: String, from: String, to: String) -> Vec<CoworkerTransaction> =
        |c| core::coworkers::transactions(c, &coworker_id, &from, &to)
);

query_arg!(
    all_coworker_transactions(from: String, to: String) -> Vec<CoworkerTransaction> =
        |c| core::coworkers::all_transactions(c, &from, &to)
);

mutate!(
    create_coworker(name: String, phone: Option<String>, notes: Option<String>) -> Coworker =
        |c| core::coworkers::create(c, &name, phone.as_deref(), notes.as_deref())
);

mutate!(
    update_coworker(id: String, name: String, phone: Option<String>, notes: Option<String>) -> Coworker =
        |c| core::coworkers::update(c, &id, &name, phone.as_deref(), notes.as_deref())
);

mutate!(
    set_coworker_archived(id: String, archived: bool) -> Coworker =
        |c| core::coworkers::set_archived(c, &id, archived)
);

mutate!(
    record_coworker_entry(input: CoworkerInput) -> CoworkerTransaction =
        |c| core::coworkers::record(c, &input)
);

// ============================================================== movements ===

query_arg!(
    recent_movements(limit: i64) -> Vec<StockMovement> = |c| core::dashboard::recent_movements(c, limit)
);

query_arg!(
    list_audit(limit: i64, entity: Option<String>) -> Vec<AuditEntry> =
        |c| core::audit::list(c, limit, entity.as_deref())
);

// ================================================================ reports ===

query_arg!(
    report_inventory(filter: ReportFilter) -> InventoryReport = |c| core::reports::inventory(c, &filter)
);

query_arg!(
    report_purchases(filter: ReportFilter) -> PurchaseReport = |c| core::reports::purchases(c, &filter)
);

query_arg!(
    report_sales(filter: ReportFilter) -> SalesReport = |c| core::reports::sales(c, &filter)
);

query_arg!(
    report_profit(filter: ReportFilter, grouping: String) -> ProfitReport =
        |c| core::reports::profit(c, &filter, &grouping)
);

query_arg!(
    report_buyer_balances(filter: ReportFilter) -> PartyBalanceReport =
        |c| core::reports::buyer_balances(c, &filter)
);

query_arg!(
    report_seller_balances(filter: ReportFilter) -> PartyBalanceReport =
        |c| core::reports::seller_balances(c, &filter)
);

query_arg!(
    report_payments(filter: ReportFilter) -> PaymentReport = |c| core::reports::payments(c, &filter)
);

query_arg!(
    report_coworkers(filter: ReportFilter) -> CoworkerReport = |c| core::reports::coworkers(c, &filter)
);

query_arg!(
    report_stock_movements(filter: ReportFilter) -> StockMovementReport =
        |c| core::reports::stock_movements(c, &filter)
);

query_arg!(
    report_returns(filter: ReportFilter) -> InventoryReport = |c| core::reports::returns(c, &filter)
);

query_arg!(
    report_top_movers(filter: ReportFilter, limit: i64) -> Vec<NameValueRow> =
        |c| core::reports::top_movers(c, &filter, limit)
);

// ================================================================= search ===

query_arg!(
    global_search(query: String, limit: i64) -> Vec<SearchHit> =
        |c| core::search::global(c, &query, limit)
);

// ================================================================ backups ===

query!(
    backup_info -> BackupInfo = |c| {
        let path = core::backup::database_path_of(c)?.to_path_buf();
        core::backup::info(c, &path)
    }
);

query!(
    list_backups -> Vec<BackupEntry> = |c| {
        let dir = core::backup::configured_dir(c)?;
        core::backup::list_backups(&dir)
    }
);

mutate!(
    backup_now() -> BackupInfo = |c| {
        let dir = core::backup::configured_dir(c)?;
        core::backup::create(c, &dir)
    }
);

mutate!(
    restore_backup(path: String) -> BackupInfo = |c| {
        core::backup::restore(c, std::path::Path::new(&path))
    }
);

mutate!(
    verify_backup(path: String) -> () = |_c| {
        core::backup::verify(std::path::Path::new(&path))
    }
);

// =================================================================== demo ===

query!(
    demo_summary -> DemoSummary = core::demo::summary
);

query!(
    demo_is_empty -> bool = core::demo::is_empty
);

mutate!(
    load_demo_data() -> DemoSummary = core::demo::seed
);

mutate!(
    clear_all_data() -> DemoSummary = core::demo::clear
);

// =============================================================== utility ===

/// Rounds money the same way the backend does, so the UI preview and the stored
/// value always agree.
#[tauri::command]
pub fn round_money(value: f64) -> f64 {
    money(value)
}