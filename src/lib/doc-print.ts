import { exportPdf } from "./export";
import { money, qty, skuSummary } from "./format";
import type { Purchase, Sale } from "./types";

/* ===========================================================================
   Printable document
   ---------------------------------------------------------------------------
   A purchase or sale prints as its own document sheet - the layout a shop would
   hand a customer - rather than as a row inside a report. Both the list screens
   and the detail screens call these.
   =========================================================================== */

/** Prints (or saves as PDF) a single purchase document. */
export function printPurchase(p: Purchase, currency = "AED"): boolean {
  return exportPdf({
    filename: `purchase-${p.purchaseNumber}`,
    title: "PURCHASE",
    subtitle: `${p.purchaseNumber} - ${p.sellerName}`,
    columns: [
      { header: "SKU", value: (i) => i.sku },
      { header: "Description", value: (i) => `${i.generation} ${i.category} ${i.capacity} ${i.speed}` },
      { header: "Qty", value: (i) => i.quantity, numeric: true },
      { header: "Unit cost", value: (i) => i.costPerUnit, numeric: true },
      { header: "Amount", value: (i) => i.subtotal, numeric: true },
    ],
    rows: p.items,
    meta: [
      { label: "Seller", value: p.sellerName },
      { label: "Date", value: p.purchaseDate },
      { label: "Number", value: p.purchaseNumber },
      { label: "Lines", value: qty(p.items.length) },
      { label: "Units", value: qty(p.unitCount) },
      { label: "Subtotal", value: money(p.subtotal, currency) },
      { label: "Discount", value: money(p.discount, currency) },
      { label: "Total", value: money(p.total, currency) },
      { label: "Paid", value: money(p.paid, currency) },
      { label: "Balance", value: money(p.remaining, currency) },
      { label: "Payment method", value: p.paymentMethod || "Not recorded" },
      { label: "Notes", value: p.notes || "None" },
      ...(p.status === "void"
        ? [{ label: "Status", value: `VOID - ${p.voidReason || "no reason recorded"}` }]
        : []),
    ],
  });
}

/** Prints (or saves as PDF) a single sale invoice. */
export function printSale(s: Sale, currency = "AED"): boolean {
  return exportPdf({
    filename: `sale-${s.saleNumber}`,
    title: "SALE INVOICE",
    subtitle: `${s.saleNumber} - ${s.buyerName}`,
    columns: [
      { header: "SKU", value: (i) => i.sku },
      { header: "Description", value: (i) => skuSummary(i) },
      { header: "Qty", value: (i) => i.quantity, numeric: true },
      { header: "Unit price", value: (i) => i.sellingPrice, numeric: true },
      { header: "Amount", value: (i) => i.subtotal, numeric: true },
      { header: "Unit cost", value: (i) => i.costPerUnit, numeric: true },
      { header: "Profit", value: (i) => i.profit, numeric: true },
    ],
    rows: s.items,
    meta: [
      { label: "Buyer", value: s.buyerName },
      { label: "Date", value: s.saleDate },
      { label: "Number", value: s.saleNumber },
      { label: "Lines", value: qty(s.items.length) },
      { label: "Units", value: qty(s.unitCount) },
      { label: "Subtotal", value: money(s.subtotal, currency) },
      { label: "Discount", value: money(s.discount, currency) },
      { label: "Total", value: money(s.total, currency) },
      { label: "Received", value: money(s.received, currency) },
      { label: "Balance", value: money(s.remaining, currency) },
      { label: "Cost of goods", value: money(s.totalCost, currency) },
      { label: "Gross profit", value: money(s.grossProfit, currency) },
      { label: "Payment method", value: s.paymentMethod || "Not recorded" },
      { label: "Notes", value: s.notes || "None" },
      ...(s.status === "void"
        ? [{ label: "Status", value: `VOID - ${s.voidReason || "no reason recorded"}` }]
        : []),
    ],
  });
}