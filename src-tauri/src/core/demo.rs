//! Optional sample business data.
//!
//! ZEUS ships empty on purpose: the production database never contains invented
//! transactions. This module is the single, explicit escape hatch - a business
//! owner can load a realistic week of trading to explore the screens, and then
//! wipe it. `is_empty` is checked before seeding so real data is never touched.

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::core::parties::PartyKind;
use rusqlite::Connection;

pub fn summary(conn: &Connection) -> AppResult<DemoSummary> {
    let count = |sql: &str| -> AppResult<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(DemoSummary {
        buyers: count("SELECT COUNT(*) FROM buyers")?,
        sellers: count("SELECT COUNT(*) FROM sellers")?,
        ram_items: count("SELECT COUNT(*) FROM ram_items")?,
        purchases: count("SELECT COUNT(*) FROM purchases")?,
        sales: count("SELECT COUNT(*) FROM sales")?,
        payments: count("SELECT COUNT(*) FROM payments WHERE voided_at IS NULL")?,
        coworkers: count("SELECT COUNT(*) FROM coworkers")?,
    })
}

pub fn is_empty(conn: &Connection) -> AppResult<bool> {
    let s = summary(conn)?;
    Ok(s.buyers == 0 && s.sellers == 0 && s.ram_items == 0 && s.purchases == 0 && s.sales == 0)
}

fn day(offset: i64) -> String {
    (chrono::Local::now().naive_local() - chrono::Duration::days(offset))
        .format("%Y-%m-%d")
        .to_string()
}

