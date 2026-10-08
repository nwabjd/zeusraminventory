/* ===========================================================================
   ZEUS cloud logic unit tests - approval state machine + permission matrix.
   ---------------------------------------------------------------------------
   Run with plain Node (no test framework):
       node tests/cloud-logic.test.ts
   The tested module only uses `import type`, so Node's built-in type
   stripping can execute it directly.
   =========================================================================== */

import { strict as assert } from "node:assert";
import {
  ALLOWED_TRANSITIONS,
  APPROVAL_STATUS_LABEL,
  ROLE_PERMISSIONS,
  buildRequestPayload,
  can,
  canDecideItself,
  canDecideTransaction,
  canTransition,
  isAdmin,
  isClosed,
  isProvisioned,
  payloadTotals,
  resolvePayloadLines,
  statusTone,
} from "../src/lib/approval.ts";

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

/* ------------------------------------------------------- state machine --- */

test("canTransition only allows PENDING_APPROVAL -> APPROVED / REJECTED", () => {
  assert.equal(canTransition("pending_approval", "approved"), true);
  assert.equal(canTransition("pending_approval", "rejected"), true);
  assert.equal(canTransition("approved", "pending_approval"), false);
  assert.equal(canTransition("rejected", "approved"), false);
  assert.equal(canTransition("approved", "rejected"), false);
  assert.equal(canTransition("rejected", "pending_approval"), false);
});

test("ALLOWED_TRANSITIONS has no ambiguous values", () => {
  assert.deepEqual(Object.keys(ALLOWED_TRANSITIONS).sort(), [
    "approved",
    "pending_approval",
    "rejected",
  ]);
  for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
    for (const to of tos) assert.equal(canTransition(from as never, to as never), true);
  }
});

test("isClosed flags anything that is not pending", () => {
  assert.equal(isClosed("pending_approval"), false);
  assert.equal(isClosed("approved"), true);
  assert.equal(isClosed("rejected"), true);
});

test("status tones map correctly", () => {
  assert.equal(statusTone("pending_approval"), "warn");
  assert.equal(statusTone("approved"), "profit");
  assert.equal(statusTone("rejected"), "danger");
});

test("status labels exist for every status", () => {
  assert.equal(APPROVAL_STATUS_LABEL.pending_approval.length > 0, true);
  assert.equal(APPROVAL_STATUS_LABEL.approved.length > 0, true);
  assert.equal(APPROVAL_STATUS_LABEL.rejected.length > 0, true);
});

/* -------------------------------------------------- permission matrix --- */

test("admins may approve, manage users, view audit log, submit and view reports", () => {
  const perms = ROLE_PERMISSIONS.admin;
  assert.equal(perms.approveTransactions, true);
  assert.equal(perms.manageUsers, true);
  assert.equal(perms.viewAuditLog, true);
  assert.equal(perms.viewAllTransactions, true);
  assert.equal(perms.submitRequests, true);
  assert.equal(perms.viewReports, true);
});

test("sales representatives may submit but NEVER approve or manage users", () => {
  const perms = ROLE_PERMISSIONS.sales_representative;
  assert.equal(perms.approveTransactions, false);
  assert.equal(perms.manageUsers, false);
  assert.equal(perms.viewAuditLog, false);
  assert.equal(perms.viewAllTransactions, false);
  assert.equal(perms.viewReports, false);
  assert.equal(perms.submitRequests, true);
});

const adminProfile = {
  id: "p-admin",
  auth_user_id: "u-admin",
  email: "admin@example.com",
  role: "admin" as const,
  status: "active" as const,
};
const repProfile = {
  id: "p-rep",
  auth_user_id: "u-rep",
  email: "rep@example.com",
  role: "sales_representative" as const,
  status: "active" as const,
};

test("can() gates on role AND active status", () => {
  assert.equal(can(adminProfile, "approveTransactions"), true);
  assert.equal(can(repProfile, "submitRequests"), true);
  assert.equal(can(repProfile, "approveTransactions"), false);
  assert.equal(can({ ...adminProfile, status: "inactive" }, "approveTransactions"), false);
  assert.equal(can({ ...adminProfile, role: null }, "submitRequests"), false);
  assert.equal(can(null, "submitRequests"), false);
  assert.equal(can(undefined, "approveTransactions"), false);
});

test("isAdmin / isProvisioned helpers", () => {
  assert.equal(isAdmin(adminProfile), true);
  assert.equal(isAdmin(repProfile), false);
  assert.equal(isAdmin({ ...adminProfile, status: "inactive" }), false);
  assert.equal(isAdmin(null), false);
  assert.equal(isProvisioned(repProfile), true);
  assert.equal(isProvisioned({ ...adminProfile, role: null }), false);
  assert.equal(isProvisioned({ ...repProfile, status: "pending" }), false);
});

/* --------------------------------------------------- decision checks --- */

const pendingTxn = { status: "pending_approval" as const, requested_by: "u-rep" };

test("a sales representative cannot approve even someone else's request", () => {
  const r = canDecideTransaction(repProfile, pendingTxn);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /administrators/);
});

