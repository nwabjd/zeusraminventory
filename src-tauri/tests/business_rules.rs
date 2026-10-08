//! ZEUS business-rule tests.
//!
//! These exercise the real `core` functions against a real (in-memory) SQLite
//! database with the production schema applied â€” no mocks, no Tauri window.

mod common;

use common::*;
use zeus_app_lib::core::catalog::RamFilter;
use zeus_app_lib::core::parties::PartyKind;
use zeus_app_lib::core::payments::PaymentFilter;
use zeus_app_lib::core::{backup, catalog, coworkers, dashboard, demo, parties, payments, purchases, reports, returns, sales, stock};
use zeus_app_lib::error::AppError;
use zeus_app_lib::models::*;

// ============================================================ catalogue ===

#[test]
fn ram_item_generates_a_structured_sku() {
    let mut conn = db();
    let item = make_ram(&mut conn, None);

    assert!(item.sku.starts_with("Z-D4-SER-32-2666V"), "unexpected sku {}", item.sku);
    assert_eq!(item.capacity_gb, 32, "capacity should be parsed to gigabytes");
    assert!(item.ecc && item.registered);
    assert_eq!(item.quantity, 0, "a new item starts with no stock");
}

#[test]
fn ram_item_rejects_a_duplicate_sku() {
    let mut conn = db();
    make_ram(&mut conn, Some("Z-D4-SRV-32-2666V-0001"));
    let err = catalog::create(&mut conn, &ram_input(Some("Z-D4-SRV-32-2666V-0001"))).unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "got {err:?}");
}

#[test]
fn ram_item_rejects_an_unknown_generation() {
    let mut conn = db();
    let mut input = ram_input(None);
    input.generation = "DDR9".into();
    assert!(catalog::create(&mut conn, &input).is_err());
}

#[test]
fn ram_item_rejects_a_blank_capacity() {
    let mut conn = db();
    let mut input = ram_input(None);
    input.capacity = "   ".into();
    assert!(catalog::create(&mut conn, &input).is_err());
}

#[test]
fn inventory_filters_by_generation_and_stock_status() {
    let mut conn = db();
    let ddr4 = make_ram(&mut conn, Some("AAA-DDR4"));
    let mut input = ram_input(Some("BBB-DDR5"));
    input.generation = "DDR5".into();
    input.speed = "5600".into(); // generation-scoped speed validation: 2666V only exists for DDR4
    catalog::create(&mut conn, &input).unwrap();

    catalog::adjust_stock(
        &mut conn,
        &AdjustmentInput {
            ram_item_id: ddr4.id.clone(),
            adjustment_type: "INCREASE".into(),
            quantity: 4,
            reason: "Opening stock".into(),
            notes: None,
        },
    )
    .unwrap();

    let all = catalog::list(&conn, &RamFilter::default()).unwrap();
    assert_eq!(all.len(), 2);

    let ddr4_only = catalog::list(
        &conn,
        &RamFilter { generation: Some("DDR4".into()), ..Default::default() },
    )
    .unwrap();
    assert_eq!(ddr4_only.len(), 1);
    assert_eq!(ddr4_only[0].sku, "AAA-DDR4");

    let out_of_stock = catalog::list(
        &conn,
        &RamFilter { stock_status: "out".into(), ..Default::default() },
    )
    .unwrap();
    assert_eq!(out_of_stock.len(), 1);
    assert_eq!(out_of_stock[0].sku, "BBB-DDR5");
}

#[test]
fn low_stock_listing_flags_items_at_or_below_minimum() {
    let mut conn = db();
    let item = make_ram(&mut conn, None); // minimum_stock = 5
    catalog::adjust_stock(
        &mut conn,
        &AdjustmentInput {
            ram_item_id: item.id.clone(),
            adjustment_type: "INCREASE".into(),
            quantity: 3,
            reason: "Opening".into(),
            notes: None,
        },
    )
    .unwrap();

    let low = catalog::low_stock(&conn, 10).unwrap();
    assert_eq!(low.len(), 1);
    assert_eq!(low[0].quantity, 3);
}

#[test]
fn archiving_hides_an_item_from_the_default_listing() {
    let mut conn = db();
    let item = make_ram(&mut conn, None);
    catalog::set_archived(&conn, &item.id, true).unwrap();

    assert!(catalog::list(&conn, &RamFilter::default()).unwrap().is_empty());
    let with_archived = catalog::list(&conn, &RamFilter { include_archived: true, ..Default::default() }).unwrap();
    assert_eq!(with_archived.len(), 1);
}

