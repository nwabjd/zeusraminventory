// ZEUS - RAM Inventory Management
//
// Application wiring: plugins, managed state and the command registry.

pub mod commands;
pub mod core;
pub mod db;
pub mod error;
pub mod models;
pub mod util;

use std::sync::Mutex;

// `path()` and `manage()` live on the `Manager` trait.
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The database lives next to the application's data folder so it
            // survives updates and is easy to back up.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("zeus.db"))?;
            app.manage(Mutex::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::ping,
            commands::app_settings,
            commands::save_settings,
            commands::dashboard_stats,
            // inventory
            commands::list_ram_items,
            commands::get_ram_item,
            commands::search_ram_items,
            commands::low_stock_items,
            commands::ram_facets,
            commands::create_ram_item,
            commands::update_ram_item,
            commands::set_ram_archived,
            commands::adjust_stock,
            commands::item_movements,
            commands::item_adjustments,
            commands::item_purchases,
            commands::item_sales,
            // reference data
            commands::list_speeds,
            commands::save_speed,
            commands::delete_speed,
            commands::list_named_values,
            commands::save_named_value,
            commands::delete_named_value,
            // buyers
            commands::list_buyers,
            commands::get_buyer,
            commands::search_buyers,
            commands::create_buyer,
            commands::update_buyer,
            commands::set_buyer_archived,
            commands::delete_buyer,
            commands::buyer_statement,
            // sellers
            commands::list_sellers,
            commands::get_seller,
            commands::search_sellers,
            commands::create_seller,
            commands::update_seller,
            commands::set_seller_archived,
            commands::delete_seller,
            commands::seller_statement,
            // purchases
            commands::list_purchases,
            commands::get_purchase,
            commands::get_purchase_by_number,
            commands::create_purchase,
            commands::void_purchase,
            commands::pay_purchase,
            // sales
            commands::list_sales,
            commands::get_sale,
            commands::get_sale_by_number,
            commands::create_sale,
            commands::void_sale,
            commands::receive_sale,
            // cloud mirror (local cache of the authoritative cloud ledger)
            commands::sync_get_watermarks,
            commands::sync_apply,
            commands::sync_clear,
            commands::list_cloud_sales,
            commands::get_cloud_sale,
            commands::list_cloud_purchases,
            commands::get_cloud_purchase,
            commands::list_cloud_cached_approvals,
            commands::list_cloud_cached_audit,
            // returns
            commands::list_returns,
            commands::get_return,
            commands::create_return,
            commands::returned_quantity,
            // payments
            commands::list_payments,
            commands::payment_totals,
            commands::record_payment,
            commands::reverse_payment,
            // coworkers
            commands::list_coworkers,
            commands::get_coworker,
            commands::coworker_totals,
            commands::coworker_transactions,
            commands::all_coworker_transactions,
            commands::create_coworker,
            commands::update_coworker,
            commands::set_coworker_archived,
            commands::record_coworker_entry,
            // audit
            commands::recent_movements,
            commands::list_audit,
            // reports
            commands::report_inventory,
            commands::report_purchases,
            commands::report_sales,
            commands::report_profit,
            commands::report_buyer_balances,
            commands::report_seller_balances,
            commands::report_payments,
            commands::report_coworkers,
            commands::report_stock_movements,
            commands::report_returns,
            commands::report_top_movers,
            // search
            commands::global_search,
            // backup
            commands::backup_info,
            commands::list_backups,
            commands::backup_now,
            commands::restore_backup,
            commands::verify_backup,
            // demo
            commands::demo_summary,
            commands::demo_is_empty,
            commands::load_demo_data,
            commands::clear_all_data,
            // util
            commands::round_money,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZEUS");
}