test("an admin cannot decide on their own request (separation of duties)", () => {
  const own = { status: "pending_approval" as const, requested_by: "u-admin" };
  const r = canDecideTransaction(adminProfile, own);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /yourself/i);
});

test("an admin can decide another user's pending request", () => {
  const r = canDecideTransaction(adminProfile, pendingTxn);
  assert.equal(r.ok, true);
});

test("an admin cannot re-decide an already decided request", () => {
  const approved = { status: "approved" as const, requested_by: "u-rep" };
  const r = canDecideTransaction(adminProfile, approved);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /already been decided/);
});

test("no profile means no decisions", () => {
  assert.equal(canDecideTransaction(null, pendingTxn).ok, false);
  assert.equal(canDecideTransaction(undefined, pendingTxn).ok, false);
});

test("canDecideItself blocks self-approval atomically", () => {
  assert.equal(canDecideItself("u-rep", "u-rep").ok, false);
  assert.equal(canDecideItself("u-rep", "u-admin").ok, true);
});

/* -------------------------------------------------------- payload etc --- */

test("buildRequestPayload enriches lines with catalogue facts including SKU", () => {
  const stockById = {
    "id-1": {
      id: "id-1",
      sku: "DDR4-16-3200",
      generation: "DDR4",
      category: "UDIMM",
      capacity: "16GB",
      speed: "3200",
    },
  };
  const payload = buildRequestPayload({
    kind: "sale",
    partyName: "Al Noor Electronics",
    date: "2026-10-07",
    discount: 10,
    payment: 500,
    method: "Cash",
    notes: "Ref: QUOTE-1",
    lines: [{ ramItemId: "id-1", quantity: 2, unitPrice: 60 }],
    stockById: stockById as never,
  });
  assert.equal(payload.kind, "sale");
  assert.equal(payload.partyName, "Al Noor Electronics");
  assert.equal(payload.discount, 10);
  assert.equal(payload.payment, 500);
  assert.equal(payload.method, "Cash");
  assert.equal(payload.notes, "Ref: QUOTE-1");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].sku, "DDR4-16-3200");
  assert.equal(payload.items[0].generation, "DDR4");
  assert.equal(payload.items[0].capacity, "16GB");
  assert.equal(payload.items[0].speed, "3200");
  assert.equal(payload.items[0].quantity, 2);
  assert.equal(payload.items[0].unitPrice, 60);
});

test("payloadTotals computes subtotal, capped discount, units and items", () => {
  const payload = buildRequestPayload({
    kind: "purchase",
    partyName: "Seller",
    date: "2026-10-07",
    discount: 1000, // exceeds subtotal -> capped
    payment: 0,
    method: "Credit",
    notes: "",
    lines: [
      { ramItemId: "id-1", quantity: 3, unitPrice: 200 },
      { ramItemId: "id-2", quantity: 1, unitPrice: 50 },
    ],
    stockById: { "id-1": { sku: "A" }, "id-2": { sku: "B" } } as never,
  });
  const totals = payloadTotals(payload);
  assert.equal(totals.subtotal, 650);
  assert.equal(totals.total, 0); // 650 - capped 650
  assert.equal(totals.unitCount, 4);
  assert.equal(totals.itemCount, 2);
});

test("payloadTotals rounds to whole cents", () => {
  const payload = {
    kind: "sale" as const,
    partyName: "X",
    date: "2026-10-07",
    discount: 0,
    payment: 0,
    method: "Cash",
    notes: "",
    items: [{ sku: "A", quantity: 1, unitPrice: 0.1, generation: "DDR4", category: "", capacity: "", speed: "" }],
  };
  assert.equal(payloadTotals(payload).total, 0.1);
});

test("resolvePayloadLines maps SKUs to device-local ids, throws on missing", () => {
  const catalogue = [
    { id: "local-1", sku: "DDR4-16-3200" },
    { id: "local-2", sku: "DDR5-32-5600" },
  ];
  const payload = buildRequestPayload({
    kind: "sale",
    partyName: "X",
    date: "2026-10-07",
    discount: 0,
    payment: 0,
    method: "Cash",
    notes: "",
    lines: [
      { ramItemId: "id-1", quantity: 2, unitPrice: 50 },
      { ramItemId: "id-2", quantity: 1, unitPrice: 90 },
    ],
    stockById: {
      "id-1": { sku: "DDR4-16-3200" },
      "id-2": { sku: "DDR5-32-5600" },
    } as never,
  });
  const resolved = resolvePayloadLines(payload, catalogue as never);
  assert.deepEqual(resolved, [
    { ramItemId: "local-1", quantity: 2, unitPrice: 50 },
    { ramItemId: "local-2", quantity: 1, unitPrice: 90 },
  ]);
  assert.throws(
    () => resolvePayloadLines({ ...payload, items: [{ ...payload.items[0], sku: "MISSING" }] }, catalogue as never),
    /not found/,
  );
});

/* --------------------------------------------------------------- report -- */

console.log(`\ncloud-logic: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);