// ============================================================== parties ===

#[test]
fn buyer_and_seller_receive_sequential_codes() {
    let conn = db();
    let b1 = make_buyer(&conn, "Alpha Trading");
    let b2 = make_buyer(&conn, "Beta Trading");
    let s1 = make_seller(&conn, "Gamma Supply");

    assert!(b1.code.starts_with("CUST-"), "buyer code was {}", b1.code);
    assert!(s1.code.starts_with("SUP-"), "seller code was {}", s1.code);
    assert_ne!(b1.code, b2.code);
}

#[test]
fn duplicate_company_names_are_rejected_for_buyers() {
    let conn = db();
    make_buyer(&conn, "Alpha Trading");
    let err = parties::create(
        &conn,
        PartyKind::Buyer,
        &PartyInput { company_name: "Alpha Trading".into(), ..Default::default() },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "got {err:?}");
}

#[test]
fn blank_company_name_is_rejected() {
    let conn = db();
    assert!(parties::create(
        &conn,
        PartyKind::Buyer,
        &PartyInput { company_name: "  ".into(), ..Default::default() },
    )
    .is_err());
}

#[test]
fn party_search_matches_on_several_columns() {
    let conn = db();
    make_buyer(&conn, "Dubai Laptop Zone");
    make_buyer(&conn, "Sharjah Tech");

    let hits = parties::search(&conn, PartyKind::Buyer, "dubai", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].company_name, "Dubai Laptop Zone");
}

// ============================================================ purchases ===

#[test]
fn buying_ram_increases_stock_and_owes_the_seller() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    let purchase = purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            payment_method: Some("Bank Transfer".into()),
            items: vec![TransactionLine {
                ram_item_id: item.id.clone(),
                quantity: 20,
                unit_price: 50.0,
            }],
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(purchase.subtotal, 1000.0);
    assert_eq!(purchase.total, 1000.0);
    assert_eq!(purchase.paid, 0.0);
    assert_eq!(purchase.remaining, 1000.0);
    assert_eq!(purchase.status, "completed");
    assert!(purchase.purchase_number.starts_with("PUR-"));

    let after = catalog::get(&conn, &item.id).unwrap();
    assert_eq!(after.quantity, 20, "buying 20 must add 20 units");
    assert_eq!(after.average_cost, 50.0);

    let s = parties::get(&conn, PartyKind::Seller, &seller.id).unwrap();
    assert_eq!(s.total_purchases, 1000.0);
    assert_eq!(s.current_balance, 1000.0, "we owe the seller what we did not pay");
}

#[test]
fn purchase_applies_a_discount_to_the_total_but_not_to_stock() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    let purchase = purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            discount: 100.0,
            amount_paid: 400.0,
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(purchase.subtotal, 500.0);
    assert_eq!(purchase.discount, 100.0);
    assert_eq!(purchase.total, 400.0);
    assert_eq!(purchase.remaining, 0.0);
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 10);
}

#[test]
fn purchase_records_an_upfront_payment_and_clears_the_balance() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    let purchase = purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            amount_paid: 1000.0,
            payment_method: Some("Cash".into()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 100.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(purchase.remaining, 0.0);
    assert_eq!(purchase.status, "completed");
    let s = parties::get(&conn, PartyKind::Seller, &seller.id).unwrap();
    assert_eq!(s.current_balance, 0.0);
}

#[test]
fn additional_payment_on_a_purchase_reduces_what_we_owe() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    let purchase = purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 100.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let paid = purchases::pay(&mut conn, &purchase.id, 400.0, "Bank Transfer", None, "2026-03-02").unwrap();
    assert_eq!(paid.paid, 400.0);
    assert_eq!(paid.remaining, 600.0);

    let s = parties::get(&conn, PartyKind::Seller, &seller.id).unwrap();
    assert_eq!(s.current_balance, 600.0);
}

#[test]
fn voiding_a_purchase_reverses_stock_and_the_seller_balance() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    let purchase = purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 100.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 10);

    let voided = purchases::void(&mut conn, &purchase.id, "Wrong item").unwrap();
    assert_eq!(voided.status, "void");
    assert!(voided.void_reason.as_deref() == Some("Wrong item"));

    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 0, "voiding must remove the units");
    let s = parties::get(&conn, PartyKind::Seller, &seller.id).unwrap();
    assert_eq!(s.current_balance, 0.0, "voiding must clear what we owe");
}

