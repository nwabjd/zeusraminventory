//! Shared fixtures for the ZEUS business-rule tests.
//!
//! Every test builds on a fresh in-memory database so ordering can never leak
//! state between cases.

#![allow(dead_code)]

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use zeus_app_lib::core::catalog;
use zeus_app_lib::core::parties::{self, PartyKind};
use zeus_app_lib::db;
use zeus_app_lib::models::{PartyInput, RamItemInput};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// A migrated, empty in-memory database.
pub fn db() -> Connection {
    db::open_in_memory().expect("in-memory database should open and migrate")
}

/// A unique scratch directory for file-backed tests (backup / restore).
pub fn scratch_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("zeus-test-{tag}-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

/// A 32 GB DDR4 server module, the workhorse fixture of the suite.
pub fn ram_input(sku: Option<&str>) -> RamItemInput {
    RamItemInput {
        sku: sku.map(str::to_string),
        generation: "DDR4".into(),
        category: "Server".into(),
        capacity: "32 GB".into(),
        speed: "2666V".into(),
        ram_type: Some("DIMM".into()),
        manufacturer: Some("Samsung".into()),
        model: Some("M393A4G40AB2-266".into()),
        part_number: Some("M393A4G40AB2-266".into()),
        condition: Some("New".into()),
        ecc: true,
        registered: true,
        rank: Some("2Rx4".into()),
        module_count: 1,
        purchase_price: 50.0,
        selling_price: 80.0,
        minimum_stock: 5,
        opening_quantity: 0,
        location: Some("Warehouse A".into()),
        notes: None,
    }
}

pub fn make_ram(conn: &mut Connection, sku: Option<&str>) -> zeus_app_lib::models::RamItem {
    catalog::create(conn, &ram_input(sku)).expect("RAM item should be created")
}

pub fn make_buyer(conn: &Connection, name: &str) -> zeus_app_lib::models::Party {
    parties::create(
        conn,
        PartyKind::Buyer,
        &PartyInput {
            company_name: name.into(),
            city: Some("Sharjah".into()),
            ..Default::default()
        },
    )
    .expect("buyer should be created")
}

pub fn make_seller(conn: &Connection, name: &str) -> zeus_app_lib::models::Party {
    parties::create(
        conn,
        PartyKind::Seller,
        &PartyInput {
            company_name: name.into(),
            city: Some("Dubai".into()),
            ..Default::default()
        },
    )
    .expect("seller should be created")
}