/// Loads a small but realistic data set: two sellers, three buyers, six SKUs,
/// and a week of purchases and sales with partial payments.
pub fn seed(conn: &mut Connection) -> AppResult<DemoSummary> {
    if !is_empty(conn)? {
        return Err(AppError::conflict(
            "Sample data can only be loaded into an empty database. Your existing records are safe.",
        ));
    }

    // ---------------------------------------------------------- sellers
    let dubai = super::parties::create(
        conn,
        PartyKind::Seller,
        &PartyInput {
            company_name: "Dubai RAM Supplier".into(),
            contact_person: Some("Imran Khan".to_string()),
            phone: Some("+971 50 111 2233".to_string()),
            city: Some("Dubai".to_string()),
            trn_vat: Some("100123456700003".to_string()),
            ..Default::default()
        },
    )?;
    let shj = super::parties::create(
        conn,
        PartyKind::Seller,
        &PartyInput {
            company_name: "Al Noor Electronics".into(),
            contact_person: Some("Saeed Rahman".to_string()),
            phone: Some("+971 55 222 3344".to_string()),
            city: Some("Sharjah".to_string()),
            ..Default::default()
        },
    )?;

    // ----------------------------------------------------------- buyers
    let buyer = |name: &str, contact: &str, phone: &str, city: &str| PartyInput {
        company_name: name.into(),
        contact_person: Some(contact.to_string()),
        phone: Some(phone.to_string()),
        city: Some(city.to_string()),
        ..Default::default()
    };
    let sharjah = super::parties::create(
        conn,
        PartyKind::Buyer,
        &buyer("Sharjah Computer Trading", "Rashid Ali", "+971 50 333 4455", "Sharjah"),
    )?;
    let alain = super::parties::create(
        conn,
        PartyKind::Buyer,
        &buyer("Alain Systems LLC", "Maya Joseph", "+971 52 444 5566", "Al Ain"),
    )?;
    let dubai_buyer = super::parties::create(
        conn,
        PartyKind::Buyer,
        &buyer("Bur Dubai Tech", "Yusuf Malik", "+971 56 555 6677", "Dubai"),
    )?;

    // ------------------------------------------------------- catalogue
    struct Spec {
        generation: &'static str,
        category: &'static str,
        capacity: &'static str,
        speed: &'static str,
        manufacturer: &'static str,
        part_number: &'static str,
        cost: f64,
        sell: f64,
        minimum_stock: i64,
        ecc: bool,
        registered: bool,
    }

    let specs = [
        Spec { generation: "DDR4", category: "Server", capacity: "32 GB", speed: "2666V", manufacturer: "Samsung", part_number: "M393A4G40AB2-266", cost: 50.0, sell: 80.0, minimum_stock: 5, ecc: true, registered: true },
        Spec { generation: "DDR4", category: "PC", capacity: "16 GB", speed: "3200", manufacturer: "Crucial", part_number: "CT8G4DFRA32A", cost: 22.0, sell: 35.0, minimum_stock: 10, ecc: false, registered: false },
        Spec { generation: "DDR4", category: "Laptop", capacity: "8 GB", speed: "3200", manufacturer: "Kingston", part_number: "KVR32S19S8/8", cost: 12.5, sell: 20.0, minimum_stock: 10, ecc: false, registered: false },
        Spec { generation: "DDR5", category: "PC", capacity: "32 GB", speed: "5600", manufacturer: "Kingston", part_number: "KF556C40BB-32", cost: 62.0, sell: 95.0, minimum_stock: 6, ecc: false, registered: false },
        Spec { generation: "DDR5", category: "Server", capacity: "64 GB", speed: "4800", manufacturer: "Micron", part_number: "MTC40F2046S1RC48", cost: 145.0, sell: 210.0, minimum_stock: 4, ecc: true, registered: true },
        Spec { generation: "DDR5", category: "PC", capacity: "64 GB", speed: "6000", manufacturer: "Corsair", part_number: "CMK64GX5M2B6000", cost: 118.0, sell: 175.0, minimum_stock: 4, ecc: false, registered: false },
    ];

    let mut items = Vec::new();
    for s in specs.iter() {
        items.push(super::catalog::create(
            conn,
            &RamItemInput {
                generation: s.generation.into(),
                category: s.category.into(),
                capacity: s.capacity.to_string(),
                speed: s.speed.into(),
                manufacturer: Some(s.manufacturer.into()),
                model: Some(format!("{} {}", s.manufacturer, s.capacity.replace(' ', ""))),
                part_number: Some(s.part_number.into()),
                condition: Some("New".into()),
                ecc: s.ecc,
                registered: s.registered,
                module_count: 1,
                purchase_price: s.cost,
                selling_price: s.sell,
                opening_quantity: 0,
                minimum_stock: s.minimum_stock,
                location: Some("Main Warehouse".into()),
                ..Default::default()
            },
        )?);
    }

    // -------------------------------------------------------- purchases
    let p1 = super::purchases::create(
        conn,
        &PurchaseInput {
            seller_id: Some(dubai.id.clone()),
            purchase_date: Some(day(6)),
            amount_paid: 1800.0,
            payment_method: Some("Bank Transfer".into()),
            notes: Some("Monthly wholesale order".into()),
            items: vec![
                TransactionLine { ram_item_id: items[0].id.clone(), quantity: 20, unit_price: 50.0 },
                TransactionLine { ram_item_id: items[1].id.clone(), quantity: 40, unit_price: 22.0 },
                TransactionLine { ram_item_id: items[2].id.clone(), quantity: 30, unit_price: 12.5 },
            ],
            ..Default::default()
        },
    )?;

    let p2 = super::purchases::create(
        conn,
        &PurchaseInput {
            seller_id: Some(shj.id.clone()),
            purchase_date: Some(day(4)),
            discount: 25.0,
            amount_paid: 500.0,
            payment_method: Some("Cash".into()),
            items: vec![
                TransactionLine { ram_item_id: items[3].id.clone(), quantity: 25, unit_price: 62.0 },
                TransactionLine { ram_item_id: items[4].id.clone(), quantity: 10, unit_price: 145.0 },
                TransactionLine { ram_item_id: items[5].id.clone(), quantity: 8, unit_price: 118.0 },
            ],
            ..Default::default()
        },
    )?;

    let p3 = super::purchases::create(
        conn,
        &PurchaseInput {
            seller_id: Some(dubai.id.clone()),
            purchase_date: Some(day(2)),
            amount_paid: 560.0,
            payment_method: Some("Cheque".into()),
            items: vec![
                TransactionLine { ram_item_id: items[1].id.clone(), quantity: 25, unit_price: 22.4 },
            ],
            ..Default::default()
        },
    )?;

    // ------------------------------------------------------------ sales
    super::sales::create(
        conn,
        &SaleInput {
            buyer_id: Some(sharjah.id.clone()),
            sale_date: Some(day(5)),
            amount_received: 1600.0,
            payment_method: Some("Bank Transfer".into()),
            items: vec![
                TransactionLine { ram_item_id: items[0].id.clone(), quantity: 5, unit_price: 80.0 },
                TransactionLine { ram_item_id: items[1].id.clone(), quantity: 30, unit_price: 35.0 },
            ],
            ..Default::default()
        },
    )?;

    super::sales::create(
        conn,
        &SaleInput {
            buyer_id: Some(alain.id.clone()),
            sale_date: Some(day(3)),
            discount: 40.0,
            amount_received: 2000.0,
            payment_method: Some("Cash".into()),
            items: vec![
                TransactionLine { ram_item_id: items[3].id.clone(), quantity: 12, unit_price: 95.0 },
                TransactionLine { ram_item_id: items[5].id.clone(), quantity: 4, unit_price: 175.0 },
            ],
            ..Default::default()
        },
    )?;

    super::sales::create(
        conn,
        &SaleInput {
            buyer_id: Some(dubai_buyer.id.clone()),
            sale_date: Some(day(1)),
            amount_received: 600.0,
            payment_method: Some("Cheque".into()),
            items: vec![
                TransactionLine { ram_item_id: items[2].id.clone(), quantity: 30, unit_price: 20.0 },
            ],
            ..Default::default()
        },
    )?;

    // Instalments on the older purchases. The amount is clamped to what is
    // actually outstanding so the seed can never trip the overpayment guard.
    let instalment = |outstanding: f64, wanted: f64| wanted.min(outstanding);
    if p1.remaining > 0.0 {
        let amount = instalment(p1.remaining, 500.0);
        super::purchases::pay(conn, &p1.id, amount, "Bank Transfer", Some("Instalment"), &day(4))?;
    }
    if p2.remaining > 0.0 {
        let amount = instalment(p2.remaining, 800.0);
        super::purchases::pay(conn, &p2.id, amount, "Cash", Some("Instalment"), &day(2))?;
    }
    if p3.remaining > 0.0 {
        super::purchases::pay(conn, &p3.id, p3.remaining, "Cheque", Some("Settled in full"), &day(1))?;
    }

    // ------------------------------------------------------- coworkers
    super::coworkers::record(
        conn,
        &CoworkerInput { name: Some("Bilal Ahmed".into()), kind: "LEND".into(), amount: 500.0, method: Some("Cash".into()), notes: Some("Staff advance".into()), ..Default::default() },
    )?;
    super::coworkers::record(
        conn,
        &CoworkerInput { coworker_id: Some(
            super::coworkers::list(conn, "Bilal", false)?.first().map(|c| c.id.clone()).unwrap_or_default(),
        ), kind: "REPAYMENT".into(), amount: 200.0, method: Some("Cash".into()), ..Default::default() },
    )?;
    super::coworkers::record(
        conn,
        &CoworkerInput { name: Some("Hassan Naim".into()), kind: "BORROW".into(), amount: 300.0, method: Some("Bank Transfer".into()), ..Default::default() },
    )?;

    super::audit::write(conn, "SEED", "DATABASE", None, "Loaded sample business data")?;
    summary(conn)
}

/// Removes every business record. Reference data (speeds, categories) is kept
/// because it is configuration, not transaction history.
pub fn clear(conn: &mut Connection) -> AppResult<DemoSummary> {
    let tx = conn.transaction()?;
    for table in [
        "return_items", "returns", "sale_items", "sales", "purchase_items", "purchases",
        "stock_movements", "inventory_adjustments", "payments", "coworker_transactions",
        "coworkers", "ram_items", "buyers", "sellers",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    super::log(&tx, "CLEAR", "DATABASE", None, "Cleared all business data");
    tx.commit()?;
    summary(conn)
}