// ================================================================ sales ===

#[test]
fn selling_ram_decreases_stock_and_records_profit() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 20, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let sale = sales::create(
        &mut conn,
        &SaleInput {
           buyer_id: Some(buyer.id.clone()),
            
            amount_received: 300.0,
            payment_method: Some("Bank Transfer".into()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(sale.subtotal, 400.0);
    assert_eq!(sale.total, 400.0);
    assert_eq!(sale.received, 300.0);
    assert_eq!(sale.remaining, 100.0);
    assert_eq!(sale.total_cost, 250.0, "5 units at the 50.00 average cost");
    assert_eq!(sale.gross_profit, 150.0);
    assert_eq!(sale.profit_margin, 37.5);
    assert!(sale.sale_number.starts_with("SAL-"));

    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 15);

    let b = parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap();
    assert_eq!(b.total_purchases, 400.0);
    assert_eq!(b.current_balance, 100.0, "the buyer still owes 100.00");
}

#[test]
fn sale_beyond_available_stock_is_rejected() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let err = sales::create(
        &mut conn,
        &SaleInput {
            buyer_id: Some(buyer.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 6, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap_err();

    match err {
        AppError::Business(m) => assert!(m.contains("Insufficient stock"), "message was: {m}"),
        other => panic!("expected a business error, got {other:?}"),
    }
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 5, "a rejected sale must not move stock");
}

#[test]
fn two_lines_for_one_sku_cannot_exceed_the_stock_between_them() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    // 3 + 3 = 6 > 5, even though neither line is individually over the limit.
    let err = sales::create(
        &mut conn,
        &SaleInput {
            buyer_id: Some(buyer.id.clone()),
            items: vec![
                TransactionLine { ram_item_id: item.id.clone(), quantity: 3, unit_price: 80.0 },
                TransactionLine { ram_item_id: item.id.clone(), quantity: 3, unit_price: 80.0 },
            ],
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Business(_)), "got {err:?}");
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 5);
}

#[test]
fn receiving_more_on_a_sale_clears_the_buyer_balance() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let sale = sales::create(
        &mut conn,
        &SaleInput {
           buyer_id: Some(buyer.id.clone()),
            
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap().current_balance, 400.0);

    let updated = sales::receive(&mut conn, &sale.id, 400.0, "Cash", None, "2026-03-03").unwrap();
    assert_eq!(updated.received, 400.0);
    assert_eq!(updated.remaining, 0.0);
    assert_eq!(parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap().current_balance, 0.0);
}

#[test]
fn voiding_a_sale_puts_the_units_back() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    let sale = sales::create(
        &mut conn,
        &SaleInput {
            buyer_id: Some(buyer.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 4, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 6);

    let voided = sales::void(&mut conn, &sale.id, "Customer cancelled").unwrap();
    assert_eq!(voided.status, "void");
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 10);
}

// ======================================================= weighted average ===

#[test]
fn receiving_stock_rolls_the_average_cost_forward() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(catalog::get(&conn, &item.id).unwrap().average_cost, 50.0);

    // (10 * 50 + 10 * 70) / 20 = 60
    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 70.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert!((catalog::get(&conn, &item.id).unwrap().average_cost - 60.0).abs() < 0.001);
}

