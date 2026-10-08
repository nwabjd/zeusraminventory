/* ===========================================================================
   ZEUS cloud sync shaping unit tests - snapshot mapping + watermark rules.
   ---------------------------------------------------------------------------
   Run with plain Node (no test framework):
       node tests/cloud-sync.test.ts
   The tested module only uses `import type`, so Node's built-in type
   stripping executes it directly (the existing cloud-logic.test.ts proves the
   pattern for ./src/lib/approval.ts).

   Contract verified here:
   * Snake_case Supabase rows -> camelCase Rust mirror snapshot rows, with
     sensible defaults for NULL numeric/boolean columns.
   * A pull only ever ADVANCES a watermark to the maximum timestamp it
     actually received; an empty pull returns null so the caller keeps the
     previous watermark. A watermark never moves backwards.
   * Items + approvals watermark on `updated_at`; finalized documents
     (sales/purchases) + audit watermark on `created_at`.
   * Because the apply step is idempotent per row (upsert), a strict `gt`
     watermark that occasionally re-delivers a row is safe: exactly-once is
     NOT required, at-least-once delivery with de-dupe is.
   =========================================================================== */

import { strict as assert } from "node:assert";
import {
  maxFor,
  nextWatermark,
  toSyncApproval,
  toSyncAudit,
  toSyncItem,
  toSyncPurchase,
  toSyncPurchaseItem,
  toSyncSale,
  toSyncSaleItem,
} from "../src/lib/cloud-sync-shape.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    console.error(`\n✗ ${name}`);
    console.error(`  ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* --------------------------------------------------------- item mapping -- */

test("toSyncItem maps a full catalogue row snake->camel preserving quantity", () => {
  const out = toSyncItem({
    sku: "DDR5-32-5600",
    generation: "DDR5",
    category: "UDIMM",
    capacity: "32GB",
    capacity_gb: 32,
    speed: "5600",
    ram_type: "ECC",
    manufacturer: "Samsung",
    model: "M323R4GA3BB0-CQK",
    part_number: "M323R4GA3BB0",
    condition: "New",
    ecc: true,
    registered: true,
    rank: "2R",
    module_count: 1,
    purchase_price: 110,
    selling_price: 145,
    average_cost: 112.5,
    quantity: 47,
    minimum_stock: 5,
    location: "A.12",
    notes: "genuine",
    is_archived: false,
    created_at: "2026-10-01T09:00:00+00:00",
    updated_at: "2026-10-07T08:30:00+00:00",
  });
  assert.equal(out.sku, "DDR5-32-5600");
  assert.equal(out.capacityGb, 32);
  assert.equal(out.ramType, "ECC");
  assert.equal(out.partNumber, "M323R4GA3BB0");
  assert.equal(out.quantity, 47);
  assert.equal(out.isArchived, false);
  assert.equal(out.updatedAt, "2026-10-07T08:30:00+00:00");
});

test("toSyncItem defaults NULL numerics/bools to safe zero/false values", () => {
  const out = toSyncItem({
    sku: "MIN",
    generation: "DDR4",
    category: "RDIMM",
    capacity: "8GB",
    speed: "2400",
    quantity: 0,
  });
  assert.equal(out.capacityGb, 0);
  assert.equal(out.moduleCount, 0);
  assert.equal(out.purchasePrice, 0);
  assert.equal(out.sellingPrice, 0);
  assert.equal(out.averageCost, 0);
  assert.equal(out.minimumStock, 0);
  assert.equal(out.ecc, false);
  assert.equal(out.registered, false);
  assert.equal(out.isArchived, false);
  assert.equal(out.quantity, 0); // 0 is preserved, not replaced by default
});

/* ------------------------------------------------- document row mapping -- */

test("toSyncSale carries the approval link and totals of a finalized document", () => {
  const out = toSyncSale({
    id: "11111111-1111-4111-8111-111111111111",
    approval_id: "aaaa1111-1111-4111-8111-111111111111",
    sale_number: "CLDSLS-000042",
    buyer_name: "Al Noor Electronics",
    sale_date: "2026-10-07",
    subtotal: 1000,
    discount: 50,
    total: 950,
    received: 950,
    remaining: 0,
    payment_method: "Cash",
    total_cost: 700,
    gross_profit: 250,
    profit_margin: 26.32,
    notes: null,
    created_by: "u-rep-1",
    requested_by_email: "rep@example.com",
    decided_by_email: "admin@example.com",
    decided_at: "2026-10-07T08:31:00+00:00",
    created_at: "2026-10-07T08:31:00+00:00",
    updated_at: "2026-10-07T08:31:05+00:00",
  });
  assert.equal(out.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(out.approvalId, "aaaa1111-1111-4111-8111-111111111111");
  assert.equal(out.saleNumber, "CLDSLS-000042");
  assert.equal(out.totalCost, 700);
  assert.equal(out.requestedBy, "u-rep-1");
  assert.equal(out.requestedByEmail, "rep@example.com");
  assert.equal(out.decidedByEmail, "admin@example.com");
});

test("toSyncSale keeps a NON-approved row's approval link as null", () => {
  const out = toSyncSale({
    id: "2",
    approval_id: null,
    sale_number: "LOCAL-7",
    buyer_name: "X",
    sale_date: "2026-01-01",
    created_by: null,
    requested_by_email: "",
    decided_by_email: null,
    decided_at: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
  });
  assert.equal(out.approvalId, null);
  assert.equal(out.requestedBy, null);
  assert.equal(out.decidedByEmail, null);
  assert.equal(out.decidedAt, null);
});

test("toSyncPurchase maps totals/seller and the approval link", () => {
  const out = toSyncPurchase({
    id: "99999999-9999-4999-8999-999999999999",
    approval_id: "bbbb2222-2222-4222-8222-222222222222",
    purchase_number: "CLDPUR-000017",
    seller_name: "Prime Modules Ltd",
    purchase_date: "2026-10-06",
    subtotal: 2200,
    discount: 100,
    total: 2100,
    paid: 0,
    remaining: 2100,
    payment_method: "Credit",
    notes: "ETA friday",
    created_by: "u-rep-2",
    requested_by_email: "rep2@example.com",
    decided_by_email: "admin@example.com",
    decided_at: "2026-10-06T15:00:00+00:00",
    created_at: "2026-10-06T15:00:00+00:00",
    updated_at: "2026-10-06T15:00:00+00:00",
  });
  assert.equal(out.purchaseNumber, "CLDPUR-000017");
  assert.equal(out.sellerName, "Prime Modules Ltd");
  assert.equal(out.remaining, 2100);
  assert.equal(out.approvalId, "bbbb2222-2222-4222-8222-222222222222");
  assert.equal(out.paymentMethod, "Credit");
});

test("toSyncSaleItem / toSyncPurchaseItem map parent-id child rows", () => {
  const si = toSyncSaleItem({
    id: "iid-1",
    cloud_sale_id: "sale-1",
    sku: "DDR4-16-3200",
    generation: "DDR4",
    category: "UDIMM",
    capacity: "16GB",
    speed: "3200",
    quantity: 2,
    selling_price: 60,
    cost_per_unit: 40,
    subtotal: 120,
    cost_total: 80,
    profit: 40,
  });
  assert.equal(si.cloudSaleId, "sale-1");
  assert.equal(si.sellingPrice, 60);
  assert.equal(si.profit, 40);

  const pi = toSyncPurchaseItem({
    id: "pid-1",
    cloud_purchase_id: "pur-1",
    sku: "DDR4-16-3200",
    generation: "DDR4",
    category: "UDIMM",
    capacity: "16GB",
    speed: "3200",
    quantity: 10,
    cost_per_unit: 30,
    subtotal: 300,
  });
  assert.equal(pi.cloudPurchaseId, "pur-1");
  assert.equal(pi.costPerUnit, 30);
  assert.equal(pi.subtotal, 300);
});

test("toSyncApproval carries decision fields the mirror needs for MyTransactions", () => {
  const out = toSyncApproval({
    id: "approval-1",
    kind: "sale",
    transaction_number: "REQ-0042",
    payload: { kind: "sale", partyName: "X", date: "2026-10-07", discount: 0, payment: 0, method: "Cash", notes: "", items: [] },
    total_amount: 950,
    item_count: 1,
    unit_count: 2,
    party_name: "X",
    requested_by: "u-rep",
    requested_by_email: "rep@example.com",
    status: "approved",
    lock_owner: null,
    locked_at: null,
    decided_by: "u-admin",
    decided_by_email: "admin@example.com",
    decided_at: "2026-10-07T08:31:00+00:00",
    rejection_reason: null,
    final_document_number: "CLDSLS-000042",
    created_at: "2026-10-07T08:00:00+00:00",
    updated_at: "2026-10-07T08:31:05+00:00",
  });
  assert.equal(out.transactionNumber, "REQ-0042");
  assert.equal(out.status, "approved");
  assert.equal(out.finalDocumentNumber, "CLDSLS-000042");
  assert.equal(out.decidedByEmail, "admin@example.com");
});

test("toSyncAudit maps actor, action, entity and metadata", () => {
  const out = toSyncAudit({
    id: "audit-1",
    actor_id: "u-admin",
    actor_email: "admin@example.com",
    action: "APPROVAL_DECIDED",
    entity: "transaction_approvals",
    entity_id: "approval-1",
    metadata: { document_number: "CLDSLS-000042", inventory_effect: { applied: true } },
    created_at: "2026-10-07T08:31:05+00:00",
  });
  assert.equal(out.action, "APPROVAL_DECIDED");
  assert.equal(out.entityId, "approval-1");
  assert.equal(out.metadata?.["document_number"], "CLDSLS-000042");
});

/* --------------------------------------------------------- watermarking -- */

test("maxFor returns the newest updated_at across a row set", () => {
  const rows = [
    { updated_at: "2026-10-07T08:00:00+00:00" },
    { updated_at: "2026-10-07T08:15:00+00:00" },
    { updated_at: "2026-10-07T08:30:00+00:00" },
  ];
  assert.equal(maxFor(rows, "updated_at"), "2026-10-07T08:30:00+00:00");
});

test("maxFor watermarks sales/purchases/audit by created_at, not updated_at", () => {
  const rows = [
    { created_at: "2026-10-01T00:00:00+00:00", updated_at: "2026-10-08T00:00:00+00:00" },
    { created_at: "2026-10-05T00:00:00+00:00", updated_at: "2026-10-08T00:00:00+00:00" },
  ];
  // created_at advances to the newest creation time regardless of a later
  // update, so an edited document is NOT re-delivered as a new one.
  assert.equal(maxFor(rows, "created_at"), "2026-10-05T00:00:00+00:00");
});

test("maxFor tolerates missing/null timestamps and an empty pull", () => {
  assert.equal(maxFor([{ created_at: null }], "created_at"), null);
  assert.equal(maxFor([{ updated_at: undefined }], "updated_at"), null);
  assert.equal(maxFor([], "created_at"), null);
  assert.equal(maxFor([{ created_at: null }, { created_at: "2026-10-01T00:00:00+00:00" }], "created_at"), "2026-10-01T00:00:00+00:00");
});

test("nextWatermark never regresses - an empty pull keeps the previous value", () => {
  assert.equal(nextWatermark("2026-10-07T08:30:00+00:00", [], "updated_at"), "2026-10-07T08:30:00+00:00");
});

test("nextWatermark advances monotonically to the pulled maximum", () => {
  const rows = [{ updated_at: "2026-10-07T08:45:00+00:00" }];
  assert.equal(
    nextWatermark("2026-10-07T08:30:00+00:00", rows, "updated_at"),
    "2026-10-07T08:45:00+00:00",
  );
});

test("nextWatermark cannot move backwards if the server returns older rows", () => {
  const older = [{ updated_at: "2026-01-01T00:00:00+00:00" }];
  assert.equal(nextWatermark("2026-10-07T08:30:00+00:00", older, "updated_at"), "2026-10-07T08:30:00+00:00");
});

test("snapshot watermark builder uses strict-gt-compatible values (at-least-once, de-duped by apply)", () => {
  // Simulate the cloudPullSync watermark assembly: each stream is watermarked
  // by its own column and an empty stream keeps its previous watermark.
  const itemsWm = "2026-10-07T08:00:00+00:00";
  const approvalsWm = itemsWm;
  const salesWm = "2026-10-06T00:00:00+00:00";
  const purchasesWm = salesWm;
  const auditWm = "2026-10-05T00:00:00+00:00";

  const items = [
    { sku: "A", quantity: 1, updated_at: "2026-10-07T08:05:00+00:00" },
    { sku: "B", quantity: 2, updated_at: "2026-10-07T08:10:00+00:00" },
  ];
  const approvals: Array<{ updated_at: string | null; created_at: string | null }> = [];
  const sales = [{ created_at: "2026-10-06T12:00:00+00:00" }];
  const purchases: Array<{ created_at: string | null; updated_at: string | null }> = [];
  const audit = [{ created_at: "2026-10-07T00:00:00+00:00" }];

  const watermarks = {
    items: nextWatermark(itemsWm, items, "updated_at"),
    approvals: nextWatermark(approvalsWm, approvals, "updated_at"),
    sales: nextWatermark(salesWm, sales, "created_at"),
    purchases: nextWatermark(purchasesWm, purchases, "created_at"),
    audit: nextWatermark(auditWm, audit, "created_at"),
  };

  assert.equal(watermarks.items, "2026-10-07T08:10:00+00:00");
  assert.equal(watermarks.approvals, approvalsWm); // empty pull -> keep previous
  assert.equal(watermarks.sales, "2026-10-06T12:00:00+00:00");
  assert.equal(watermarks.purchases, purchasesWm); // empty pull -> keep previous
  assert.equal(watermarks.audit, "2026-10-07T00:00:00+00:00");
});

/* --------------------------------------------------------------- report -- */

console.log(`\ncloud-sync: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);