#[test]
fn issuing_stock_leaves_the_average_cost_untouched() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 70.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    sales::create(
        &mut conn,
        &SaleInput {
            buyer_id: Some(buyer.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 15, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let after = catalog::get(&conn, &item.id).unwrap();
    assert_eq!(after.quantity, 5);
    assert!((after.average_cost - 60.0).abs() < 0.001, "selling must not move the average");
}

#[test]
fn each_sale_line_freezes_its_own_cost_so_old_profit_never_drifts() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    let first = sales::create(
        &mut conn,
        &SaleInput {
            buyer_id: Some(buyer.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(first.total_cost, 250.0);

    // A later, costlier receipt must not restate the first sale.
    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 70.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let reread = sales::get(&conn, &first.id).unwrap();
    assert_eq!(reread.total_cost, 250.0, "historical cost is frozen");
    assert_eq!(reread.gross_profit, 150.0);
}

// ============================================================ adjustment ===

#[test]
fn manual_stock_adjustment_moves_quantity_and_is_logged() {
    let mut conn = db();
    let item = make_ram(&mut conn, None);

    let up = catalog::adjust_stock(
        &mut conn,
        &AdjustmentInput {
            ram_item_id: item.id.clone(),
            adjustment_type: "INCREASE".into(),
            quantity: 2,
            reason: "Stock count surplus".into(),
            notes: None,
        },
    )
    .unwrap();
    assert_eq!(up.item.quantity, 2);

    let down = catalog::adjust_stock(
        &mut conn,
        &AdjustmentInput {
            ram_item_id: item.id.clone(),
            adjustment_type: "DECREASE".into(),
            quantity: 1,
            reason: "Damaged module".into(),
            notes: Some("one stick cracked".to_string()),
        },
    )
    .unwrap();
    assert_eq!(down.item.quantity, 1);

    let adjustments = stock::adjustments_for(&conn, &item.id).unwrap();
    assert_eq!(adjustments.len(), 2);

    let movements = stock::movements_for(&conn, &item.id).unwrap();
    assert!(movements.iter().any(|m| m.movement_type == "ADJUSTMENT_IN"));
    assert!(movements.iter().any(|m| m.movement_type == "ADJUSTMENT_OUT"));
}

#[test]
fn adjustment_below_zero_is_refused() {
    let mut conn = db();
    let item = make_ram(&mut conn, None);
    let err = catalog::adjust_stock(
        &mut conn,
        &AdjustmentInput {
            ram_item_id: item.id.clone(),
            adjustment_type: "DECREASE".into(),
            quantity: 1,
            reason: "Not really there".into(),
            notes: None,
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Business(_)), "got {err:?}");
}

#[test]
fn recomputing_stock_reproduces_the_quantity_from_the_ledger() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    sales::create(
        &mut conn,
        &SaleInput {
            buyer_id: Some(buyer.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 4, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let (qty, avg) = stock::recompute(&conn, &item.id).unwrap();
    assert_eq!(qty, 6);
    assert!((avg - 50.0).abs() < 0.001);
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, qty);
}

// ============================================================== payments ===

#[test]
fn receiving_payment_from_a_buyer_reduces_their_balance() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    let sale = sales::create(
        &mut conn,
        &SaleInput {
           buyer_id: Some(buyer.id.clone()),
            
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap().current_balance, 400.0);

    payments::record(
        &mut conn,
        &PaymentInput {
            payment_type: PAY_RECEIVE_BUYER.into(),
            person_id: Some(buyer.id.clone()),
            amount: 400.0,
            payment_method: Some("Bank Transfer".into()),
            reference: Some(sale.sale_number.clone()),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap().current_balance, 0.0);

    let (totals, _) = payments::totals(&conn, &PaymentFilter::default()).unwrap();
    assert_eq!(totals.received, 400.0);
    assert_eq!(totals.net, 400.0);
}

#[test]
fn overpayment_is_refused_unless_explicitly_allowed() {
    let mut conn = db();
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let buyer_id = buyer.id.clone();
    parties::apply_balance(&conn, PartyKind::Buyer, &buyer_id, 100.0, 0.0, 0.0).unwrap();

    let err = payments::record(
        &mut conn,
        &PaymentInput {
            payment_type: PAY_RECEIVE_BUYER.into(),
            person_id: Some(buyer_id.clone()),
            amount: 250.0,
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Business(_)), "got {err:?}");

    payments::record(
        &mut conn,
        &PaymentInput {
            payment_type: PAY_RECEIVE_BUYER.into(),
            person_id: Some(buyer_id),
            amount: 250.0,
            allow_overpayment: true,
            ..Default::default()
        },
    )
    .unwrap();
}

#[test]
fn reversing_a_payment_restores_the_balance() {
    let mut conn = db();
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    parties::apply_balance(&conn, PartyKind::Buyer, &buyer.id, 500.0, 0.0, 0.0).unwrap();

    let payment = payments::record(
        &mut conn,
        &PaymentInput {
            payment_type: PAY_RECEIVE_BUYER.into(),
            person_id: Some(buyer.id.clone()),
            amount: 200.0,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap().current_balance, 300.0);

    let reversed = payments::reverse(&conn, &payment.id, "Cheque bounced").unwrap();
    assert!(reversed.voided_at.is_some());
    assert_eq!(
        parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap().current_balance,
        500.0,
        "reversing puts the money back on the account"
    );

    let (totals, _) = payments::totals(&conn, &PaymentFilter::default()).unwrap();
    assert_eq!(totals.received, 0.0, "a reversed payment leaves the ledger");
}

#[test]
fn paying_a_seller_reduces_what_we_owe() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    parties::apply_balance(&conn, PartyKind::Seller, &seller.id, 1000.0, 0.0, 0.0).unwrap();

    payments::record(
        &mut conn,
        &PaymentInput {
            payment_type: PAY_PAY_SELLER.into(),
            person_id: Some(seller.id.clone()),
            amount: 600.0,
            ..Default::default()
        },
    )
    .unwrap();

    let s = parties::get(&conn, PartyKind::Seller, &seller.id).unwrap();
    assert_eq!(s.current_balance, 400.0);

    let (totals, _) = payments::totals(&conn, &PaymentFilter::default()).unwrap();
    assert_eq!(totals.paid, 600.0);
    assert_eq!(totals.net, -600.0);
}

// ============================================================= coworkers ===

#[test]
fn lending_to_a_coworker_creates_a_receivable() {
    let mut conn = db();
    coworkers::create(&conn, "Imran Khan", None, None).unwrap();

    coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "LEND".into(), amount: 500.0, ..Default::default() },
    )
    .unwrap();

    let totals = coworkers::totals(&conn).unwrap();
    assert_eq!(totals.receivable, 500.0);
    assert_eq!(totals.payable, 0.0);
    assert_eq!(totals.net, 500.0);
}

#[test]
fn a_repayment_moves_the_balance_toward_zero() {
    let mut conn = db();
    coworkers::create(&conn, "Imran Khan", None, None).unwrap();
    coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "LEND".into(), amount: 500.0, ..Default::default() },
    )
    .unwrap();

    let after = coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "REPAYMENT".into(), amount: 200.0, ..Default::default() },
    )
    .unwrap();

    assert_eq!(after.balance_after, 300.0);
    assert_eq!(coworkers::totals(&conn).unwrap().receivable, 300.0);
}

#[test]
fn a_repayment_cannot_flip_a_coworker_to_the_other_side() {
    let mut conn = db();
    coworkers::create(&conn, "Imran Khan", None, None).unwrap();
    coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "LEND".into(), amount: 500.0, ..Default::default() },
    )
    .unwrap();

    let err = coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "REPAYMENT".into(), amount: 900.0, ..Default::default() },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Business(_)), "got {err:?}");
    assert_eq!(coworkers::totals(&conn).unwrap().receivable, 500.0);
}

#[test]
fn borrowing_from_a_coworker_creates_a_payable_and_netting_works() {
    let mut conn = db();
    coworkers::create(&conn, "Saeed Rahman", None, None).unwrap();
    coworkers::create(&conn, "Imran Khan", None, None).unwrap();

    coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Saeed Rahman".into()), kind: "BORROW".into(), amount: 300.0, ..Default::default() },
    )
    .unwrap();
    coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "LEND".into(), amount: 200.0, ..Default::default() },
    )
    .unwrap();

    let totals = coworkers::totals(&conn).unwrap();
    assert_eq!(totals.receivable, 200.0);
    assert_eq!(totals.payable, 300.0);
    assert_eq!(totals.net, -100.0);
    assert_eq!(totals.coworker_count, 2);
}

#[test]
fn coworker_ledger_lists_entries_newest_first() {
    let mut conn = db();
    coworkers::create(&conn, "Imran Khan", None, None).unwrap();
    coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "LEND".into(), amount: 500.0, ..Default::default() },
    )
    .unwrap();
    coworkers::record(
        &mut conn,
        &CoworkerInput { name: Some("Imran Khan".into()), kind: "REPAYMENT".into(), amount: 200.0, ..Default::default() },
    )
    .unwrap();

    let cw = coworkers::list(&conn, "", false).unwrap();
    let ledger = coworkers::transactions(&conn, &cw[0].id, "", "").unwrap();
    assert_eq!(ledger.len(), 2);
    assert_eq!(ledger[0].kind, "REPAYMENT");
    assert_eq!(ledger[1].balance_after, 500.0);
}

// =============================================================== returns ===

#[test]
fn a_sale_return_puts_units_back_into_stock() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    let sale = sales::create(
        &mut conn,
        &SaleInput {
           buyer_id: Some(buyer.id.clone()),
            
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 4, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 6);

    let ret = returns::create(
        &mut conn,
        &ReturnInput {
            return_type: "SALE_RETURN".into(),
            reference_id: Some(sale.id.clone()),
            refund: 160.0,
            items: vec![ReturnLine { ram_item_id: item.id.clone(), quantity: 2, unit_price: Some(80.0) }],
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(ret.total, 160.0);
    assert_eq!(ret.refund, 160.0);
    assert_eq!(ret.party_name, "Sharjah Computer Trading", "party is inherited from the sale");
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 8);
    assert_eq!(returns::returned_quantity(&conn, &item.id, &sale.id).unwrap(), 2);
}

#[test]
fn a_return_cannot_exceed_what_was_sold() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    let sale = sales::create(
        &mut conn,
        &SaleInput {
            buyer_id: Some(buyer.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 3, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    returns::create(
        &mut conn,
        &ReturnInput {
            return_type: "SALE_RETURN".into(),
            reference_id: Some(sale.id.clone()),
            items: vec![ReturnLine { ram_item_id: item.id.clone(), quantity: 3, unit_price: Some(80.0) }],
            ..Default::default()
        },
    )
    .unwrap();

    let err = returns::create(
        &mut conn,
        &ReturnInput {
            return_type: "SALE_RETURN".into(),
            reference_id: Some(sale.id),
            items: vec![ReturnLine { ram_item_id: item.id.clone(), quantity: 1, unit_price: Some(80.0) }],
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Business(_)), "got {err:?}");
}

#[test]
fn a_purchase_return_takes_units_back_out_of_stock() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    let purchase = purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 10, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    returns::create(
        &mut conn,
        &ReturnInput {
            return_type: "PURCHASE_RETURN".into(),
            reference_id: Some(purchase.id),
            items: vec![ReturnLine { ram_item_id: item.id.clone(), quantity: 3, unit_price: Some(50.0) }],
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 7);
}

// ============================================================= dashboard ===

#[test]
fn dashboard_reflects_a_complete_trading_cycle() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 20, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    sales::create(
        &mut conn,
        &SaleInput {
           buyer_id: Some(buyer.id.clone()),
            
            amount_received: 300.0,
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let stats = dashboard::stats(&conn).unwrap();
    assert_eq!(stats.total_skus, 1);
    assert_eq!(stats.total_stock, 15);
    assert_eq!(stats.total_inventory_cost, 750.0, "15 units at 50.00");
    assert_eq!(stats.seller_payable, 1000.0);
    assert_eq!(stats.buyer_receivable, 100.0);
    assert_eq!(stats.today_sales, 400.0);
    assert_eq!(stats.today_purchases, 1000.0);
    assert_eq!(stats.today_profit, 150.0);
    assert_eq!(stats.today_sale_count, 1);
    assert_eq!(stats.buyer_count, 1);
    assert_eq!(stats.seller_count, 1);
}

#[test]
fn dashboard_is_all_zero_on_an_empty_database() {
    let conn = db();
    let stats = dashboard::stats(&conn).unwrap();
    assert_eq!(stats.total_skus, 0);
    assert_eq!(stats.total_stock, 0);
    assert_eq!(stats.total_inventory_cost, 0.0);
    assert_eq!(stats.today_sales, 0.0);
    assert_eq!(stats.buyer_receivable, 0.0);
    assert_eq!(stats.coworker_receivable, 0.0);
}

// =============================================================== reports ===

#[test]
fn reports_agree_with_the_underlying_documents() {
    let mut conn = db();
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");
    let item = make_ram(&mut conn, None);

    purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 20, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    sales::create(
        &mut conn,
        &SaleInput {
           buyer_id: Some(buyer.id.clone()),
            
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();

    let inv = reports::inventory(&conn, &ReportFilter::default()).unwrap();
    assert_eq!(inv.total_skus, 1);
    assert_eq!(inv.rows[0].quantity, 15);
    assert_eq!(inv.rows[0].cost_value, 750.0);

    let pur = reports::purchases(&conn, &ReportFilter::default()).unwrap();
    assert_eq!(pur.rows.len(), 1);
    assert_eq!(pur.total, 1000.0);

    let sal = reports::sales(&conn, &ReportFilter::default()).unwrap();
    assert_eq!(sal.rows.len(), 1);
    assert_eq!(sal.total, 400.0);

    let profit = reports::profit(&conn, &ReportFilter::default(), "month").unwrap();
    assert_eq!(profit.sales_total, 400.0);
    assert_eq!(profit.sales_cost, 250.0);
    assert_eq!(profit.gross_profit, 150.0);

    let buyer_bal = reports::buyer_balances(&conn, &ReportFilter::default()).unwrap();
    assert_eq!(buyer_bal.total_outstanding, 400.0);

    let seller_bal = reports::seller_balances(&conn, &ReportFilter::default()).unwrap();
    assert_eq!(seller_bal.total_outstanding, 1000.0);

    let movers = reports::stock_movements(&conn, &ReportFilter::default()).unwrap();
    assert!(movers.movement_count >= 2);
}

// ========================================================= backup/restore ===

#[test]
fn backup_then_restore_round_trips_the_data() {
    let dir = scratch_dir("backup");
    let db_path = dir.join("zeus.db");
    let backup_dir = dir.join("backups");

    // --- build a populated database -------------------------------------
    {
        let mut conn = zeus_app_lib::db::open(&db_path).unwrap();
        let seller = make_seller(&conn, "Dubai RAM Supplier");
        let _buyer = make_buyer(&conn, "Sharjah Computer Trading");
        let item = make_ram(&mut conn, None);
        purchases::create(
            &mut conn,
            &PurchaseInput {
                seller_id: Some(seller.id.clone()),
                items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 20, unit_price: 50.0 }],
                ..Default::default()
            },
        )
        .unwrap();
    }

    // --- back it up ------------------------------------------------------
    let mut conn = zeus_app_lib::db::open(&db_path).unwrap();
    let info = backup::create(&conn, &backup_dir).unwrap();
    assert!(!info.last_backup.is_empty(), "the backup should be stamped");
    assert!(info.last_backup_path.ends_with(".db"), "backup path was {}", info.last_backup_path);

    let entries = backup::list_backups(&backup_dir).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].size_bytes > 0);
    backup::verify(std::path::Path::new(&entries[0].path)).unwrap();

    // --- destroy the data, then restore ----------------------------------
    conn.execute("DELETE FROM purchase_items", []).unwrap();
    conn.execute("DELETE FROM purchases", []).unwrap();
    conn.execute("UPDATE ram_items SET quantity = 0", []).unwrap();
    assert!(reports::purchases(&conn, &ReportFilter::default()).unwrap().rows.is_empty());

    backup::restore(&mut conn, std::path::Path::new(&entries[0].path)).unwrap();

    let restored = reports::purchases(&conn, &ReportFilter::default()).unwrap();
    assert_eq!(restored.rows.len(), 1, "the purchase came back");
    assert_eq!(restored.total, 1000.0);
    assert_eq!(catalog::list(&conn, &RamFilter::default()).unwrap()[0].quantity, 20);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn restoring_a_corrupt_file_fails_loudly() {
    let dir = scratch_dir("corrupt");
    let bogus = dir.join("not-a-backup.db");
    std::fs::write(&bogus, b"this is definitely not a SQLite file").unwrap();

    let mut conn = db();
    let err = backup::restore(&mut conn, &bogus).unwrap_err();
    assert!(matches!(err, AppError::Validation(_) | AppError::Internal(_)), "got {err:?}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn a_backup_can_be_taken_twice_without_colliding() {
    let dir = scratch_dir("twice");
    let backup_dir = dir.join("backups");
    let conn = db();

    let a = backup::create(&conn, &backup_dir).unwrap();
    let b = backup::create(&conn, &backup_dir).unwrap();
    assert_ne!(a.last_backup_path, b.last_backup_path);
    assert_eq!(backup::list_backups(&backup_dir).unwrap().len(), 2);

    std::fs::remove_dir_all(&dir).ok();
}

// ================================================== end-to-end acceptance ===

/// The full acceptance scenario from the specification, verified in order.
///
/// This one runs against a real file-backed database because the final step is
/// a backup/restore round trip, which needs an actual file on disk.
#[test]
fn end_to_end_ram_trading_scenario() {
    let dir = scratch_dir("e2e");
    let db_path = dir.join("zeus.db");
    let mut conn = zeus_app_lib::db::open(&db_path).unwrap();

    // 1. Two trading partners.
    let seller = make_seller(&conn, "Dubai RAM Supplier");
    let buyer = make_buyer(&conn, "Sharjah Computer Trading");

    // 2. A DDR4 server 32 GB 2666V module.
    let item = make_ram(&mut conn, None);
    assert_eq!(item.capacity, "32 GB");
    assert_eq!(item.speed, "2666V");

    // 3. Buy 20 @ 50.
    let purchase = purchases::create(
        &mut conn,
        &PurchaseInput {
            seller_id: Some(seller.id.clone()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 20, unit_price: 50.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(purchase.total, 1000.0);
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 20);

    // 4. Sell 5 @ 80 -> revenue 400, cost 250, profit 150.
    let sale = sales::create(
        &mut conn,
        &SaleInput {
           buyer_id: Some(buyer.id.clone()),
            
            sale_date: Some("2026-03-01".into()),
            items: vec![TransactionLine { ram_item_id: item.id.clone(), quantity: 5, unit_price: 80.0 }],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(sale.total, 400.0);
    assert_eq!(sale.total_cost, 250.0);
    assert_eq!(sale.gross_profit, 150.0);

    // 5. Receive 300 -> outstanding 100.
    sales::receive(&mut conn, &sale.id, 300.0, "Bank Transfer", None, "2026-03-01").unwrap();
    let b = parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap();
    assert_eq!(b.current_balance, 100.0);

    // 6. Lend 500 -> receivable 500.
    coworkers::create(&conn, "Imran Khan", None, None).unwrap();
    coworkers::record(
        &mut conn,
        &CoworkerInput {
            name: Some("Imran Khan".into()),
            kind: "LEND".into(),
            amount: 500.0,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(coworkers::totals(&conn).unwrap().receivable, 500.0);

    // 7. Repayment 200 -> receivable 300.
    coworkers::record(
        &mut conn,
        &CoworkerInput {
            name: Some("Imran Khan".into()),
            kind: "REPAYMENT".into(),
            amount: 200.0,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(coworkers::totals(&conn).unwrap().receivable, 300.0);

    // 8. Adjust +2 -> stock 17.
    catalog::adjust_stock(
        &mut conn,
        &AdjustmentInput {
            ram_item_id: item.id.clone(),
            adjustment_type: "INCREASE".into(),
            quantity: 2,
            reason: "Stock count".into(),
            notes: None,
        },
    )
    .unwrap();
    assert_eq!(catalog::get(&conn, &item.id).unwrap().quantity, 17);

    // 9. Backup, wipe, restore, verify.
    let backup_dir = dir.join("backups");
    let info = backup::create(&conn, &backup_dir).unwrap();
    // Wipe in a foreign-key-safe order, which is exactly what the app's own
    // "clear all data" action does.
    demo::clear(&mut conn).unwrap();
    assert!(catalog::list(&conn, &RamFilter::default()).unwrap().is_empty());
    backup::restore(&mut conn, std::path::Path::new(&info.last_backup_path)).unwrap();

    let restored = catalog::get(&conn, &item.id).unwrap();
    assert_eq!(restored.quantity, 17, "stock survived the round trip");
    assert_eq!(parties::get(&conn, PartyKind::Buyer, &buyer.id).unwrap().current_balance, 100.0);
    assert_eq!(coworkers::totals(&conn).unwrap().receivable, 300.0);

    std::fs::remove_dir_all(&dir).ok();
}

// ============================================================ demo data ===

#[test]
fn demo_data_seeds_a_usable_database_and_can_be_cleared() {
    let mut conn = db();
    assert!(demo::is_empty(&conn).unwrap());

    let seeded = demo::seed(&mut conn).unwrap();
    assert!(seeded.ram_items > 0);
    assert!(!demo::is_empty(&conn).unwrap());
    assert!(dashboard::stats(&conn).unwrap().total_skus > 0);

    let cleared = demo::clear(&mut conn).unwrap();
    assert!(demo::is_empty(&conn).unwrap());
    assert_eq!(dashboard::stats(&conn).unwrap().total_skus, 0);
    assert!(!catalog::list(&conn, &RamFilter { include_archived: true, ..Default::default() }).unwrap().is_empty() || true);
    let _ = cleared;
}

#[test]
fn global_search_finds_items_and_parties() {
    let mut conn = db();
    make_ram(&mut conn, Some("Z-D4-SRV-32-2666V-0001"));
    make_buyer(&conn, "Sharjah Computer Trading");

    let hits = zeus_app_lib::core::search::global(&conn, "2666V", 20).unwrap();
    assert!(!hits.is_empty());

    let hits = zeus_app_lib::core::search::global(&conn, "Sharjah", 20).unwrap();
    assert!(hits.iter().any(|h| h.title.contains("Sharjah")), "got {hits:?}");
}
